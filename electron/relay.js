/**
 * Relay connector: pull real usage and cost from an API relay (中转站) — the
 * user's own gateway or a public one (OpenRouter-compatible), so the console
 * can show cloud spend and derive energy/carbon for traffic that never touches
 * this machine's ledger.
 *
 * Two adapters:
 *   - `openrouter`  GET /api/v1/activity — last 30 days grouped by model,
 *                   each row carries usage (USD cost), requests and token counts.
 *   - `generic`     GET <url> — an array (or {data:[...]}) of records mapped by
 *                   the configured field names, for a self-hosted relay.
 *
 * Records are cached in memory and on disk (`$DSH_HOME/relay-cache.json`) so the
 * console keeps showing the last known figures while offline.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const POLL_MIN_MS = 60_000

function cachePath(dshHome) {
  return path.join(dshHome, 'relay-cache.json')
}

function loadCache(dshHome) {
  try {
    return JSON.parse(fs.readFileSync(cachePath(dshHome), 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

function saveCache(dshHome, cache) {
  try {
    fs.mkdirSync(dshHome, { recursive: true })
    fs.writeFileSync(cachePath(dshHome), JSON.stringify(cache, null, 2) + '\n', 'utf8')
  } catch {
    // A cache write failure must never break the console.
  }
}

/** Coerce one raw relay row into the console's record shape. */
function normalizeRecord(raw, fields) {
  const pick = (source, key) => {
    if (key === undefined || key === null || key === '') return undefined
    return key.split('.').reduce((value, part) => (value === null || value === undefined ? value : value[part]), source)
  }
  const num = value => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const date = pick(raw, fields.date)
  return {
    date: typeof date === 'string' ? date.slice(0, 10) : new Date().toISOString().slice(0, 10),
    model: String(pick(raw, fields.model) ?? 'unknown'),
    provider: String(pick(raw, fields.provider) ?? ''),
    requests: num(pick(raw, fields.requests)),
    inputTokens: num(pick(raw, fields.inputTokens)),
    outputTokens: num(pick(raw, fields.outputTokens)),
    reasoningTokens: num(pick(raw, fields.reasoningTokens)),
    costUsd: num(pick(raw, fields.costUsd)),
  }
}

/** Fold records into per-model / per-day / total aggregates. */
function aggregate(records) {
  const byModel = new Map()
  const byDay = new Map()
  const totals = { records: 0, requests: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 }
  for (const record of records) {
    totals.records += 1
    totals.requests += record.requests
    totals.inputTokens += record.inputTokens
    totals.outputTokens += record.outputTokens
    totals.reasoningTokens += record.reasoningTokens
    totals.costUsd += record.costUsd

    const model = byModel.get(record.model) ?? {
      model: record.model, provider: record.provider, requests: 0,
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0,
    }
    model.requests += record.requests
    model.inputTokens += record.inputTokens
    model.outputTokens += record.outputTokens
    model.reasoningTokens += record.reasoningTokens
    model.costUsd += record.costUsd
    byModel.set(record.model, model)

    const day = byDay.get(record.date) ?? { date: record.date, requests: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 }
    day.requests += record.requests
    day.costUsd += record.costUsd
    day.inputTokens += record.inputTokens
    day.outputTokens += record.outputTokens
    byDay.set(record.date, day)
  }
  return {
    totals,
    byModel: [...byModel.values()].sort((left, right) => right.costUsd - left.costUsd),
    byDay: [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date)),
  }
}

