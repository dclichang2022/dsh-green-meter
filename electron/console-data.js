/**
 * Console data layer: green-meter ledger aggregation, savings math, hardware
 * sampling, and the settings that drive both this console and the in-chat
 * dashboard (the settings are materialized into `$DSH_HOME/cordis.patch.yml`).
 *
 * Everything here is estimate-based and mirrors the green-meter plugin's own
 * accounting: token totals → energy (calibrated profiles) → carbon (grid
 * factor) → cost (electricity price), plus the counterfactuals the console
 * headlines: API cost avoided and cloud-equivalent carbon avoided.
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const referenceData = require('./reference-data.js')

/** Shipped defaults; the settings file overrides them. */
const DEFAULT_SETTINGS = {
  /** green-meter calibration profile key. */
  profile: 'proxy',
  /** Local grid carbon intensity, kg CO2e per kWh (green-meter's factor). */
  carbonFactorKgPerKwh: 0.5777,
  /** Cloud datacenter grid carbon intensity for the cloud-equivalent estimate. */
  cloudCarbonFactorKgPerKwh: 0.4,
  /** Selected presets from the reference dataset (see reference-data.js). */
  localGridPreset: 'cn-2024',
  cloudGridPreset: 'us-2023',
  /** Published cloud token→energy model + datacenter overhead multiplier. */
  cloudModelId: 'epoch-2025-output-token',
  cloudPue: 1.1,
  cloudEstimateEnabled: true,
  /** API list prices, CNY per 1M tokens. */
  apiPriceCnyPerMInput: 2.0,
  apiPriceCnyPerMCached: 0.5,
  apiPriceCnyPerMOutput: 8.0,
  /** Residential electricity price, CNY per kWh. */
  priceCnyPerKwh: 0.56,
  /** In-chat dashboard ledger poll interval, ms. */
  refreshMs: 5000,
  /** USD → CNY for relay spend display. */
  usdToCny: 7.2,
  /** Relay (中转站) data source. */
  relayEnabled: false,
  relayAdapter: 'openrouter',
  relayBaseUrl: 'https://openrouter.ai/api',
  relayApiKey: '',
  relayPollMs: 300_000,
  relayFieldDate: 'date',
  relayFieldModel: 'model',
  relayFieldProvider: 'provider',
  relayFieldRequests: 'requests',
  relayFieldInputTokens: 'input_tokens',
  relayFieldOutputTokens: 'output_tokens',
  relayFieldReasoningTokens: 'reasoning_tokens',
  relayFieldCostUsd: 'cost_usd',
  /** Alert rule thresholds (see alerts.js DEFAULT_RULES). */
  alertRules: {},
}

/** Calibration profiles the console exposes (mirrors green-meter's PROFILE_KEYS). */
const PROFILE_KEYS = [
  'proxy',
  'qwen-h20',
  'qwen-h20-instant',
  'qwen-h20-thinking',
  'gemma-h20',
  'gemma-h20-instant',
  'gemma-h20-thinking',
  'qwen3-4b-instruct',
  'qwen3-4b-thinking',
]

const TREE_CO2_KG_PER_YEAR = 20

function settingsPath(dshHome) {
  return path.join(dshHome, 'console-settings.json')
}

