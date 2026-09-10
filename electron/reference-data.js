/**
 * Reference data layer: every coefficient the console uses carries a source,
 * a year and a confidence tier, so no number in the UI is an unexplained
 * default. Three tiers, strongest first:
 *
 *   1. `measured-local`  — this machine's own calibration runs (see calibration.js)
 *   2. `measured-lab`    — the LLM Powermeter H20 / RTX 3090 fits that ship with
 *                          the green-meter plugin
 *   3. `published`       — public figures with a citable source (MEE grid
 *                          factors, EPA eGRID, Google's per-prompt disclosure)
 *
 * Custom values entered in the console settings override any tier.
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** Grid carbon intensity presets, kg CO2e per kWh. */
const GRID_FACTORS = [
  {
    id: 'cn-2024',
    region: '中国',
    label: '全国平均（2024）',
    kgPerKwh: 0.5777,
    year: 2024,
    source: '生态环境部《2024 年电力碳足迹因子》',
    url: 'https://www.mee.gov.cn/',
    note: '较 2023 年 0.6205 kgCO₂e/kWh 下降 6.9%',
  },
  {
    id: 'cn-2023',
    region: '中国',
    label: '全国平均（2023）',
    kgPerKwh: 0.6205,
    year: 2023,
    source: '生态环境部 2023 年电力碳足迹因子',
    url: 'https://www.mee.gov.cn/',
    note: '',
  },
  {
    id: 'us-2023',
    region: '美国',
    label: '全国平均（eGRID 2023）',
    kgPerKwh: 0.3497,
    year: 2023,
    source: 'US EPA eGRID 2023（770.884 lb CO₂e/MWh）',
    url: 'https://www.epa.gov/egrid/summary-data',
    note: '',
  },
]

/**
 * Cloud-side estimation models. The cloud path only ever sees token counts, so
 * the token→energy relation comes from PUBLISHED fits — never from this
 * project's local calibration (that fits local serving hardware, not a
 * provider's fleet).
 *
 * Two published models ship:
 *   - `epoch-2025-output-token` — 0.0006 Wh per output token (marginal decode
 *     energy for frontier-class inference, IT energy before PUE). This is the
 *     per-token fit; Epoch's headline 0.3 Wh/query is this value × 500 output
 *     tokens.
 *   - `google-2025-prompt` — 0.24 Wh / 0.03 g CO2e per median Gemini text
 *     prompt (Google's own disclosure, per request).
 *
 * The two agree in magnitude (0.3 Wh ≈ 0.24 Wh per query), which is why they
 * are offered side by side.
 */
const CLOUD_MODELS = [
  {
    id: 'epoch-2025-output-token',
    label: 'Epoch AI 2025 · 0.0006 Wh / 输出 token',
    unit: 'per-output-token',
    whPerOutputToken: 0.0006,
    defaultPue: 1.1,
    year: 2025,
    source: 'Epoch AI（2025）：frontier 级推理输出 token 边际能耗；经 GreenCalculus 方法学整理',
    url: 'https://greencalculus.com/methodology/ai-search-query-methodology/',
    note: 'IT 能耗口径（未含 PUE，控制台默认乘 1.1）；0.3 Wh/查询 = 该值 × 500 输出 token',
  },
  {
    id: 'google-2025-prompt',
    label: 'Google 2025 · 0.24 Wh / 0.03 g CO₂e 每请求',
    unit: 'per-request',
    whPerRequest: 0.24,
    gCo2ePerRequest: 0.03,
    waterMlPerRequest: 0.26,
    year: 2025,
    source: 'Google Cloud（Vahdat & Dean，2025-08-21）：Gemini 中位文本 prompt',
    url: 'https://cloud.google.com/blog/products/infrastructure/measuring-the-environmental-impact-of-ai-inference',
    note: '官方中位数；per-request 口径，直接与请求数相乘',
  },
]

/**
 * green-meter's own lab fits (measured on real GPUs). Coefficients are the
 * plugin's NNLS request-level fits: E = a·uncached_prefill + (b + c·ctx/32768)·decode.
 */
const LAB_PROFILES = [
  {
    id: 'qwen-h20-instant',
    label: 'Qwen3.5-27B · H20（instant）',
    a: 0.1472796518, b: 8.8999022474, c: 0.7736639824,
    nRequests: 1434, r2: 0.999596, medianRelErr: 0.028229,
    source: 'LLM Powermeter：H20 请求级 NNLS 拟合（5125 条请求）',
  },
  {
    id: 'qwen-h20-thinking',
    label: 'Qwen3.5-27B · H20（thinking）',
    a: 0.1434396374, b: 8.7922757907, c: 0.8881486801,
    nRequests: 1301, r2: 0.999739, medianRelErr: 0.026014,
    source: 'LLM Powermeter：H20 请求级 NNLS 拟合（5125 条请求）',
  },
  {
    id: 'gemma-h20-instant',
    label: 'Gemma-4-31B-it · H20（instant）',
    a: 0.2061794517, b: 10.5588686730, c: 1.3962853656,
    nRequests: 1202, r2: 0.998300, medianRelErr: 0.024305,
    source: 'LLM Powermeter：H20 请求级 NNLS 拟合（5125 条请求）',
  },
  {
    id: 'gemma-h20-thinking',
    label: 'Gemma-4-31B-it · H20（thinking）',
    a: 0.2093063688, b: 10.6376018484, c: 1.2931363736,
    nRequests: 1188, r2: 0.999427, medianRelErr: 0.012332,
    source: 'LLM Powermeter：H20 请求级 NNLS 拟合（5125 条请求）',
  },
  {
    id: 'qwen3-4b-instruct',
    label: 'Qwen3-4B · RTX 3090（instruct）',
    a: 0.0703270418813685, b: 0, c: 0,
    nRequests: 0, r2: 0, medianRelErr: 0,
    source: 'LLM Powermeter：RTX 3090 拟合（handoff-e2）',
  },
  {
    id: 'qwen3-4b-thinking',
    label: 'Qwen3-4B · RTX 3090（thinking）',
    a: 0.0705920988523323, b: 0, c: 0,
    nRequests: 0, r2: 0, medianRelErr: 0,
    source: 'LLM Powermeter：RTX 3090 拟合（handoff-e2）',
  },
]

