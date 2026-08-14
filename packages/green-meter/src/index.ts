/**
 * Green Meter: token-profile energy and carbon estimation for agentic
 * sessions.
 *
 * The plugin observes durable `assistant/message` events, converts each
 * step's disjoint token accounting into joules and grams CO2e with the
 * calibrated `handoff-e2-v1` profiles, appends one row per accounted step to
 * a JSONL ledger under the Harness home, and registers the human-facing
 * `/green` slash command that renders the session report.
 *
 * This is an estimate-only path: it never touches hardware. When the
 * deployment also runs the vLLM green-meter plugin on the same host, its
 * measured ledger can be joined on session-scoped task tags later.
 *
 * @module @deepseek-ai/dsh-green-meter
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CARBON_FACTOR_KG_PER_KWH,
  DEFAULT_ELECTRICITY_PRICE_CNY_PER_KWH,
  PROFILE_KEYS,
  resolveProfile,
  type ProfileKey,
} from './profiles.ts'
import {
  computeTotals,
  formatSessionReport,
  LedgerWriter,
  scanLedger,
  SessionTracker,
} from './ledger.ts'
import { greenMeterProjectionDefinition } from './projection.ts'

export const name = 'green-meter'
export const inject = ['commands', 'tools']

/** Plugin row configuration; environment variables act as fallbacks. */
export interface GreenMeterConfig {
  /** Calibration profile key; unknown keys fall back to `proxy`. */
  readonly profile?: ProfileKey
  /** Grid carbon intensity in kg CO2e per kWh. */
  readonly carbonFactorKgPerKwh?: number
  /** Residential electricity price in CNY per kWh (China average default). */
  readonly electricityPriceCnyPerKwh?: number
  /** Ledger directory; defaults to `<DSH_HOME>/green-meter`. */
  readonly dir?: string
  /**
   * Session energy budget in joules; `0`/absent disables the guard. When a
   * session exceeds the budget, new steps are rejected at `agent/pre-step`
   * and one plugin-sourced warning is injected for the model to see.
   */
  readonly budgetJ?: number
}

function profileKeyFrom(config: GreenMeterConfig): ProfileKey {
  const fromConfig = config.profile
  const fromEnv = process.env.DSH_GREEN_PROFILE
  const candidate = fromConfig ?? fromEnv
  return (PROFILE_KEYS as readonly string[]).includes(candidate ?? '') ? candidate as ProfileKey : 'proxy'
}

function carbonFactorFrom(config: GreenMeterConfig): number {
  const fromEnv = process.env.DSH_GREEN_CARBON_FACTOR
  const value = config.carbonFactorKgPerKwh
    ?? (fromEnv === undefined ? undefined : Number(fromEnv))
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return DEFAULT_CARBON_FACTOR_KG_PER_KWH
  }
  return value
}

function electricityPriceFrom(config: GreenMeterConfig): number {
  const fromEnv = process.env.DSH_GREEN_PRICE_CNY
  const value = config.electricityPriceCnyPerKwh
    ?? (fromEnv === undefined ? undefined : Number(fromEnv))
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_ELECTRICITY_PRICE_CNY_PER_KWH
  }
  return value
}

function ledgerPathFrom(config: GreenMeterConfig): string {
  const dir = config.dir ?? process.env.DSH_GREEN_DIR
    ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'green-meter')
  return join(dir, 'ledger.jsonl')
}

function budgetFrom(config: GreenMeterConfig): number {
  const fromEnv = process.env.DSH_GREEN_BUDGET_J
  const value = config.budgetJ ?? (fromEnv === undefined ? undefined : Number(fromEnv))
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0
  return value
}

/** Canonical `green_meter` tool result: cumulative session estimate + budget. */
interface GreenQueryValue {
  readonly session_id: string
  readonly method: 'token-profile-estimate'
  readonly profile_id: string
  readonly confidence: 'measured-fit' | 'proxy'
  readonly requests: number
  readonly input_tokens: number
  readonly output_tokens: number
  readonly reasoning_tokens: number
  readonly energy_j: number
  readonly energy_kwh: number
  readonly carbon_g: number
  readonly cost_cny: number
  readonly price_cny_per_kwh: number
  readonly budget?: {
    readonly budget_j: number
    readonly remaining_j: number
    readonly over_budget: boolean
  }
}

/** Value-schema declaration for the `green_meter` tool output. */
const GREEN_QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    session_id: { type: 'string', required: true },
    method: { type: 'string', required: true },
    profile_id: { type: 'string', required: true },
    confidence: { type: 'string', required: true, enum: ['measured-fit', 'proxy'] },
    requests: { type: 'integer', required: true },
    input_tokens: { type: 'integer', required: true },
    output_tokens: { type: 'integer', required: true },
    reasoning_tokens: { type: 'integer', required: true },
    energy_j: { type: 'number', required: true },
    energy_kwh: { type: 'number', required: true },
    carbon_g: { type: 'number', required: true },
    cost_cny: { type: 'number', required: true },
    price_cny_per_kwh: { type: 'number', required: true },
    budget: {
      type: 'object',
      additionalProperties: false,
      properties: {
        budget_j: { type: 'number', required: true },
        remaining_j: { type: 'number', required: true },
        over_budget: { type: 'boolean', required: true },
      },
    },
  },
} as const

/**
 * Mount the green-meter plugin: session event accounting plus the `/green`
 * command. Monitoring failures are contained — they must never break the
 * agent loop, matching the vLLM plugin's fail-open discipline.
 */
