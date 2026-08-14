/**
 * Plugin wiring test: command + tool registration and the full report/query
 * paths against a real ledger file, with minimal fake commands/tools services.
 * @module @deepseek-ai/dsh-green-meter/tests/plugin
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DEFAULT_CARBON_FACTOR_KG_PER_KWH } from '../src/profiles.ts'
import { LedgerWriter, SessionTracker } from '../src/ledger.ts'
import { apply, type GreenMeterConfig } from '../src/index.ts'

interface CapturedCommand {
  name: string
  description: string
  recordInput?: boolean
  handler: (invocation: unknown) => unknown
}

interface CapturedTool {
  name: string
  execute: (args: unknown, exec: unknown) => unknown
}

const tempDirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-green-meter-plugin-'))
  tempDirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

interface Mounted {
  root: Context
  commands: CapturedCommand[]
  tools: CapturedTool[]
}

function mount(config: GreenMeterConfig): Mounted {
  const root = new Context()
  const commands: CapturedCommand[] = []
  const tools: CapturedTool[] = []
  root.provide('commands', {
    register: (definition: CapturedCommand) => {
      commands.push(definition)
    },
  })
  root.provide('tools', {
    register: (tool: CapturedTool) => {
      tools.push(tool)
    },
  })
  apply(root, config)
  return { root, commands, tools }
}

async function seedLedger(dir: string): Promise<void> {
  const writer = new LedgerWriter(join(dir, 'ledger.jsonl'))
  const tracker = new SessionTracker('proxy', DEFAULT_CARBON_FACTOR_KG_PER_KWH)
  await writer.append(tracker.record('session-a', 1, 1, { inputTokens: 100, cacheReadTokens: 900, outputTokens: 50 })!)
  await writer.append(tracker.record('session-a', 2, 1, { outputTokens: 25 })!)
  await writer.append(tracker.record('session-b', 1, 1, { outputTokens: 999 })!)
  await writer.flush()
}

describe('plugin wiring', () => {
  test('registers the /green command without recording input', () => {
    const { commands, tools } = mount({ dir: join(tmpdir(), 'unused') })
    expect(commands).toHaveLength(1)
    expect(commands[0]!.name).toBe('green')
    expect(commands[0]!.recordInput).toBe(false)
    expect(commands[0]!.description.length).toBeGreaterThan(0)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('green_meter')
  })

  test('handler renders this session\'s ledger rows from the authoritative file', async () => {
    const dir = await tempDir()
    await seedLedger(dir)

    const { commands } = mount({ dir, profile: 'proxy', carbonFactorKgPerKwh: DEFAULT_CARBON_FACTOR_KG_PER_KWH })
    const handler = commands[0]!.handler
    const invocation = {
      commandId: 'cmd-1',
      agent: { session: { id: 'session-a' } },
      rawInput: '',
      signal: new AbortController().signal,
    }
    const result = await handler(invocation)
    expect(result).toMatchObject({ kind: 'success' })
    const text = (result as { text?: string }).text ?? ''
    expect(text).toContain('Green Meter')
    expect(text).toContain('session-a')
    expect(text).toContain('Requests       : 2')
    expect(text).not.toContain('session-b')
    expect(text).toContain('turn  1:')
    expect(text).toContain('Method boundary')
    expect(text).toContain('token-profile estimate')
  })

  test('handler reports the empty state for an unrecorded session', async () => {
    const dir = await tempDir()
    const { commands } = mount({ dir })
    const handler = commands[0]!.handler
    const result = await handler({
      commandId: 'cmd-2',
      agent: { session: { id: 'fresh-session' } },
      rawInput: '',
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ kind: 'success' })
    expect((result as { text?: string }).text).toContain('No model steps recorded')
  })

  test('green_meter tool answers session totals and budget status from the ledger', async () => {
    const dir = await tempDir()
    await seedLedger(dir)

    const { tools } = mount({ dir, budgetJ: 1_000_000 })
    const tool = tools[0]!
    const exec = { agent: { session: { id: 'session-a' } } }
    const value = await tool.execute({}, exec)
    expect(value).toMatchObject({
      session_id: 'session-a',
      method: 'token-profile-estimate',
      requests: 2,
      input_tokens: 100,
      output_tokens: 75,
      reasoning_tokens: 0,
    })
    const budget = (value as { budget?: { over_budget: boolean } }).budget
    expect(budget).toBeDefined()
    expect(budget!.over_budget).toBe(false)
  })

  test('green_meter tool errors without a calling agent session', async () => {
    const dir = await tempDir()
    const { tools } = mount({ dir })
    await expect(tools[0]!.execute({}, { agent: undefined })).rejects.toThrow('calling agent')
  })

  test('budget line appears in the report when a budget is configured', async () => {
    const dir = await tempDir()
    await seedLedger(dir)
    const { commands } = mount({ dir, budgetJ: 1 })
    const result = await commands[0]!.handler({
      commandId: 'cmd-3',
      agent: { session: { id: 'session-a' } },
      rawInput: '',
      signal: new AbortController().signal,
    })
    expect((result as { text?: string }).text).toContain('Budget')
  })

  test('config fallbacks keep defaults when environment values are absent', () => {
    const { commands } = mount({})
    expect(commands).toHaveLength(1)
  })
})