function loadSettings(dshHome) {
  try {
    // A BOM (some editors and PowerShell write one) would break JSON.parse.
    const parsed = JSON.parse(fs.readFileSync(settingsPath(dshHome), 'utf8').replace(/^\uFEFF/, ''))
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Render the home-level cordis patch from the current settings. */
function patchYaml(settings) {
  return `# Green DSH Desktop — generated from the console settings (do not hand-edit).
- insert:
    - id: green-meter
      name: '@deepseek-ai/dsh-green-meter'
      config:
        profile: ${settings.profile}
        carbonFactorKgPerKwh: ${settings.carbonFactorKgPerKwh}
        electricityPriceCnyPerKwh: ${settings.priceCnyPerKwh}
    - id: ui-green-meter
      name: '@deepseek-ai/dsh-client-ui-green-meter'
    - id: ui-green-dashboard
      name: '@green-dsh/dsh-client-ui-green-dashboard'
      config:
        cloudCarbonFactorKgPerKwh: ${settings.cloudCarbonFactorKgPerKwh}
        apiPriceCnyPerMInput: ${settings.apiPriceCnyPerMInput}
        apiPriceCnyPerMCached: ${settings.apiPriceCnyPerMCached}
        apiPriceCnyPerMOutput: ${settings.apiPriceCnyPerMOutput}
        priceCnyPerKwh: ${settings.priceCnyPerKwh}
        refreshMs: ${settings.refreshMs}
`
}

function writePatch(dshHome, settings) {
  fs.mkdirSync(dshHome, { recursive: true })
  fs.writeFileSync(path.join(dshHome, 'cordis.patch.yml'), patchYaml(settings), 'utf8')
}

function saveSettings(dshHome, partial) {
  const next = { ...loadSettings(dshHome), ...partial }
  // Materialize the chosen grid presets into the numeric factors the harness
  // (green-meter) and the estimator read, so one selection drives both.
  const localPreset = referenceData.GRID_FACTORS.find(entry => entry.id === next.localGridPreset)
  if (localPreset !== undefined) next.carbonFactorKgPerKwh = localPreset.kgPerKwh
  const cloudPreset = referenceData.GRID_FACTORS.find(entry => entry.id === next.cloudGridPreset)
  if (cloudPreset !== undefined) next.cloudCarbonFactorKgPerKwh = cloudPreset.kgPerKwh
  fs.writeFileSync(settingsPath(dshHome), JSON.stringify(next, null, 2) + '\n', 'utf8')
  writePatch(dshHome, next)
  return next
}

/** One accounted step (ledger row subset the console needs). */
function rowOf(raw) {
  return {
    ts: typeof raw.ts_wall === 'string' ? raw.ts_wall : null,
    sessionId: typeof raw.session_id === 'string' ? raw.session_id : '',
    turn: Number(raw.turn) || 0,
    step: Number(raw.step) || 0,
    inputTokens: Number(raw.input_tokens) || 0,
    cachedTokens: Number(raw.cached_read_tokens) || 0,
    outputTokens: Number(raw.output_tokens) || 0,
    reasoningTokens: Number(raw.reasoning_tokens) || 0,
    energyJ: Number(raw.energy_j) || 0,
    carbonG: Number(raw.carbon_g) || 0,
    profileId: typeof raw.profile_id === 'string' ? raw.profile_id : '',
    confidence: typeof raw.confidence === 'string' ? raw.confidence : '',
  }
}

/**
 * Fold the JSONL ledger into everything the console renders. Malformed and
 * foreign-schema lines are skipped, matching the plugin's read discipline.
 * @param {string} ledgerFile absolute ledger path.
 * @returns aggregation object (empty when the ledger is missing).
 */
function readLedger(ledgerFile) {
  const totals = {
    sessions: 0, requests: 0, inputTokens: 0, cachedTokens: 0,
    outputTokens: 0, reasoningTokens: 0, energyJ: 0, carbonG: 0,
  }
  const sessions = new Map()
  const daily = new Map()
  /** turn index → aggregate across every session (turn 1 = first round). */
  const turnTotals = new Map()
  /** session id → Map(turn → aggregate), for the per-session turn chart. */
  const sessionTurns = new Map()
  const recent = []
  const series = []
  let bytes = 0
  let text = ''
  try {
    // A leading BOM (some editors/tools write one) would break the first row's
    // JSON.parse and silently drop it.
    text = fs.readFileSync(ledgerFile, 'utf8').replace(/^\uFEFF/, '')
    bytes = Buffer.byteLength(text)
  } catch {
    return {
      exists: false, bytes: 0, totals, sessions: [], turnTotals: [], daily: [], recent: [], series,
      firstTs: null, lastTs: null, profiles: [],
    }
  }

  let firstTs = null
  let lastTs = null
  const profiles = new Set()
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let raw
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }
    if (raw === null || typeof raw !== 'object' || raw.schema_version !== 'dsh-green-meter.step.v1') continue
    const row = rowOf(raw)
    totals.requests += 1
    totals.inputTokens += row.inputTokens
    totals.cachedTokens += row.cachedTokens
    totals.outputTokens += row.outputTokens
    totals.reasoningTokens += row.reasoningTokens
    totals.energyJ += row.energyJ
    totals.carbonG += row.carbonG
    if (row.profileId !== '') profiles.add(row.profileId)

    const key = row.sessionId === '' ? '(unknown)' : row.sessionId
    const session = sessions.get(key) ?? {
      id: key, requests: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0,
      reasoningTokens: 0, energyJ: 0, carbonG: 0, firstTs: row.ts, lastTs: row.ts,
    }
    session.requests += 1
    session.inputTokens += row.inputTokens
    session.cachedTokens += row.cachedTokens
    session.outputTokens += row.outputTokens
    session.reasoningTokens += row.reasoningTokens
    session.energyJ += row.energyJ
    session.carbonG += row.carbonG
    if (row.ts !== null && (session.firstTs === null || row.ts < session.firstTs)) session.firstTs = row.ts
    if (row.ts !== null && (session.lastTs === null || row.ts > session.lastTs)) session.lastTs = row.ts
    sessions.set(key, session)

    const day = row.ts === null ? null : row.ts.slice(0, 10)
    if (day !== null) {
      const bucket = daily.get(day) ?? { day, requests: 0, energyJ: 0, carbonG: 0, inputTokens: 0, outputTokens: 0 }
      bucket.requests += 1
      bucket.energyJ += row.energyJ
      bucket.carbonG += row.carbonG
      bucket.inputTokens += row.inputTokens
      bucket.outputTokens += row.outputTokens
      daily.set(day, bucket)
    }
    if (row.ts !== null) {
      if (firstTs === null || row.ts < firstTs) firstTs = row.ts
      if (lastTs === null || row.ts > lastTs) lastTs = row.ts
    }

    // Per-turn aggregates (the task-round view): one entry per turn index
    // across all sessions, plus a per-session series for the selector.
    const turnEntry = turnTotals.get(row.turn) ?? {
      turn: row.turn, carbonG: 0, energyJ: 0, steps: 0, outputTokens: 0, sessions: new Set(),
    }
    turnEntry.carbonG += row.carbonG
    turnEntry.energyJ += row.energyJ
    turnEntry.steps += 1
    turnEntry.outputTokens += row.outputTokens + row.reasoningTokens
    turnEntry.sessions.add(key)
    turnTotals.set(row.turn, turnEntry)

    let perSession = sessionTurns.get(key)
    if (perSession === undefined) {
      perSession = new Map()
      sessionTurns.set(key, perSession)
    }
    const sessionTurn = perSession.get(row.turn) ?? { turn: row.turn, carbonG: 0, energyJ: 0, steps: 0 }
    sessionTurn.carbonG += row.carbonG
    sessionTurn.energyJ += row.energyJ
    sessionTurn.steps += 1
    perSession.set(row.turn, sessionTurn)

    recent.push(row)
    series.push({ ts: row.ts, energyJ: row.energyJ, carbonG: row.carbonG })
  }

  totals.sessions = sessions.size
  const sessionList = [...sessions.values()].sort((a, b) => (b.lastTs ?? '').localeCompare(a.lastTs ?? ''))
  // Per-session turn series only for the heaviest sessions, so a long-lived
  // ledger cannot bloat the snapshot.
  const heavy = new Set([...sessionList].sort((a, b) => b.carbonG - a.carbonG).slice(0, 40).map(session => session.id))
  return {
    exists: true,
    bytes,
    totals,
    sessions: sessionList.map(session => ({
      ...session,
      turns: heavy.has(session.id)
        ? [...(sessionTurns.get(session.id) ?? new Map()).values()].sort((a, b) => a.turn - b.turn)
        : [],
    })),
    turnTotals: [...turnTotals.values()]
      .map(entry => ({
        turn: entry.turn,
        carbonG: entry.carbonG,
        energyJ: entry.energyJ,
        steps: entry.steps,
        outputTokens: entry.outputTokens,
        sessions: entry.sessions.size,
      }))
      .sort((a, b) => a.turn - b.turn),
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-30),
    recent: recent.slice(-200).reverse(),
    series: series.slice(-120),
    firstTs,
    lastTs,
    profiles: [...profiles],
  }
}