/** Measured-profile store: `$DSH_HOME/measured-profiles.json`. */
function measuredProfilesPath(dshHome) {
  return path.join(dshHome, 'measured-profiles.json')
}

function loadMeasuredProfiles(dshHome) {
  try {
    const parsed = JSON.parse(fs.readFileSync(measuredProfilesPath(dshHome), 'utf8').replace(/^\uFEFF/, ''))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveMeasuredProfiles(dshHome, profiles) {
  fs.mkdirSync(dshHome, { recursive: true })
  fs.writeFileSync(measuredProfilesPath(dshHome), JSON.stringify(profiles, null, 2) + '\n', 'utf8')
  return profiles
}

function appendMeasuredProfile(dshHome, profile) {
  const profiles = loadMeasuredProfiles(dshHome)
  profiles.unshift(profile)
  return saveMeasuredProfiles(dshHome, profiles.slice(0, 50))
}

/** Resolve the grid factor for one side of the comparison (preset wins; a
 * manual value applies only when the selection is `custom`). */
function resolveGridFactor(settings, side) {
  const presetId = side === 'cloud' ? settings.cloudGridPreset : settings.localGridPreset
  const preset = GRID_FACTORS.find(entry => entry.id === presetId)
  if (preset !== undefined) {
    return { kgPerKwh: preset.kgPerKwh, tier: 'published', source: preset.source, year: preset.year, label: preset.label, id: preset.id }
  }
  const custom = side === 'cloud' ? settings.cloudCarbonFactorKgPerKwh : settings.carbonFactorKgPerKwh
  return {
    kgPerKwh: Number(custom ?? (side === 'cloud' ? 0.4 : 0.5777)),
    tier: 'custom',
    source: '控制台设置',
    year: new Date().getFullYear(),
    label: '自定义',
    id: 'custom',
  }
}

/** The cloud model selected in settings (default: the per-token fit). */
function resolveCloudModel(settings) {
  const model = CLOUD_MODELS.find(entry => entry.id === settings.cloudModelId) ?? CLOUD_MODELS[0]
  return { ...model, pue: Number(settings.cloudPue ?? model.defaultPue ?? 1.1) }
}

/**
 * Cloud energy/carbon estimate for one token mix, from the selected published
 * model. Returns null when cloud estimation is switched off.
 *
 * @param {{requests:number,inputTokens:number,cachedTokens:number,outputTokens:number,reasoningTokens:number}} totals
 * @param {object} settings console settings.
 * @param {number} cloudGridFactorKgPerKwh grid intensity attributed to the provider.
 */
function cloudEstimate(totals, settings, cloudGridFactorKgPerKwh) {
  if (settings.cloudEstimateEnabled === false) return null
  const model = resolveCloudModel(settings)
  let energyJ = 0
  let carbonG = 0
  let waterMl = 0

  if (model.unit === 'per-output-token') {
    const outputTokens = totals.outputTokens + (totals.reasoningTokens ?? 0)
    energyJ = outputTokens * model.whPerOutputToken * 3600 * model.pue
    carbonG = energyJ / 3.6e6 * cloudGridFactorKgPerKwh * 1000
  } else {
    energyJ = totals.requests * model.whPerRequest * 3600
    carbonG = totals.requests * model.gCo2ePerRequest
    waterMl = totals.requests * (model.waterMlPerRequest ?? 0)
  }

  return { model, energyJ, carbonG, waterMl }
}

/** Everything the 参考数据 page renders, with tiers and citations. */
function referenceCatalog(dshHome) {
  return {
    gridFactors: GRID_FACTORS,
    cloudModels: CLOUD_MODELS,
    localProfiles: LAB_PROFILES,
    measuredProfiles: loadMeasuredProfiles(dshHome),
  }
}

module.exports = {
  CLOUD_MODELS,
  GRID_FACTORS,
  LAB_PROFILES,
  appendMeasuredProfile,
  cloudEstimate,
  loadMeasuredProfiles,
  measuredProfilesPath,
  referenceCatalog,
  resolveCloudModel,
  resolveGridFactor,
  saveMeasuredProfiles,
}
