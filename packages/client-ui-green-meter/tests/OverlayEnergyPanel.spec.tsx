// @vitest-environment jsdom
/**
 * OverlayEnergyPanel presentation behavior: the closed/absent states render
 * nothing; the open state renders the drawer with the shared-store snapshot;
 * close dispatches the shared store action.
 * @module @deepseek-ai/dsh-client-ui-green-meter/tests/OverlayEnergyPanel
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OverlayEnergyPanel, type OverlayEnergyPanelProps } from '../src/client/OverlayEnergyPanel.tsx'
import type { GreenMeterProjection, GreenMeterTurn } from 'dsh-green-meter/client'
import { zh, type GreenMeterKey } from '../src/client/locales.ts'

afterEach(cleanup)

function t(key: GreenMeterKey, values?: Record<string, string>): string {
  let template = zh[key]
  for (const [name, value] of Object.entries(values ?? {})) {
    template = template.replace(`{${name}}`, value)
  }
  return template
}

function meter(): GreenMeterProjection {
  const turns: GreenMeterTurn[] = [
    { turn: 1, steps: 2, energyJ: 500, carbonG: 0.08 },
    { turn: 2, steps: 1, energyJ: 1023.4, carbonG: 0.16 },
  ]
  return {
    requests: 3,
    inputTokens: 100,
    outputTokens: 60,
    reasoningTokens: 10,
    energyJ: 1523.4,
    carbonG: 0.24,
    profileId: 'h20-proxy-v1',
    confidence: 'proxy',
    turns,
    steps: [
      { turn: 1, step: 1, inputTokens: 40, outputTokens: 30, energyJ: 300, carbonG: 0.05 },
    ],
    cachedTokens: 50_000,
    savedEnergyJ: 8827.6,
    savedCarbonG: 1.42,
    costCny: 0.0002,
    priceCnyPerKwh: 0.56,
    budgetJ: 0,
  }
}

interface Mounted {
  close: ReturnType<typeof vi.fn>
  container: HTMLElement
}

function overlay(open: boolean, value: GreenMeterProjection | null, close = vi.fn()): Mounted {
  const props = {
    t,
    useStore: (selector: (state: { open: boolean, meter: GreenMeterProjection | null }) => unknown) =>
      selector({ open, meter: value }),
    actions: { close },
  } as unknown as OverlayEnergyPanelProps
  const { container } = render(<OverlayEnergyPanel {...props} />)
  return { close, container }
}

describe('OverlayEnergyPanel', () => {
  test('renders nothing while closed or without a snapshot', () => {
    expect(overlay(false, meter()).container.textContent).toBe('')
    expect(overlay(true, null).container.textContent).toBe('')
  })

  test('renders the drawer panel from the shared-store snapshot', () => {
    const { container } = overlay(true, meter())
    expect(container.querySelector('[data-green-meter="overlay-panel"]')).not.toBeNull()
    expect(screen.getByText('浼氳瘽鑳借€楁槑缁?)).toBeTruthy()
    expect(screen.getByText('h20-proxy-v1 (proxy)')).toBeTruthy()
    expect(screen.getByText('鏈€杩戣姹?)).toBeTruthy()
  })

  test('close dispatches the shared store action', () => {
    const close = vi.fn()
    overlay(true, meter(), close)
    fireEvent.click(screen.getByText('鍏抽棴'))
    expect(close).toHaveBeenCalledTimes(1)
  })
})