/** Savings/cost math shared by every console surface. */
function derive(totals, settings, profile) {
  const kwh = totals.energyJ / 3_600_000
  const costCny = kwh * settings.priceCnyPerKwh
  const apiCostCny = totals.inputTokens * settings.apiPriceCnyPerMInput / 1_000_000
    + totals.cachedTokens * settings.apiPriceCnyPerMCached / 1_000_000
    + (totals.outputTokens + totals.reasoningTokens) * settings.apiPriceCnyPerMOutput / 1_000_000
  const cachePrefillJPerToken = profile?.prefillJPerToken ?? 0
  const cacheSavedJ = cachePrefillJPerToken * totals.cachedTokens
  const cacheSavedCarbonG = cacheSavedJ / 3_600_000 * settings.carbonFactorKgPerKwh * 1_000
  // Cloud side: a PUBLISHED token→energy fit (or per-request disclosure),
  // never this project's local calibration.
  const cloudGrid = referenceData.resolveGridFactor(settings, 'cloud')
  const cloud = referenceData.cloudEstimate(totals, settings, cloudGrid.kgPerKwh)
  return {
    kwh,
    costCny,
    apiCostCny,
    savedCny: apiCostCny - costCny,
    cacheSavedJ,
    cacheSavedCarbonG,
    trees: (totals.carbonG / 1_000) / TREE_CO2_KG_PER_YEAR,
    cloud,
  }
}

