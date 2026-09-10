/**
 * Alert engine: turn the ledger (and relay traffic) into early warnings about
 * expensive or wasteful usage. Two families:
 *
 *   - thresholds  — absolute caps the operator sets (session energy/cost,
 *                   hourly and daily cost, single-step cost)
 *   - anomalies   — statistical outliers and waste patterns: a step far above
 *                   the session's median (robust z-score), context thrash
 *                   (huge prompt, tiny output), cache-miss regressions, and
 *                   retry loops (many steps with no new output).
 *
 * Every alert carries its evidence (the numbers that triggered it), a severity
 * and a dedupe key; firing state is persisted so a restart does not spam.
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const SEVERITY_ORDER = { info: 0, warn: 1, critical: 2 }

/** Default rule configuration; the console settings override these. */
const DEFAULT_RULES = {
  /** Per-session energy cap, kJ (0 = off). */
  sessionEnergyKj: 0,
  /** Per-session API-equivalent cost cap, CNY (0 = off). */
  sessionCostCny: 0,
  /** Rolling 1-hour API-equivalent cost cap, CNY (0 = off). */
  hourlyCostCny: 0,
  /** Rolling 24-hour API-equivalent cost cap, CNY (0 = off). */
  dailyCostCny: 0,
  /** Robust z-score above which a step counts as an energy outlier (0 = off). */
  stepOutlierZ: 3.5,
  /** Minimum input:output token ratio that marks a wasteful step (0 = off). */
  contextThrashRatio: 40,
  /** Minimum steps in a row with < 16 output tokens to flag a retry loop (0 = off). */
  retryLoopSteps: 6,
  /** Cache-hit share below this (with enough cacheable tokens) warns (0 = off). */
  cacheHitFloor: 0.15,
  /** Cooldown per alert key, ms. */
  cooldownMs: 30 * 60 * 1000,
}