/** OpenRouter adapter: one GET, rows already carry cost and tokens. */
async function fetchOpenRouter(settings) {
  const base = (settings.relayBaseUrl ?? 'https://openrouter.ai/api').replace(/\/+$/, '')
  const response = await fetch(`${base}/v1/activity`, {
    headers: settings.relayApiKey === '' || settings.relayApiKey === undefined
      ? {}
      : { Authorization: `Bearer ${settings.relayApiKey}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`中转站返回 HTTP ${response.status}`)
  const body = await response.json()
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []
  return rows.map(row => normalizeRecord(row, {
    date: 'date',
    model: 'model',
    provider: 'provider_name',
    requests: 'requests',
    inputTokens: 'prompt_tokens',
    outputTokens: 'completion_tokens',
    reasoningTokens: 'reasoning_tokens',
    costUsd: 'usage',
  }))
}

/** Generic adapter: user-mapped fields, array or {data:[...]}. */
async function fetchGeneric(settings) {
  const url = settings.relayBaseUrl
  if (url === '' || url === undefined) throw new Error('未配置中转站地址')
  const response = await fetch(url, {
    headers: settings.relayApiKey === '' || settings.relayApiKey === undefined
      ? {}
      : { Authorization: `Bearer ${settings.relayApiKey}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`中转站返回 HTTP ${response.status}`)
  const body = await response.json()
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []
  const fields = {
    date: settings.relayFieldDate ?? 'date',
    model: settings.relayFieldModel ?? 'model',
    provider: settings.relayFieldProvider ?? 'provider',
    requests: settings.relayFieldRequests ?? 'requests',
    inputTokens: settings.relayFieldInputTokens ?? 'input_tokens',
    outputTokens: settings.relayFieldOutputTokens ?? 'output_tokens',
    reasoningTokens: settings.relayFieldReasoningTokens ?? 'reasoning_tokens',
    costUsd: settings.relayFieldCostUsd ?? 'cost_usd',
  }
  return rows.map(row => normalizeRecord(row, fields))
}

/**
 * Relay poller: keeps a cached snapshot and refreshes on demand or on the
 * configured interval. `status` carries the last error so the console can show
 * why a source is stale.
 */
function createRelayConnector({ dshHome, getSettings, onUpdate }) {
  let records = []
  let status = { state: 'idle', at: null, error: null, adapter: null, url: '' }
  let timer = null
  let busy = false

  const cached = loadCache(dshHome)
  if (cached !== null && Array.isArray(cached.records)) {
    records = cached.records
    status = { ...status, ...(cached.status ?? {}), state: 'cached' }
  }

  async function refresh() {
    const settings = getSettings()
    if (settings.relayEnabled !== true) {
      status = { ...status, state: 'disabled', error: null }
      return snapshot()
    }
    if (busy) return snapshot()
    busy = true
    try {
      const adapter = settings.relayAdapter ?? 'openrouter'
      const fetched = adapter === 'openrouter' ? await fetchOpenRouter(settings) : await fetchGeneric(settings)
      records = fetched
      status = {
        state: 'ok',
        at: new Date().toISOString(),
        error: null,
        adapter,
        url: settings.relayBaseUrl ?? '',
      }
      saveCache(dshHome, { records, status })
      if (onUpdate !== undefined) onUpdate()
    } catch (error) {
      status = {
        ...status,
        state: records.length === 0 ? 'error' : 'stale',
        error: String(error?.message ?? error),
        adapter: settings.relayAdapter ?? 'openrouter',
        url: settings.relayBaseUrl ?? '',
      }
    } finally {
      busy = false
    }
    return snapshot()
  }

  function snapshot() {
    const settings = getSettings()
    const aggregated = aggregate(records)
    return {
      enabled: settings.relayEnabled === true,
      adapter: settings.relayAdapter ?? 'openrouter',
      baseUrl: settings.relayBaseUrl ?? '',
      status,
      ...aggregated,
    }
  }

  return {
    refresh,
    snapshot,
    start() {
      if (timer !== null) return
      void refresh()
      const interval = Math.max(POLL_MIN_MS, Number(getSettings().relayPollMs) || 300_000)
      timer = setInterval(() => { void refresh() }, interval)
    },
    stop() {
      if (timer !== null) clearInterval(timer)
      timer = null
    },
  }
}

module.exports = { aggregate, createRelayConnector, normalizeRecord }