/** Load the green-meter calibration profile for the cache-savings coefficient. */
async function loadProfile(harnessRoot, profileKey) {
  try {
    const entry = pathToFileURL(path.join(
      harnessRoot, 'node_modules', '@deepseek-ai', 'dsh-green-meter', 'lib', 'index.js',
    )).href
    const mod = await import(entry)
    const resolved = mod.resolveProfile(profileKey)
    return {
      profileId: resolved.profileId,
      confidence: resolved.confidence,
      prefillJPerToken: resolved.prefillJPerToken,
    }
  } catch {
    return null
  }
}

function run(file, args, timeout = 5000) {
  // A .cmd/.bat override (or Windows builtins) must go through cmd.exe.
  const isScript = /\.(cmd|bat)$/i.test(file)
  const command = isScript ? 'cmd' : file
  const finalArgs = isScript ? ['/c', file, ...args] : args
  return new Promise((resolve) => {
    execFile(command, finalArgs, { timeout, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : String(stdout))
    })
  })
}

/** nvidia-smi command, overridable for machines where it is not on PATH. */
function nvidiaSmiCommand() {
  return process.env.GREEN_DSH_NVIDIA_SMI ?? 'nvidia-smi'
}

/** Adapter names (virtual display drivers filtered out) for the extension card. */
async function probeAdapters() {
  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Virtual|Idd|Oray|GameViewer|Todesk|Basic Display' } | Select-Object -ExpandProperty Name",
  ], 8000)
  if (out === null) return []
  return out.split('\n').map(value => value.trim()).filter(value => value !== '')
}

/**
 * Primary GPU path (NVIDIA): one entry per GPU with full telemetry — VRAM,
 * utilization, temperature and power all come from `nvidia-smi`.
 * @returns GPU array, or null when nvidia-smi is unavailable.
 */
async function probeNvidia() {
  const out = await run(nvidiaSmiCommand(), [
    '--query-gpu=index,name,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw,power.limit',
    '--format=csv,noheader,nounits',
  ], 4000)
  if (out === null) return null
  const num = value => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const gpus = []
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue
    const [index, name, memUsed, memTotal, util, temp, power, powerLimit] =
      line.split(',').map(value => value.trim())
    if (name === undefined || name === '') continue
    gpus.push({
      vendor: 'nvidia',
      index: num(index) ?? gpus.length,
      name,
      memUsedMB: num(memUsed),
      memTotalMB: num(memTotal),
      utilPct: num(util),
      tempC: num(temp),
      powerW: num(power),
      powerLimitW: num(powerLimit),
    })
  }
  return gpus.length === 0 ? null : gpus
}

/**
 * Extension path: WDDM GPU engine counters for any vendor (integrated GPUs,
 * AMD, or an NVIDIA card whose driver hides nvidia-smi). Utilization only —
 * no VRAM/temperature/power.
 */
async function probeWindowsGpu() {
  const out = await run('typeperf', ['\\GPU Engine(*)\\Utilization Percentage', '-sc', '2', '-si', '1'], 6000)
  if (out === null) return null
  const lines = out.split('\n').map(line => line.trim()).filter(line => line.startsWith('"'))
  if (lines.length < 2) return null
  const split = line => line.split('","').map(value => value.replace(/^"|"$/g, ''))
  // The first line maps column index → instance name (which carries the LUID);
  // the last line carries the second sample's values.
  const header = split(lines[0])
  const last = split(lines.at(-1))
  const perAdapter = new Map()
  for (let index = 1; index < header.length; index += 1) {
    const match = /luid_(0x[0-9a-f]+_0x[0-9a-f]+)/i.exec(header[index])
    if (match === null) continue
    const value = Number(last[index])
    // Some drivers report garbage (>100) on individual engine instances; a real
    // per-engine utilization is a percentage, so drop anything out of range.
    if (!Number.isFinite(value) || value < 0 || value > 100) continue
    const key = match[1].toLowerCase()
    perAdapter.set(key, (perAdapter.get(key) ?? 0) + value)
  }
  if (perAdapter.size === 0) return null
  return { utilPct: Math.min(100, Math.max(...perAdapter.values())) }
}

/**
 * Hardware sampler: CPU/RAM from Node every tick; NVIDIA GPUs are the primary
 * source (full telemetry), with the WDDM counter path kept as an extension for
 * machines without nvidia-smi.
 */
