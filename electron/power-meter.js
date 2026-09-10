/**
 * Continuous local power meter: the measured half of the two-path model.
 *
 * When NVIDIA GPUs are present, sample nvidia-smi power (all GPUs, 1 Hz) and
 * keep a rolling timeline. Energy for any wall-clock window is the integral of
 * (power − idle baseline) over that window, so a ledger step's real energy is
 * just the integral between its own timestamp and the previous one — no manual
 * calibration run required. The baseline tracks the recent minimum (the machine
 * idling) so background load does not inflate every step.
 *
 * A manual calibration run (calibration.js) still produces per-model J/token
 * profiles; this module is what makes the console show measured energy for
 * every local session continuously.
 */
'use strict'

const { probeNvidia } = require('./console-data.js')

const SAMPLE_MS = 1000
const KEEP_MS = 2 * 60 * 60 * 1000 // two hours of 1 Hz samples
const BASELINE_WINDOW = 300 // five minutes

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

function createPowerMeter() {
  const samples = [] // { t: ms, w: W }
  let timer = null
  let busy = false
  let gpuNames = []
  let lastError = null

  function baselineW() {
    if (samples.length === 0) return 0
    const window = samples.slice(-BASELINE_WINDOW)
    return Math.min(...window.map(sample => sample.w))
  }

  /** Measured energy (J) between two epoch-ms instants. */
  function energyBetween(fromMs, toMs) {
    if (samples.length < 2) return null
    const baseline = baselineW()
    let energyJ = 0
    let covered = 0
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1]
      const current = samples[index]
      if (current.t <= fromMs) continue
      if (previous.t >= toMs) break
      const deltaS = Math.max(0, Math.min(current.t, toMs) - Math.max(previous.t, fromMs)) / 1000
      if (deltaS <= 0) continue
      const effective = Math.max(0, (previous.w + current.w) / 2 - baseline)
      energyJ += effective * deltaS
      covered += deltaS
    }
    if (covered <= 0) return null
    return { energyJ, seconds: covered, baselineW: baseline }
  }

  async function sample() {
    if (busy) return
    busy = true
    try {
      const gpus = await probeNvidia()
      if (gpus === null) {
        lastError = 'nvidia-smi 不可用'
        return
      }
      lastError = null
      gpuNames = gpus.map(gpu => gpu.name)
      const powerW = sumPower(gpus)
      if (powerW === null) return
      const now = Date.now()
      samples.push({ t: now, w: powerW })
      const cutoff = now - KEEP_MS
      while (samples.length > 0 && samples[0].t < cutoff) samples.shift()
    } finally {
      busy = false
    }
  }

  /**
   * Per-step measured energy for ledger rows (newest first). Each row is
   * attributed the integral from the previous row's timestamp to its own.
   */
  function perStep(rows) {
    if (rows.length === 0) return {}
    const ordered = [...rows].sort((left, right) => (left.ts ?? '').localeCompare(right.ts ?? ''))
    const result = {}
    let previousTs = null
    for (const row of ordered) {
      if (row.ts === null) continue
      const end = Date.parse(row.ts)
      if (Number.isNaN(end)) continue
      if (previousTs !== null && end > previousTs) {
        const measured = energyBetween(previousTs, end)
        if (measured !== null) result[`${row.turn}.${row.step}`] = measured.energyJ
      }
      previousTs = end
    }
    return result
  }

  return {
    start() {
      if (timer !== null) return
      void sample()
      timer = setInterval(() => { void sample() }, SAMPLE_MS)
    },
    stop() {
      if (timer !== null) clearInterval(timer)
      timer = null
    },
    /** Aggregate measurement state for the console snapshot. */
    status(ledger) {
      const now = Date.now()
      const lastHour = energyBetween(now - 3600_000, now)
      const sessionStart = ledger.recent.length === 0
        ? null
        : Date.parse(ledger.recent[ledger.recent.length - 1].ts ?? '')
      const session = sessionStart === null || Number.isNaN(sessionStart)
        ? null
        : energyBetween(sessionStart, now)
      return {
        available: gpuNames.length > 0,
        gpuNames,
        error: lastError,
        samples: samples.length,
        baselineW: samples.length === 0 ? null : baselineW(),
        currentW: samples.length === 0 ? null : samples[samples.length - 1].w,
        lastHourJ: lastHour === null ? null : lastHour.energyJ,
        sessionJ: session === null ? null : session.energyJ,
        perStep: perStep(ledger.recent),
      }
    },
  }
}

module.exports = { createPowerMeter }
