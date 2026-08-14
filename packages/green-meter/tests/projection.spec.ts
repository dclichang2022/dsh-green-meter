/**
 * Projection fold behavior: per-turn series merging, capping, and the
 * budget field passthrough.
 * @module @deepseek-ai/dsh-green-meter/tests/projection
 */

import { describe, expect, test } from 'vitest'
import { greenMeterProjectionDefinition } from '../src/projection.ts'
import { GREEN_METER_MAX_STEPS, GREEN_METER_MAX_TURNS } from '../src/types.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function assistant(turn: number, step: number, outputTokens: number, cacheReadTokens = 1000): SessionEvent {
  return {
    type: 'assistant/message',
    seq: turn * 100 + step,
    time: 1,
    turn,
    step,
    data: {
      turn,
      step,
      message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
      usage: { inputTokens: 0, outputTokens, cacheReadTokens },
    },
  } as unknown as SessionEvent
}

function fold(events: SessionEvent[], budgetJ = 0, priceCnyPerKwh = 0.56) {
  const unit = greenMeterProjectionDefinition('proxy', 0.5777, budgetJ, priceCnyPerKwh)
  let state: ReturnType<typeof unit.init> = unit.init()
  for (const event of events) state = unit.apply(state, event)
  return unit.view(state)!
}

describe('greenMeterProjectionDefinition', () => {
  test('non-billable events return the same state reference', () => {
    const unit = greenMeterProjectionDefinition('proxy', 0.5777)
    const start = unit.init()
    const after = unit.apply(start, { type: 'turn/start', seq: 1, time: 1, turn: 1, data: { turn: 1 } } as SessionEvent)
    expect(after).toBe(start)
  })

  test('per-turn series merges steps of one turn and opens new entries', () => {
    const meter = fold([assistant(1, 1, 10), assistant(1, 2, 20), assistant(2, 1, 30)])
    expect(meter.turns.map(turn => turn.turn)).toEqual([1, 2])
    expect(meter.turns[0]!.steps).toBe(2)
    expect(meter.turns[1]!.steps).toBe(1)
    expect(meter.energyJ).toBeGreaterThan(0)
    expect(meter.turns[0]!.energyJ + meter.turns[1]!.energyJ).toBeCloseTo(meter.energyJ, 2)
  })

  test('per-request series records every model call in (turn, step) order', () => {
    const meter = fold([assistant(1, 1, 10), assistant(1, 2, 20), assistant(2, 1, 30)])
    expect(meter.steps).toHaveLength(3)
    expect(meter.steps.map(s => [s.turn, s.step])).toEqual([[1, 1], [1, 2], [2, 1]])
    expect(meter.steps[0]!.outputTokens).toBe(10)
    expect(meter.steps[2]!.energyJ).toBeGreaterThan(meter.steps[0]!.energyJ)
    // Per-request energy sums to the session total (4-decimal rounding).
    const sum = meter.steps.reduce((acc, s) => acc + s.energyJ, 0)
    expect(sum).toBeCloseTo(meter.energyJ, 2)
  })

  test('request series caps at the most recent N calls', () => {
    const events = Array.from({ length: 130 }, (_, i) => assistant(Math.floor(i / 10) + 1, (i % 10) + 1, 10))
    const meter = fold(events)
    expect(meter.steps).toHaveLength(GREEN_METER_MAX_STEPS)
    expect(meter.steps.at(-1)!.turn).toBe(13)
    expect(meter.steps.at(-1)!.step).toBe(10)
  })

  test('cache savings are the counterfactual prefill cost of cached tokens', () => {
    // Each assistant event carries cacheReadTokens=1000 with the proxy
    // prefill coefficient a=0.1765512774.
    const meter = fold([assistant(1, 1, 10), assistant(1, 2, 20)])
    expect(meter.cachedTokens).toBe(2000)
    expect(meter.savedEnergyJ).toBeCloseTo(0.1765512774 * 2000, 3)
    expect(meter.savedCarbonG).toBeCloseTo(0.1765512774 * 2000 / 3_600_000 * 0.5777 * 1000, 3)
    // Without cache reads there is no savings line.
    const uncached = fold([assistant(1, 1, 10, 0)])
    expect(uncached.savedCarbonG).toBe(0)
    expect(uncached.cachedTokens).toBe(0)
  })

  test('series caps at the most recent N turns', () => {
    const events = Array.from({ length: GREEN_METER_MAX_TURNS + 10 }, (_, i) => assistant(i + 1, 1, 10))
    const meter = fold(events)
    expect(meter.turns).toHaveLength(GREEN_METER_MAX_TURNS)
    expect(meter.turns[0]!.turn).toBe(11)
    expect(meter.turns.at(-1)!.turn).toBe(GREEN_METER_MAX_TURNS + 10)
  })

  test('budget is carried into the view', () => {
    const meter = fold([assistant(1, 1, 10)], 500_000)
    expect(meter.budgetJ).toBe(500_000)
    const unbudgeted = fold([assistant(1, 1, 10)])
    expect(unbudgeted.budgetJ).toBe(0)
  })

  test('electricity cost follows the configured price', () => {
    const meter = fold([assistant(1, 1, 10)], 0, 0.56)
    expect(meter.priceCnyPerKwh).toBe(0.56)
    expect(meter.costCny).toBeCloseTo(meter.energyJ / 3_600_000 * 0.56, 3)
    const custom = fold([assistant(1, 1, 10)], 0, 0.8)
    expect(custom.costCny).toBeCloseTo(custom.energyJ / 3_600_000 * 0.8, 3)
  })
})