function createHardwareSampler() {
  const history = { cpu: [], mem: [], gpu: [] }
  const HISTORY = 90
  let cpuPrev = os.cpus().map(cpu => cpu.times)
  let nvidia = null
  let extension = null
  let adapters = []
  let gpuAt = 0
  let gpuBusy = false
  let timer = null
  let settle
  const firstProbe = new Promise(resolve => { settle = resolve })

  /** Resolve the pending first-probe promise once a GPU probe has landed. */
  function finishFirstProbe() {
    if (settle !== null) {
      const done = settle
      settle = null
      done()
    }
  }

  function cpuPercent() {
    const now = os.cpus().map(cpu => cpu.times)
    let idleDelta = 0
    let totalDelta = 0
    for (let index = 0; index < now.length; index += 1) {
      const prev = cpuPrev[index]
      const current = now[index]
      if (prev === undefined) continue
      const idle = current.idle - prev.idle
      const total = (current.user + current.nice + current.sys + current.idle + current.irq) -
        (prev.user + prev.nice + prev.sys + prev.idle + prev.irq)
      idleDelta += idle
      totalDelta += total
    }
    cpuPrev = now
    if (totalDelta <= 0) return 0
    return Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100))
  }

  function push(list, value) {
    list.push(value)
    if (list.length > HISTORY) list.shift()
  }

  function refreshGpu() {
    if (gpuBusy || Date.now() - gpuAt < 5000) return
    gpuBusy = true
    gpuAt = Date.now()
    void (async () => {
      try {
        const probed = await probeNvidia()
        if (probed !== null) {
          nvidia = probed
          extension = null
        } else {
          nvidia = null
          const generic = await probeWindowsGpu()
          extension = generic === null ? null : { ...generic, name: igpuName() }
        }
      } finally {
        gpuBusy = false
        finishFirstProbe()
      }
    })()
  }

  function igpuName() {
    const nvidiaName = nvidia?.[0]?.name
    return adapters.find(name => name !== nvidiaName) ?? adapters[0] ?? null
  }

  function tick() {
    const cpu = cpuPercent()
    const memPct = (1 - os.freemem() / os.totalmem()) * 100
    push(history.cpu, cpu)
    push(history.mem, memPct)
    const primary = nvidia?.[0] ?? null
    const primaryUtil = primary?.utilPct ?? extension?.utilPct ?? null
    if (primaryUtil !== null) push(history.gpu, primaryUtil)
    refreshGpu()
  }

  return {
    start() {
      if (timer !== null) return
      void (async () => { adapters = await probeAdapters() })()
      tick()
      timer = setInterval(tick, 1000)
    },
    stop() {
      if (timer !== null) clearInterval(timer)
      timer = null
    },
    /** Resolves once the first GPU probe has landed (or after the cap). */
    ready(timeoutMs = 6000) {
      return Promise.race([
        firstProbe,
        new Promise(resolve => setTimeout(resolve, timeoutMs)),
      ])
    },
    snapshot() {
      const primary = nvidia?.[0] ?? null
      const others = adapters.filter(name => name !== primary?.name)
      return {
        device: {
          cpuModel: os.cpus()[0]?.model?.trim() ?? 'CPU',
          cores: os.cpus().length,
          memTotalGB: os.totalmem() / 1_073_741_824,
          platform: `${os.platform()} ${os.arch()}`,
          host: os.hostname(),
        },
        /** NVIDIA GPUs (primary telemetry source); empty when unavailable. */
        nvidia: nvidia ?? [],
        /** First NVIDIA GPU, or null. */
        primary,
        /** Extension telemetry for a non-NVIDIA adapter (utilization only). */
        extension,
        /** Other display adapters (integrated/AMD), informational. */
        adapters: others,
        cpuPct: history.cpu.at(-1) ?? 0,
        memUsedGB: (os.totalmem() - os.freemem()) / 1_073_741_824,
        memTotalGB: os.totalmem() / 1_073_741_824,
        memPct: history.mem.at(-1) ?? 0,
        history: {
          cpu: [...history.cpu],
          mem: [...history.mem],
          gpu: [...history.gpu],
        },
      }
    },
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  PROFILE_KEYS,
  TREE_CO2_KG_PER_YEAR,
  createHardwareSampler,
  derive,
  loadProfile,
  loadSettings,
  probeAdapters,
  probeNvidia,
  probeWindowsGpu,
  readLedger,
  saveSettings,
  settingsPath,
  writePatch,
}