export function apply(ctx: Context, config: GreenMeterConfig = {}): void {
  const profileKey = profileKeyFrom(config)
  const carbonFactor = carbonFactorFrom(config)
  const priceCnyPerKwh = electricityPriceFrom(config)
  const ledgerPath = ledgerPathFrom(config)
  const budgetJ = budgetFrom(config)
  const writer = new LedgerWriter(ledgerPath)
  const tracker = new SessionTracker(profileKey, carbonFactor)
  const energyTotals = new Map<string, number>()

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'assistant/message' || event.data.usage === undefined) return
    try {
      const record = tracker.record(session.id, event.data.turn, event.data.step, event.data.usage)
      if (record !== null) {
        energyTotals.set(session.id, (energyTotals.get(session.id) ?? 0) + record.energy_j)
        void writer.append(record)
      }
    } catch {
      // Monitoring must never break inference.
    }
  })

  // Live per-session energy/carbon readout for the Web widget. The unit child
  // activates only when a projection registry is composed, so headless
  // assemblies without the registry are unaffected.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(greenMeterProjectionDefinition(profileKey, carbonFactor, budgetJ, priceCnyPerKwh))
  })

  // Energy budget: reject new steps once the session exceeds the budget, and
  // inject one warning so the model (and the human) sees why the turn closed.
  if (budgetJ > 0) {
    const warned = new Set<string>()
    ctx.on('agent/pre-step', (payload, next) => {
      const used = energyTotals.get(payload.agent.session.id) ?? 0
      if (used <= budgetJ) return next()
      if (!warned.has(payload.agent.session.id)) {
        warned.add(payload.agent.session.id)
        try {
          payload.agent.inject(createUserMessage({
            content: [{
              type: 'text',
              text: `Green Meter: this session's estimated energy (${Math.round(used / 1000)} kJ) `
                + `has exceeded the configured budget (${Math.round(budgetJ / 1000)} kJ); `
                + 'new steps are rejected until the budget is raised or the session ends.',
            }],
            source: { kind: 'plugin', plugin: 'green-meter' },
          }))
        } catch {
          // The warning must never break the loop.
        }
      }
      return Promise.resolve({ kind: 'reject' as const })
    })
  }

  ctx.commands.register({
    name: 'green',
    description: 'show this session\'s estimated energy and carbon footprint',
    recordInput: false,
    handler: (invocation: CommandInvocation) => reportCommand(invocation, profileKey, carbonFactor, budgetJ, priceCnyPerKwh, ledgerPath),
  })

  ctx.tools.register(defineTool({
    name: 'green_meter',
    description: 'Query this session\'s estimated GPU energy and carbon footprint. Token-profile '
      + 'estimate from the green-meter calibration; no hardware measurement. Reports cumulative '
      + 'session totals plus the configured energy budget when one is set.',
    parameters: {},
    output: {
      schema: GREEN_QUERY_SCHEMA,
      render: (_args: unknown, value: GreenQueryValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute: (_args, exec: ToolRunContext) => toolQuery(exec, profileKey, budgetJ, priceCnyPerKwh, ledgerPath),
  }))

  ctx.effect(() => async () => {
    await writer.flush()
  })
}

/** Resolve the handler's session rows from the authoritative ledger. */
async function reportCommand(
  invocation: CommandInvocation,
  profileKey: ProfileKey,
  carbonFactor: number,
  budgetJ: number,
  priceCnyPerKwh: number,
  ledgerPath: string,
) {
  const sessionId = invocation.agent.session.id
  const rows = await scanLedger(ledgerPath)
  const sessionRows = rows.filter(row => row.session_id === sessionId)
  const text = formatSessionReport(sessionRows, sessionId, resolveProfile(profileKey), carbonFactor, budgetJ, priceCnyPerKwh, ledgerPath)
  return { kind: 'success' as const, text }
}

/** Resolve one `green_meter` tool call from the authoritative ledger. */
async function toolQuery(exec: ToolRunContext, profileKey: ProfileKey, budgetJ: number, priceCnyPerKwh: number, ledgerPath: string) {
  const sessionId = exec.agent?.session.id
  if (sessionId === undefined) {
    throw new Error('green_meter requires a calling agent session')
  }
  const rows = await scanLedger(ledgerPath)
  const totals = computeTotals(rows.filter(row => row.session_id === sessionId))
  const profile = resolveProfile(profileKey)
  const budget = budgetJ > 0
    ? {
      budget_j: budgetJ,
      remaining_j: Math.max(0, budgetJ - totals.energyJ),
      over_budget: totals.energyJ > budgetJ,
    }
    : undefined
  return {
    session_id: sessionId,
    method: 'token-profile-estimate',
    profile_id: profile.profileId,
    confidence: profile.confidence,
    requests: totals.requests,
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    reasoning_tokens: totals.reasoningTokens,
    energy_j: Math.round(totals.energyJ * 10_000) / 10_000,
    energy_kwh: totals.energyJ / 3_600_000,
    carbon_g: Math.round(totals.carbonG * 10_000) / 10_000,
    cost_cny: Math.round(totals.energyJ / 3_600_000 * priceCnyPerKwh * 10_000) / 10_000,
    price_cny_per_kwh: priceCnyPerKwh,
    ...budget === undefined ? {} : { budget },
  }
}

export {
  DEFAULT_CARBON_FACTOR_KG_PER_KWH,
  PROFILE_KEYS,
  resolveProfile,
  selectProfile,
  type ModelProfile,
  type ProfileFit,
  type ProfileKey,
} from './profiles.ts'
export {
  carbonGrams,
  estimateStep,
  type StepEstimate,
  type StepUsage,
} from './estimator.ts'
export {
  computeTotals,
  formatSessionReport,
  LedgerWriter,
  scanLedger,
  SessionTracker,
  type SessionTotals,
  type StepRecord,
} from './ledger.ts'
export type { GreenMeterProjection } from './types.ts'
