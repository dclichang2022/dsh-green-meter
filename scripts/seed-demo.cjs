/**
 * Seed the DEV harness home with a realistic demo ledger for README screenshots:
 * several sessions across three days, a couple of alert-triggering patterns
 * (context thrash, retry loop, low cache hit), cached hits for the savings row.
 */
const fs = require('node:fs')
const path = require('node:path')

const home = path.join(__dirname, '..', 'resources', 'harness', 'dsh-home')
const ledger = path.join(home, 'green-meter', 'ledger.jsonl')

// [dayOffset, hh:mm:ss, sessionId, turn, step, input, cached, output, reasoning]
const rows = [
  // Session A — a normal coding task, three turns, growing context, cache hits.
  [-2, '10:12:03', 'session-atlas-c0de', 1, 1, 8200, 0, 49, 0],
  [-2, '10:13:40', 'session-atlas-c0de', 1, 2, 0, 8400, 210, 0],
  [-2, '10:16:02', 'session-atlas-c0de', 2, 1, 1200, 9100, 320, 64],
  [-1, '09:41:17', 'session-atlas-c0de', 3, 1, 600, 10600, 410, 96],
  // Session B — heavy context re-read: 60k in, 30 out (context-thrash alert).
  [-1, '15:02:44', 'session-boreas-77f2', 1, 1, 60000, 0, 30, 0],
  [-1, '15:05:21', 'session-boreas-77f2', 2, 1, 63500, 1200, 42, 0],
  // Session C — retry loop: six steps in a row with tiny output.
  [0, '11:20:05', 'session-cirrus-a31b', 1, 1, 14800, 0, 6, 0],
  [0, '11:20:52', 'session-cirrus-a31b', 1, 2, 14900, 0, 4, 0],
  [0, '11:21:30', 'session-cirrus-a31b', 1, 3, 15000, 0, 8, 0],
  [0, '11:22:09', 'session-cirrus-a31b', 1, 4, 15100, 0, 3, 0],
  [0, '11:22:47', 'session-cirrus-a31b', 1, 5, 15200, 0, 9, 0],
  [0, '11:23:25', 'session-cirrus-a31b', 1, 6, 15300, 0, 5, 0],
  // Session D — today, a fresh short task (also feeds the per-turn chart).
  [0, '14:08:11', 'session-delta-9c4e', 1, 1, 5400, 0, 120, 0],
  [0, '14:10:39', 'session-delta-9c4e', 2, 1, 900, 5600, 260, 40],
]

// green-meter proxy profile: a = 0.1765512774 J/token (prefill), b = 8.9,
// c = 0.77 per 32k context for decode. Carbon = kWh × 0.5777 kg/kWh.
const A = 0.1765512774
const energy = (input, cached, output, reasoning) => {
  const uncached = input
  const context = Math.min(input + cached + Math.floor((output + reasoning) / 2), 65536)
  return A * uncached + (8.9 + 0.77 * (context / 32768)) * (output + reasoning)
}

const lines = rows.map(([day, time, sessionId, turn, step, input, cached, output, reasoning]) => {
  const ts = new Date(Date.now() + day * 86400_000)
  const date = ts.toISOString().slice(0, 10)
  const energyJ = energy(input, cached, output, reasoning)
  const carbonG = energyJ / 3.6e6 * 0.5777 * 1000
  return JSON.stringify({
    schema_version: 'dsh-green-meter.step.v1',
    ts_wall: `${date}T${time}.000Z`,
    session_id: sessionId,
    turn, step,
    input_tokens: input,
    cached_read_tokens: cached,
    output_tokens: output,
    reasoning_tokens: reasoning,
    context_tokens_est: input + cached,
    energy_j: Math.round(energyJ * 10000) / 10000,
    carbon_g: Math.round(carbonG * 10000) / 10000,
    profile_id: 'h20-proxy-v1',
    confidence: 'proxy',
    method: 'token-profile-estimate',
  })
})

fs.mkdirSync(path.dirname(ledger), { recursive: true })
fs.writeFileSync(ledger, lines.join('\n') + '\n', 'utf8')
console.log(`seeded ${lines.length} rows -> ${ledger}`)

// Demo relay settings so the 数据源 page shows a live connection.
const settings = {
  profile: 'proxy',
  carbonFactorKgPerKwh: 0.5777,
  cloudCarbonFactorKgPerKwh: 0.3497,
  localGridPreset: 'cn-2024',
  cloudGridPreset: 'us-2023',
  cloudModelId: 'epoch-2025-output-token',
  cloudPue: 1.1,
  cloudEstimateEnabled: true,
  apiPriceCnyPerMInput: 2.0,
  apiPriceCnyPerMCached: 0.5,
  apiPriceCnyPerMOutput: 8.0,
  priceCnyPerKwh: 0.56,
  refreshMs: 5000,
  usdToCny: 7.2,
  relayEnabled: true,
  relayAdapter: 'openrouter',
  relayBaseUrl: 'http://127.0.0.1:8799/api',
  relayApiKey: '',
  relayPollMs: 300000,
  alertRules: { sessionCostCny: 1, hourlyCostCny: 0.5, dailyCostCny: 2 },
}
fs.writeFileSync(path.join(home, 'console-settings.json'), JSON.stringify(settings, null, 2) + '\n', 'utf8')
console.log('wrote demo console-settings.json (relay on, alert thresholds on)')