function alertsPath(dshHome) {
  return path.join(dshHome, 'alerts.jsonl')
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/** Median absolute deviation → robust sigma estimate. */
function robustSigma(values) {
  if (values.length < 4) return 0
  const center = median(values)
  const deviations = values.map(value => Math.abs(value - center))
  return 1.4826 * median(deviations)
}

function fmtCarbon(grams) {
  if (grams === 0) return '0 g'
  const abs = Math.abs(grams)
  if (abs < 1) return `${grams.toFixed(3)} g`
  if (abs < 1000) return `${grams.toFixed(1)} g`
  return `${(grams / 1000).toFixed(2)} kg`
}

function fmtEnergy(joules) {
  if (joules >= 1e6) return `${(joules / 1e6).toFixed(2)} MJ`
  if (joules >= 1e3) return `${(joules / 1e3).toFixed(1)} kJ`
  return `${joules.toFixed(1)} J`
}

function fmtCny(value) {
  const decimals = Math.abs(value) < 1 ? 4 : 2
  return `¥${value.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '')}`
}

/** API-equivalent cost of one row/session aggregate, CNY. */
function apiCostCny(entry, settings) {
  return entry.inputTokens * settings.apiPriceCnyPerMInput / 1e6
    + entry.cachedTokens * settings.apiPriceCnyPerMCached / 1e6
    + (entry.outputTokens + (entry.reasoningTokens ?? 0)) * settings.apiPriceCnyPerMOutput / 1e6
}

function localCostCny(energyJ, settings) {
  return energyJ / 3.6e6 * settings.priceCnyPerKwh
}

/**
 * Evaluate every rule against the current ledger snapshot.
 * @param {object} ledger readLedger() result.
 * @param {object} settings console settings.
 * @returns {{rules: object, alerts: object[], counts: object}}
 */
function evaluate(ledger, settings) {
  const rules = { ...DEFAULT_RULES, ...(settings.alertRules ?? {}) }
  const alerts = []
  const totals = ledger.totals

  const push = (alert) => { alerts.push({ ...alert, ts: new Date().toISOString() }) }

  // ── thresholds ────────────────────────────────────────────────────────────
  if (rules.sessionEnergyKj > 0) {
    for (const session of ledger.sessions) {
      const capJ = rules.sessionEnergyKj * 1000
      if (session.energyJ > capJ) {
        push({
          key: `session-energy:${session.id}`,
          rule: 'session-energy',
          severity: session.energyJ > capJ * 1.5 ? 'critical' : 'warn',
          title: '会话能耗超阈值',
          detail: `会话 ${session.id.slice(0, 16)}… 累计 ${fmtEnergy(session.energyJ)}，超过 ${rules.sessionEnergyKj} kJ 上限`,
          evidence: { sessionId: session.id, energyJ: session.energyJ, capJ },
        })
      }
    }
  }

  if (rules.sessionCostCny > 0) {
    for (const session of ledger.sessions) {
      const cost = apiCostCny(session, settings)
      if (cost > rules.sessionCostCny) {
        push({
          key: `session-cost:${session.id}`,
          rule: 'session-cost',
          severity: cost > rules.sessionCostCny * 2 ? 'critical' : 'warn',
          title: '会话费用超阈值',
          detail: `会话 ${session.id.slice(0, 16)}… API 等价费用 ${fmtCny(cost)}，超过 ${fmtCny(rules.sessionCostCny)} 上限`,
          evidence: { sessionId: session.id, costCny: cost, capCny: rules.sessionCostCny },
        })
      }
    }
  }

  if (rules.hourlyCostCny > 0 || rules.dailyCostCny > 0) {
    const now = Date.now()
    const windows = [
      { id: 'hourly', label: '近 1 小时', ms: 3600_000, cap: rules.hourlyCostCny },
      { id: 'daily', label: '近 24 小时', ms: 86_400_000, cap: rules.dailyCostCny },
    ]
    for (const window of windows) {
      if (window.cap <= 0) continue
      const cutoff = new Date(now - window.ms).toISOString()
      let cost = 0
      let energyJ = 0
      let count = 0
      for (const row of ledger.recent) {
        if (row.ts === null || row.ts < cutoff) continue
        cost += apiCostCny(row, settings)
        energyJ += row.energyJ
        count += 1
      }
      if (cost > window.cap) {
        push({
          key: `window-cost:${window.id}`,
          rule: 'window-cost',
          severity: cost > window.cap * 1.5 ? 'critical' : 'warn',
          title: `${window.label}费用超阈值`,
          detail: `${window.label} ${count} 步、${fmtEnergy(energyJ)}，API 等价费用 ${fmtCny(cost)}，超过 ${fmtCny(window.cap)} 上限`,
          evidence: { window: window.id, costCny: cost, capCny: window.cap, steps: count },
        })
      }
    }
  }

  // ── per-step anomalies ────────────────────────────────────────────────────
  const bySession = new Map()
  for (const row of ledger.recent) {
    const list = bySession.get(row.sessionId) ?? []
    list.push(row)
    bySession.set(row.sessionId, list)
  }

  if (rules.stepOutlierZ > 0) {
    for (const [sessionId, rows] of bySession) {
      if (rows.length < 6) continue
      const energies = rows.map(row => row.energyJ)
      const center = median(energies)
      const sigma = robustSigma(energies)
      if (sigma <= 0 || center <= 0) continue
      for (const row of rows.slice(0, 6)) {
        const z = (row.energyJ - center) / sigma
        if (z < rules.stepOutlierZ) continue
        push({
          key: `step-outlier:${sessionId}:${row.turn}.${row.step}`,
          rule: 'step-outlier',
          severity: z > rules.stepOutlierZ * 1.6 ? 'critical' : 'warn',
          title: '单步能耗异常偏高',
          detail: `会话 ${sessionId.slice(0, 16)}… 第 ${row.turn}.${row.step} 步 ${fmtEnergy(row.energyJ)}，`
            + `为该会话中位数 ${fmtEnergy(center)} 的 ${(row.energyJ / center).toFixed(1)} 倍（稳健 z=${z.toFixed(1)}）`,
          evidence: { sessionId, turn: row.turn, step: row.step, energyJ: row.energyJ, medianJ: center, z },
        })
      }
    }
  }

  if (rules.contextThrashRatio > 0) {
    for (const row of ledger.recent.slice(0, 20)) {
      const output = row.outputTokens + row.reasoningTokens
      if (output < 8) continue
      const ratio = (row.inputTokens + row.cachedTokens) / output
      if (ratio < rules.contextThrashRatio) continue
      push({
        key: `context-thrash:${row.sessionId}:${row.turn}.${row.step}`,
        rule: 'context-thrash',
        severity: 'info',
        title: '上下文重读偏高（低产出）',
        detail: `第 ${row.turn}.${row.step} 步输入 ${row.inputTokens + row.cachedTokens} token 仅产出 ${output} token（比值 ${ratio.toFixed(0)}:1）`
          + `，多为反复重读上下文，能耗利用率低`,
        evidence: { sessionId: row.sessionId, ratio, inputTokens: row.inputTokens + row.cachedTokens, outputTokens: output },
      })
    }
  }

  if (rules.retryLoopSteps > 0) {
    for (const [sessionId, rows] of bySession) {
      const ordered = [...rows].sort((left, right) => (left.turn - right.turn) || (left.step - right.step))
      let streak = 0
      let streakEnergy = 0
      for (const row of ordered) {
        const tiny = row.outputTokens + row.reasoningTokens < 16
        if (tiny) {
          streak += 1
          streakEnergy += row.energyJ
        } else {
          streak = 0
          streakEnergy = 0
        }
        if (streak === rules.retryLoopSteps) {
          push({
            key: `retry-loop:${sessionId}:${row.turn}`,
            rule: 'retry-loop',
            severity: 'warn',
            title: '疑似空转/重试循环',
            detail: `会话 ${sessionId.slice(0, 16)}… 连续 ${streak} 步输出不足 16 token，累计 ${fmtEnergy(streakEnergy)}`
              + `（${fmtCny(apiCostCny({ inputTokens: 0, cachedTokens: 0, outputTokens: 0, energyJ: streakEnergy }, settings))} 电费）`,
            evidence: { sessionId, steps: streak, energyJ: streakEnergy },
          })
          break
        }
      }
    }
  }

  if (rules.cacheHitFloor > 0 && totals.requests >= 10) {
    const cacheable = totals.inputTokens + totals.cachedTokens
    const hitRate = cacheable === 0 ? 1 : totals.cachedTokens / cacheable
    if (hitRate < rules.cacheHitFloor) {
      push({
        key: 'cache-hit-floor',
        rule: 'cache-hit-floor',
        severity: 'info',
        title: '前缀缓存命中率偏低',
        detail: `缓存命中率 ${(hitRate * 100).toFixed(1)}%，低于 ${(rules.cacheHitFloor * 100).toFixed(0)}%；`
          + `提示词前缀不稳定会重复 prefill，增加能耗`,
        evidence: { hitRate, cachedTokens: totals.cachedTokens, cacheable },
      })
    }
  }

  // ── relay-side spend (cloud traffic through a 中转站) ─────────────────────
  if (settings.relayEnabled === true && rules.dailyCostCny > 0 && ledger.relay !== undefined) {
    const relay = ledger.relay
    if (relay?.totals !== undefined && relay.totals.records > 0) {
      const costCny = relay.totals.costUsd * (Number(settings.usdToCny) || 7.2)
      // The relay reports an accumulated window; compare its daily average
      // against the same daily cap the ledger side uses.
      const days = Math.max(1, relay.byDay?.length ?? 1)
      const dailyAvg = costCny / days
      if (dailyAvg > rules.dailyCostCny) {
        push({
          key: 'relay-daily-cost',
          rule: 'relay-daily-cost',
          severity: dailyAvg > rules.dailyCostCny * 2 ? 'critical' : 'warn',
          title: '中转站日均花费偏高',
          detail: `中转站 ${days} 天累计 $${relay.totals.costUsd.toFixed(4)}（≈${fmtCny(costCny)}）、`
            + `${relay.totals.requests} 次请求，日均 ≈${fmtCny(dailyAvg)}，超过 ${fmtCny(rules.dailyCostCny)} 每日上限`,
          evidence: { costUsd: relay.totals.costUsd, days, dailyAvgCny: dailyAvg, capCny: rules.dailyCostCny },
        })
      }
    }
  }

  alerts.sort((left, right) => SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity])

  const counts = { total: alerts.length, critical: 0, warn: 0, info: 0 }
  for (const alert of alerts) counts[alert.severity] += 1
  return { rules, alerts, counts }
}

