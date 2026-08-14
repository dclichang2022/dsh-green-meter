// @vitest-environment jsdom
/**
 * GreenMeterDock presentation behavior: the three projection states render
 * the empty/live/none states, energy formatting mirrors the /green report,
 * the sparkline renders per-turn bars, and clicking toggles the shared panel
 * store (the sidebar panel owns the detail surface).
 * @module @deepseek-ai/dsh-client-ui-green-meter/tests/GreenMeterDock
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GreenMeterDock, type GreenMeterDockProps } from '../src/client/GreenMeterDock.tsx'
import type { GreenMeterProjection, GreenMeterTurn } from 'dsh-green-meter/client'
import { zh, en, type GreenMeterKey } from '../src/client/locales.ts'

afterEach(cleanup)

function t(key: GreenMeterKey, values?: Record<string, string>): string {
  let template = zh[key]
  for (const [name, value] of Object.entries(values ?? {})) {
    template = template.replace(`{${name}}`, value)
  }
  return template
}

interface Mounted {
  toggle: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  container: HTMLElement
}

function dock(
  value: GreenMeterProjection | null | undefined,
  options: { toggle?: ReturnType<typeof vi.fn>, close?: ReturnType<typeof vi.fn>, open?: boolean, placement?: 'sidebar' | 'popover' } = {},
): Mounted {
  const { toggle = vi.fn(), close = vi.fn(), open = false, placement = 'sidebar' } = options
  const props = {
    t,
    useProjection: () => value,
    useStore: (selector: (state: { open: boolean }) => unknown) => selector({ open }),
    actions: { toggle, close },
    placement,
  } as unknown as GreenMeterDockProps
  const { container } = render(<GreenMeterDock {...props} />)
  return { toggle, close, container }
}

function turns(): GreenMeterTurn[] {
  return [
    { turn: 1, steps: 2, energyJ: 500, carbonG: 0.08 },
    { turn: 2, steps: 1, energyJ: 1023.4, carbonG: 0.16 },
  ]
}

function liveMeter(): GreenMeterProjection {
  return {
    requests: 3,
    inputTokens: 100,
    outputTokens: 60,
    reasoningTokens: 10,
    energyJ: 1523.4,
    carbonG: 0.24,
    profileId: 'h20-proxy-v1',
    confidence: 'proxy',
    turns: turns(),
    steps: [
      { turn: 1, step: 1, inputTokens: 40, outputTokens: 30, energyJ: 300, carbonG: 0.05 },
    ],
    cachedTokens: 0,
    savedEnergyJ: 0,
    savedCarbonG: 0,
    costCny: 0,
    priceCnyPerKwh: 0.56,
    budgetJ: 0,
  }
}

describe('GreenMeterDock', () => {
  test('renders nothing when the host projection unit is absent', () => {
    const props = {
      t,
      useProjection: () => undefined,
      useStore: (selector: (state: { open: boolean }) => unknown) => selector({ open: false }),
      actions: { toggle: vi.fn(), close: vi.fn() },
      placement: 'sidebar',
    } as unknown as GreenMeterDockProps
    const { container } = render(<GreenMeterDock {...props} />)
    expect(container.textContent).toBe('')
  })

  test('renders the empty state before the first billable step', () => {
    dock(null)
    expect(screen.getByText('鑳借€?鈥?)).toBeTruthy()
  })

  test('renders live energy, carbon, and the per-turn sparkline', () => {
    const { container } = dock(liveMeter())
    expect(screen.getByText('鑳借€?1.5 kJ')).toBeTruthy()
    expect(screen.getByText('纰?0.2 g CO2e')).toBeTruthy()
    const svg = container.querySelector('svg[data-green-meter="bars"]')
    expect(svg).not.toBeNull()
    expect(svg!.querySelectorAll('rect')).toHaveLength(2)
  })

  test('energy formatting matches the /green report tiers', () => {
    dock({ ...liveMeter(), energyJ: 2_300_000 })
    expect(screen.getByText('鑳借€?2.30 MJ')).toBeTruthy()
    dock({ ...liveMeter(), energyJ: 42 })
    expect(screen.getByText('鑳借€?42.0 J')).toBeTruthy()
  })

  test('clicking the readout toggles the shared panel store', () => {
    const toggle = vi.fn()
    dock(liveMeter(), { toggle })
    fireEvent.click(screen.getByText('鑳借€?1.5 kJ'))
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  test('popover placement renders the detail panel above the readout while open', () => {
    const close = vi.fn()
    const { container } = dock(liveMeter(), { placement: 'popover', open: true, close })
    expect(container.querySelector('[data-green-meter="panel"]')).not.toBeNull()
    expect(screen.getByText('浼氳瘽鑳借€楁槑缁?)).toBeTruthy()
    fireEvent.click(screen.getByText('鍏抽棴'))
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('popover placement renders no panel while closed', () => {
    const { container } = dock(liveMeter(), { placement: 'popover', open: false })
    expect(container.querySelector('[data-green-meter="panel"]')).toBeNull()
  })

  test('both locale dictionaries carry the full key set', () => {
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()
    expect(enKeys).toEqual(zhKeys)
    expect(zhKeys).toContain('panelTitle')
    expect(zhKeys).toContain('budgetOver')
  })
})
