/**
 * Tracker, ledger durability, and report rendering behavior.
 * @module @deepseek-ai/dsh-green-meter/tests/ledger
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { DEFAULT_CARBON_FACTOR_KG_PER_KWH, resolveProfile } from '../src/profiles.ts'
import {
  computeTotals,
  formatSessionReport,
  LedgerWriter,
  scanLedger,
  SessionTracker,
} from '../src/ledger.ts'

const tempDirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-green-meter-'))
  tempDirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const USAGE = { inputTokens: 100, cacheReadTokens: 900, outputTokens: 50, reasoningTokens: 10 }

describe('SessionTracker', () => {
  test('estimates per-request context from the request\'s own prompt and output', () => {
    const tracker = new SessionTracker('proxy', DEFAULT_CARBON_FACTOR_KG_PER_KWH)
    const first = tracker.record('s1', 1, 1, USAGE)!
    // This request's prompt surface (100 + 900) plus half its output (30).
    expect(first.context_tokens_est).toBe(1030)
    const second = tracker.record('s1', 1, 2, { outputTokens: 20 })!
    // A fresh request: no cached reads carry over, half of its own output only.
    expect(second.context_tokens_est).toBe(10)
    // A different session is independent by construction.
    const other = tracker.record('s2', 1, 1, { inputTokens: 10, outputTokens: 5 })!
    expect(other.context_tokens_est).toBe(12)
  })

  test('cached reads never accumulate across requests of one session', () => {
    const tracker = new SessionTracker('proxy', DEFAULT_CARBON_FACTOR_KG_PER_KWH)
    tracker.record('s1', 1, 1, { cacheReadTokens: 100_000, outputTokens: 10 })
    const next = tracker.record('s1', 1, 2, { cacheReadTokens: 100_000, outputTokens: 10 })!
    expect(next.context_tokens_est).toBe(100_005)
  })

  test('steps without billable tokens are skipped', () => {
    const tracker = new SessionTracker('proxy', DEFAULT_CARBON_FACTOR_KG_PER_KWH)
    expect(tracker.record('s1', 1, 1, {})).toBeNull()
    expect(tracker.record('s1', 1, 2, { inputTokens: 0, outputTokens: 0 })).toBeNull()
  })

  test('records carry schema, timestamps, and the selected profile', () => {
    const tracker = new SessionTracker('qwen3-4b-instruct', DEFAULT_CARBON_FACTOR_KG_PER_KWH)
    const record = tracker.record('s1', 2, 3, USAGE)!
    expect(record.schema_version).toBe('dsh-green-meter.step.v1')
    expect(record.method).toBe('token-profile-estimate')
    expect(record.profile_id).toBe('handoff-e2-instruct-v1')
    expect(record.confidence).toBe('measured-fit')
    expect(record.turn).toBe(2)
    expect(record.step).toBe(3)
    expect(record.energy_j).toBeGreaterThan(0)
    expect(record.carbon_g).toBeGreaterThan(0)
  })
})

describe('LedgerWriter and scanLedger', () => {
  test('append-only rows survive a write/read round trip and skip foreign lines', async () => {
    const dir = await tempDir()
    const path = join(dir, 'nested', 'ledger.jsonl')
    const writer = new LedgerWriter(path)
    const tracker = new SessionTracker('proxy', DEFAULT_CARBON_FACTOR_KG_PER_KWH)
    const record = tracker.record('s1', 1, 1, USAGE)!
    await writer.append(record)
    await writer.append(record)
    await writer.flush()
    const text = await readFile(path, 'utf8')
    expect(text.trim().split('\n')).toHaveLength(2)
    const rows = await scanLedger(path)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.session_id).toBe('s1')
  })

  test('scanLedger returns empty and ignores malformed lines', async () => {
    const dir = await tempDir()
    const path = join(dir, 'ledger.jsonl')
    await new LedgerWriter(path).append({ bogus: true } as never)
    expect(await scanLedger(join(dir, 'missing.jsonl'))).toEqual([])
    const rows = await scanLedger(path)
    expect(rows).toEqual([])
  })
})

describe('computeTotals and formatSessionReport', () => {
  function rows(): ReturnType<SessionTracker['record']>[] {
    const tracker = new SessionTracker('proxy', DEFAULT_CARBON_FACTOR_KG_PER_KWH)
    return [
      tracker.record('s1', 1, 1, USAGE),
      tracker.record('s1', 2, 1, { outputTokens: 25 }),
    ]
  }

  test('totals fold all accounted rows', () => {
    const records = rows().filter((row): row is NonNullable<typeof row> => row !== null)
    const totals = computeTotals(records)
    expect(totals.requests).toBe(2)
    expect(totals.inputTokens).toBe(100)
    expect(totals.cachedReadTokens).toBe(900)
    expect(totals.outputTokens).toBe(75)
    expect(totals.reasoningTokens).toBe(10)
    expect(totals.energyJ).toBeGreaterThan(0)
    expect(totals.carbonG).toBeGreaterThan(0)
  })

  test('report renders totals, per-turn breakdown, and the method boundary', () => {
    const records = rows().filter((row): row is NonNullable<typeof row> => row !== null)
    const report = formatSessionReport(records, 's1', resolveProfile('proxy'), DEFAULT_CARBON_FACTOR_KG_PER_KWH, 0, 0.56, '/tmp/l.jsonl')
    expect(report).toContain('Green Meter')
    expect(report).toContain('s1')
    expect(report).toContain('h20-proxy-v1')
    expect(report).toContain('proxy')
    expect(report).toContain('Fit quality    : 5125 requests')
    expect(report).toContain('Requests       : 2')
    expect(report).toContain('Est. cost      : ~¥')
    expect(report).toContain('(0.56 CNY/kWh)')
    expect(report).toContain('Energy per turn')
    expect(report).toContain('turn  1:')
    expect(report).toContain('Method boundary')
    expect(report).toContain('token-profile estimate')
    expect(report).not.toContain('Budget')
    // The seed rows carry 900 cached-read tokens: the counterfactual
    // cache-savings line must appear with the cached token count.
    expect(report).toContain('Cache savings')
    expect(report).toContain('900 cached tokens skipped prefill')
    expect(report).toContain('棵树一年的吸碳量')
  })

  test('report renders the budget line with status when a budget is set', () => {
    const records = rows().filter((row): row is NonNullable<typeof row> => row !== null)
    const totals = computeTotals(records)
    const over = formatSessionReport(records, 's1', resolveProfile('proxy'), DEFAULT_CARBON_FACTOR_KG_PER_KWH, 1, 0.56, '/tmp/l.jsonl')
    expect(over).toContain('Budget')
    expect(over).toContain('EXCEEDED (new steps rejected)')
    const under = formatSessionReport(records, 's1', resolveProfile('proxy'), DEFAULT_CARBON_FACTOR_KG_PER_KWH, totals.energyJ * 2, 0.56, '/tmp/l.jsonl')
    expect(under).toContain('50% used')
  })

  test('empty report explains the missing rows and keeps the boundary', () => {
    const report = formatSessionReport([], 's1', resolveProfile('proxy'), DEFAULT_CARBON_FACTOR_KG_PER_KWH, 0, 0.56, '/tmp/l.jsonl')
    expect(report).toContain('No model steps recorded')
    expect(report).toContain('Method boundary')
  })
})