/** Append newly fired alerts (deduped by key within the cooldown) to the log. */
function persistNew(dshHome, alerts, cooldownMs) {
  let existing = []
  try {
    existing = fs.readFileSync(alertsPath(dshHome), 'utf8').replace(/^\uFEFF/, '')
      .split('\n').filter(line => line.trim() !== '')
      .map(line => { try { return JSON.parse(line) } catch { return null } })
      .filter(value => value !== null)
  } catch {
    existing = []
  }
  const lastByKey = new Map()
  for (const entry of existing) lastByKey.set(entry.key, Date.parse(entry.ts) || 0)
  const now = Date.now()
  const fresh = []
  for (const alert of alerts) {
    const last = lastByKey.get(alert.key) ?? 0
    if (now - last < cooldownMs) continue
    fresh.push(alert)
    lastByKey.set(alert.key, now)
  }
  if (fresh.length > 0) {
    fs.mkdirSync(dshHome, { recursive: true })
    fs.appendFileSync(alertsPath(dshHome), fresh.map(alert => JSON.stringify(alert)).join('\n') + '\n', 'utf8')
  }
  return fresh
}

/** Recent alert history for the console (newest first). */
function history(dshHome, limit = 100) {
  try {
    const lines = fs.readFileSync(alertsPath(dshHome), 'utf8').replace(/^\uFEFF/, '')
      .split('\n').filter(line => line.trim() !== '')
    return lines.slice(-limit).map(line => { try { return JSON.parse(line) } catch { return null } })
      .filter(value => value !== null).reverse()
  } catch {
    return []
  }
}

function clearHistory(dshHome) {
  try {
    fs.rmSync(alertsPath(dshHome), { force: true })
  } catch {
    // Nothing to clear.
  }
}

module.exports = {
  DEFAULT_RULES,
  alertsPath,
  apiCostCny,
  clearHistory,
  evaluate,
  history,
  localCostCny,
  persistNew,
}
