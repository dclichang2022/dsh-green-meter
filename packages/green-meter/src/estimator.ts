/**
 * Pure token-to-energy estimation: converts one model call's token accounting
 * into joules and grams CO2e using a calibrated {@link ModelProfile}.
 *
 * The token vocabulary mirrors the DSH `TokenUsage` split: input is uncached
 * prompt only, cached reads are reported separately, and reasoning tokens are
 * billed as decode work — the same disjoint accounting the handoff regression
 * was fitted against.
 *
 * @module @deepseek-ai/dsh-green-meter/estimator
 */

import {
  CONTEXT_CAP_TOKENS,
  CONTEXT_NORMALIZER_TOKENS,
  type ModelProfile,
} from './profiles.ts'

/** Disjoint token accounting of one model call (mirrors `TokenUsage`). */
export interface StepUsage {
  readonly inputTokens?: number
  readonly cacheReadTokens?: number
  readonly outputTokens?: number
  readonly reasoningTokens?: number
}

/** One estimated step: prefill/decode split, total energy, and carbon. */
export interface StepEstimate {
  readonly prefillTokens: number
  readonly decodeTokens: number
  readonly prefillJ: number
  readonly decodeJ: number
  readonly energyJ: number
  readonly carbonG: number
  readonly profileId: string
  readonly confidence: 'measured-fit' | 'proxy'
}

/** Convert joules to grams CO2e under a grid factor in kg CO2e per kWh. */
export function carbonGrams(energyJ: number, factorKgPerKwh: number): number {
  return Math.max(0, energyJ) / 3_600_000 * factorKgPerKwh * 1000
}

/**
 * Estimate one model call's energy and carbon.
 * @param usage - disjoint token accounting reported for the call.
 * @param contextTokensEst - estimated KV context length during decode.
 * @param profile - calibrated coefficient profile to apply.
 * @param carbonFactor - grid intensity in kg CO2e per kWh.
 * @returns phase-split energy and carbon estimate; all token inputs are
 * clamped to non-negative values.
 */
export function estimateStep(
  usage: StepUsage,
  contextTokensEst: number,
  profile: ModelProfile,
  carbonFactor: number,
): StepEstimate {
  const prefillTokens = Math.max(0, Math.trunc(usage.inputTokens ?? 0))
  const decodeTokens = Math.max(0, Math.trunc(usage.outputTokens ?? 0))
    + Math.max(0, Math.trunc(usage.reasoningTokens ?? 0))
  const contextTokens = Math.min(CONTEXT_CAP_TOKENS, Math.max(0, contextTokensEst))
  const prefillJ = profile.prefillJPerToken * prefillTokens
  const decodeJPerToken = profile.decodeBaseJPerToken
    + profile.decodeContextJPerToken * contextTokens / CONTEXT_NORMALIZER_TOKENS
  const decodeJ = decodeJPerToken * decodeTokens
  const energyJ = prefillJ + decodeJ
  return {
    prefillTokens,
    decodeTokens,
    prefillJ,
    decodeJ,
    energyJ,
    carbonG: carbonGrams(energyJ, carbonFactor),
    profileId: profile.profileId,
    confidence: profile.confidence,
  }
}
