/**
 * Pure estimation math: the ported handoff-e2-v1 calibration must reproduce
 * the reference Python estimator's arithmetic exactly.
 * @module @deepseek-ai/dsh-green-meter/tests/estimator
 */

import { describe, expect, test } from 'vitest'
import { carbonGrams, estimateStep } from '../src/estimator.ts'
import { H20_PROXY_COEFFICIENTS } from '../src/h20-profiles.generated.ts'
import {
  CONTEXT_NORMALIZER_TOKENS,
  DEFAULT_CARBON_FACTOR_KG_PER_KWH,
  MODEL_PROFILES,
  resolveProfile,
  selectProfile,
} from '../src/profiles.ts'

const CARBON = DEFAULT_CARBON_FACTOR_KG_PER_KWH
const PROXY = MODEL_PROFILES.proxy

describe('carbonGrams', () => {
  test('one kWh is the factor in grams', () => {
    expect(carbonGrams(3_600_000, CARBON)).toBeCloseTo(577.7, 6)
  })

  test('zero and negative energy are non-negative carbon', () => {
    expect(carbonGrams(0, CARBON)).toBe(0)
    expect(carbonGrams(-5, CARBON)).toBe(0)
  })
})

describe('estimateStep', () => {
  test('zero tokens produce a zero-energy estimate', () => {
    const estimate = estimateStep({}, 0, PROXY, CARBON)
    expect(estimate.energyJ).toBe(0)
    expect(estimate.carbonG).toBe(0)
    expect(estimate.prefillJ).toBe(0)
    expect(estimate.decodeJ).toBe(0)
  })

  test('reproduces the Python reference formula at ctx = 32768', () => {
    // Reference (estimator.py): prefill_j = a * input; decode_j = (b + c) * decode.
    const profile = MODEL_PROFILES['qwen3-4b-instruct']
    const estimate = estimateStep(
      { inputTokens: 100, outputTokens: 50 },
      CONTEXT_NORMALIZER_TOKENS,
      profile,
      CARBON,
    )
    expect(estimate.prefillTokens).toBe(100)
    expect(estimate.decodeTokens).toBe(50)
    expect(estimate.prefillJ).toBeCloseTo(profile.prefillJPerToken * 100, 6)
    expect(estimate.decodeJ).toBeCloseTo(
      (profile.decodeBaseJPerToken + profile.decodeContextJPerToken) * 50, 6,
    )
    expect(estimate.energyJ).toBeCloseTo(estimate.prefillJ + estimate.decodeJ, 9)
    expect(estimate.carbonG).toBeCloseTo(estimate.energyJ / 3_600_000 * CARBON * 1000, 6)
    expect(estimate.confidence).toBe('measured-fit')
  })

  test('reasoning tokens are billed as decode work', () => {
    const profile = MODEL_PROFILES['qwen3-4b-thinking']
    const withReasoning = estimateStep({ outputTokens: 10, reasoningTokens: 20 }, 4096, profile, CARBON)
    const asOutput = estimateStep({ outputTokens: 30 }, 4096, profile, CARBON)
    expect(withReasoning.decodeTokens).toBe(30)
    expect(withReasoning.decodeJ).toBeCloseTo(asOutput.decodeJ, 9)
  })

  test('context rent raises decode cost with context length', () => {
    const profile = MODEL_PROFILES['qwen3-4b-instruct']
    const shortCtx = estimateStep({ outputTokens: 10 }, 1024, profile, CARBON)
    const longCtx = estimateStep({ outputTokens: 10 }, 32768, profile, CARBON)
    expect(longCtx.decodeJ).toBeGreaterThan(shortCtx.decodeJ)
    // At 32k vs 1k the per-token cost grows by c * (32 - 1) / 32 ≈ 2.13 J/token.
    expect(longCtx.decodeJ - shortCtx.decodeJ).toBeCloseTo(
      profile.decodeContextJPerToken * (32768 - 1024) / 32768 * 10, 6,
    )
  })

  test('context term caps at the calibration ceiling', () => {
    const profile = MODEL_PROFILES['qwen3-4b-instruct']
    const atCap = estimateStep({ outputTokens: 10 }, 65536, profile, CARBON)
    const beyondCap = estimateStep({ outputTokens: 10 }, 1_000_000, profile, CARBON)
    expect(beyondCap.decodeJ).toBeCloseTo(atCap.decodeJ, 9)
    expect(beyondCap.energyJ).toBeCloseTo(atCap.energyJ, 9)
  })

  test('negative inputs clamp to zero', () => {
    const estimate = estimateStep({ inputTokens: -3, outputTokens: -2 }, 0, PROXY, CARBON)
    expect(estimate.prefillTokens).toBe(0)
    expect(estimate.decodeTokens).toBe(0)
    expect(estimate.energyJ).toBe(0)
  })

  test('H20 profile reproduces the request-level NNLS formula', () => {
    const profile = MODEL_PROFILES['qwen-h20-instant']
    // Hand-checked against the fitted coefficients: a=0.1472796518,
    // b=8.8999022474, c=0.7736639824, ctx capped at 65536.
    const estimate = estimateStep(
      { inputTokens: 500, outputTokens: 100 },
      65536,
      profile,
      CARBON,
    )
    expect(estimate.prefillJ).toBeCloseTo(0.1472796518 * 500, 6)
    expect(estimate.decodeJ).toBeCloseTo(
      (8.8999022474 + 0.7736639824 * 2) * 100, 6,
    )
    expect(estimate.confidence).toBe('measured-fit')
    expect(profile.fit?.nRequests).toBe(1434)
  })
})

