/**
 * Green-meter ledger aggregation: folds the JSONL ledger (one row per
 * accounted step, schema dsh-green-meter.step.v1) into cross-session totals
 * for the dashboard's global section. Malformed and foreign-schema lines are
 * skipped, mirroring the plugin's own read-time discipline.
 */
'use strict'

const fs = require('node:fs')

/**
 * @param {string} file absolute ledger path
 * @returns {import('./ledger-types.js').GlobalTotals | null}
 */
function readGlobalTotals(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const sessions = new Set()
  const totals = {
    sessions: 0,
    requests: 0,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    energyJ: 0,
    carbonG: 0,
  }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row === null || typeof row !== 'object' || row.schema_version !== 'dsh-green-meter.step.v1') continue
    if (typeof row.session_id === 'string') sessions.add(row.session_id)
    totals.requests += 1
    totals.inputTokens += Number(row.input_tokens) || 0
    totals.cachedTokens += Number(row.cached_read_tokens) || 0
    totals.outputTokens += Number(row.output_tokens) || 0
    totals.reasoningTokens += Number(row.reasoning_tokens) || 0
    totals.energyJ += Number(row.energy_j) || 0
    totals.carbonG += Number(row.carbon_g) || 0
  }
  totals.sessions = sessions.size
  return totals
}

module.exports = { readGlobalTotals }
