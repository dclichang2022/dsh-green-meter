/**
 * Self-calibration: measure what THIS machine actually draws while a model is
 * in use, so the console can stop extrapolating from someone else's hardware.
 *
 * Method: sample nvidia-smi power (all GPUs, 1 Hz) for the length of a run,
 * subtract the idle baseline measured just before the run, and divide the
 * integrated energy by the tokens the harness accounted during the same window
 * (the green-meter ledger rows appended while the run was open). The result is
 * a measured J/token for this GPU + model combination, stored as a profile and
 * shown alongside the published references.
 */
'use strict'

const { probeNvidia } = require('./console-data.js')
const { appendMeasuredProfile, loadMeasuredProfiles } = require('./reference-data.js')

const SAMPLE_MS = 1000
const BASELINE_SAMPLES = 5
const MAX_SAMPLES = 21_600 // six hours at 1 Hz

function nowIso() {
  return new Date().toISOString()
}

function sumPower(gpus) {
  if (!Array.isArray(gpus) || gpus.length === 0) return null
  let total = 0
  let seen = 0
  for (const gpu of gpus) {
    if (gpu.powerW === null || gpu.powerW === undefined) continue
    total += gpu.powerW
    seen += 1
  }
  return seen === 0 ? null : total
}

/**
 * @param {object} deps
 * @param {string} deps.dshHome harness home (profile store + settings live here).
 * @param {() => object} deps.getSettings current console settings.
 * @param {() => object} deps.getLedger current ledger snapshot (token rows).
 */
function createCalibration({ dshHome, getSettings, getLedger }) {
  let run = null
  let timer = null

  function tokensSince(startedAt) {
    const ledger = getLedger()
    // Window by wall clock: the ledger's recent window rolls, so an index into
    // it would silently drop rows once it fills.
    const rows = ledger.recent.filter(row => row.ts !== null && row.ts >= startedAt)
    const totals = { input: 0, cached: 0, output: 0, reasoning: 0 }
    for (const row of rows) {
      totals.input += row.inputTokens
      totals.cached += row.cachedTokens
      totals.output += row.outputTokens
      totals.reasoning += row.reasoningTokens
    }
    return { rows: rows.length, ...totals, total: totals.input + totals.cached + totals.output + totals.reasoning }
  }

  async function start({ label, modelName } = {}) {
    if (run !== null) return { ok: false, error: '已有标定在进行中' }
    const gpus = await probeNvidia()
    if (gpus === null) {
      return { ok: false, error: '未检测到 NVIDIA GPU（nvidia-smi 不可用），无法进行功耗标定' }
    }
    run = {
      label: String(label ?? '').trim() || `标定 ${new Date().toLocaleString('zh-CN')}`,
      modelName: String(modelName ?? '').trim() || '未标注模型',
      startedAt: nowIso(),
      windowStartTs: nowIso(),
      gpuNames: gpus.map(gpu => gpu.name),
      powerSamples: [],
      baselineSamples: [],
      energyJ: 0,
      lastTs: Date.now(),
      lastPowerW: null,
      phase: 'baseline',
    }

    timer = setInterval(() => { void sample() }, SAMPLE_MS)
    void sample()
    return { ok: true, status: status() }
  }

  async function sample() {
    if (run === null) return
    const gpus = await probeNvidia()
    const powerW = sumPower(gpus)
    if (powerW === null) return
    const now = Date.now()
    const deltaS = Math.max(0, (now - run.lastTs) / 1000)
    run.lastTs = now

    if (run.phase === 'baseline') {
      run.baselineSamples.push(powerW)
      run.lastPowerW = powerW
      if (run.baselineSamples.length >= BASELINE_SAMPLES) {
        run.phase = 'measuring'
        run.baselineW = run.baselineSamples.reduce((sum, value) => sum + value, 0) / run.baselineSamples.length
        run.lastTs = Date.now()
      }
      return
    }

    const baseline = run.baselineW ?? 0
    const effective = Math.max(0, powerW - baseline)
    run.energyJ += effective * deltaS
    run.lastPowerW = powerW
    if (run.powerSamples.length < MAX_SAMPLES) run.powerSamples.push({ t: now, w: powerW, e: effective })
    if (run.powerSamples.length >= MAX_SAMPLES) void stop({ auto: true })
  }

  function status() {
    if (run === null) {
      return { running: false, profiles: loadMeasuredProfiles(dshHome) }
    }
    const tokens = tokensSince(run.windowStartTs)
    const elapsedS = Math.max(0, (Date.now() - Date.parse(run.startedAt)) / 1000)
    const settings = getSettings()
    const gridFactor = Number(settings.carbonFactorKgPerKwh) || 0.5777
    return {
      running: true,
      label: run.label,
      modelName: run.modelName,
      phase: run.phase,
      startedAt: run.startedAt,
      elapsedS,
      gpuNames: run.gpuNames,
      baselineW: run.baselineW ?? null,
      lastPowerW: run.lastPowerW,
      energyJ: run.energyJ,
      samples: run.powerSamples.length,
      tokens,
      jPerToken: tokens.total > 0 ? run.energyJ / tokens.total : null,
      jPerOutputToken: tokens.output + tokens.reasoning > 0 ? run.energyJ / (tokens.output + tokens.reasoning) : null,
      carbonG: run.energyJ / 3.6e6 * gridFactor * 1000,
      gridFactor,
    }
  }

  async function stop({ auto = false } = {}) {
    if (run === null) return { ok: false, error: '没有进行中的标定' }
    if (timer !== null) clearInterval(timer)
    timer = null
    const finished = run
    const tokens = tokensSince(finished.windowStartTs)
    const settings = getSettings()
    const gridFactor = Number(settings.carbonFactorKgPerKwh) || 0.5777
    run = null

    if (tokens.total === 0 || finished.energyJ <= 0) {
      return { ok: false, error: '窗口内没有可归因的 token 或功耗样本，已放弃本次标定' }
    }

    const endedAt = nowIso()
    const profile = {
      id: `local-${Date.now().toString(36)}`,
      tier: 'measured-local',
      label: finished.label,
      modelName: finished.modelName,
      gpuNames: finished.gpuNames,
      startedAt: finished.startedAt,
      endedAt,
      durationS: Math.max(0, (Date.parse(endedAt) - Date.parse(finished.startedAt)) / 1000),
      baselineW: finished.baselineW ?? null,
      avgPowerW: finished.powerSamples.length === 0
        ? null
        : finished.powerSamples.reduce((sum, sample) => sum + sample.w, 0) / finished.powerSamples.length,
      samples: finished.powerSamples.length,
      energyJ: finished.energyJ,
      tokens,
      jPerToken: finished.energyJ / tokens.total,
      jPerOutputToken: (tokens.output + tokens.reasoning) > 0
        ? finished.energyJ / (tokens.output + tokens.reasoning)
        : null,
      carbonG: finished.energyJ / 3.6e6 * gridFactor * 1000,
      carbonGPerToken: finished.energyJ / tokens.total / 3.6e6 * gridFactor * 1000,
      gridFactor,
      auto,
    }
    appendMeasuredProfile(dshHome, profile)
    return { ok: true, profile }
  }

  function profiles() {
    return loadMeasuredProfiles(dshHome)
  }

  return { start, stop, status, profiles }
}

module.exports = { createCalibration }