describe('resolveProfile', () => {
  test('known keys resolve to their fit, everything else to the proxy', () => {
    expect(resolveProfile('qwen3-4b-instruct').confidence).toBe('measured-fit')
    expect(resolveProfile('qwen3-4b-thinking').confidence).toBe('measured-fit')
    expect(resolveProfile('qwen-h20-instant').confidence).toBe('measured-fit')
    expect(resolveProfile('gemma-h20-thinking').confidence).toBe('measured-fit')
    expect(resolveProfile('deepseek-chat').profileId).toBe(PROXY.profileId)
    expect(resolveProfile(undefined).confidence).toBe('proxy')
  })

  test('proxy profile carries the H20 mean-of-fits coefficients', () => {
    expect(PROXY.profileId).toBe('h20-proxy-v1')
    expect(PROXY.prefillJPerToken).toBeCloseTo(H20_PROXY_COEFFICIENTS.a, 9)
    expect(PROXY.decodeBaseJPerToken).toBeCloseTo(H20_PROXY_COEFFICIENTS.b, 9)
    expect(PROXY.decodeContextJPerToken).toBeCloseTo(H20_PROXY_COEFFICIENTS.c, 9)
    expect(PROXY.fit?.nRequests).toBe(5125)
  })

  test('H20 proxy is the mean of the four per-config H20 fits', () => {
    const means = {
      a: (MODEL_PROFILES['qwen-h20-instant'].prefillJPerToken
        + MODEL_PROFILES['qwen-h20-thinking'].prefillJPerToken
        + MODEL_PROFILES['gemma-h20-instant'].prefillJPerToken
        + MODEL_PROFILES['gemma-h20-thinking'].prefillJPerToken) / 4,
      b: (MODEL_PROFILES['qwen-h20-instant'].decodeBaseJPerToken
        + MODEL_PROFILES['qwen-h20-thinking'].decodeBaseJPerToken
        + MODEL_PROFILES['gemma-h20-instant'].decodeBaseJPerToken
        + MODEL_PROFILES['gemma-h20-thinking'].decodeBaseJPerToken) / 4,
      c: (MODEL_PROFILES['qwen-h20-instant'].decodeContextJPerToken
        + MODEL_PROFILES['qwen-h20-thinking'].decodeContextJPerToken
        + MODEL_PROFILES['gemma-h20-instant'].decodeContextJPerToken
        + MODEL_PROFILES['gemma-h20-thinking'].decodeContextJPerToken) / 4,
    }
    expect(PROXY.prefillJPerToken).toBeCloseTo(means.a, 9)
    expect(PROXY.decodeBaseJPerToken).toBeCloseTo(means.b, 9)
    expect(PROXY.decodeContextJPerToken).toBeCloseTo(means.c, 9)
  })
})

describe('selectProfile', () => {
  test('keyword matching falls back to the proxy for unknown ids', () => {
    expect(selectProfile(undefined).profileId).toBe(PROXY.profileId)
    expect(selectProfile('qwen3.5-27b').profileId).toBe('h20-qwen-h20-v1')
    expect(selectProfile('gemma-4').profileId).toBe('h20-gemma-h20-v1')
    expect(selectProfile('qwen3-4b').profileId).toBe('handoff-e2-instruct-v1')
    expect(selectProfile('deepseek-chat').profileId).toBe(PROXY.profileId)
  })
})
