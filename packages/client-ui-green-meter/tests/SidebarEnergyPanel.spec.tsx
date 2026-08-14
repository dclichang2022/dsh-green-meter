// @vitest-environment jsdom
/**
 * SidebarEnergyPanel presentation behavior: closed/absent states render
 * nothing; the open state renders the per-turn chart, totals, profile, and
 * budget rows; close dispatches the shared store action.
 * @module @deepseek-ai/dsh-client-ui-green-meter/tests/SidebarEnergyPanel
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SidebarEnergyPanel, type SidebarEnergyPanelProps } from '../src/client/SidebarEnergyPanel.tsx'
import type { GreenMeterProjection, GreenMeterTurn } from '@deepseek-ai/dsh-green-meter/client'
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
      { turn: 1, step: 2, inputTokens: 30, outputTokens: 10, energyJ: 200, carbonG: 0.03 },
      { turn: 2, step: 1, inputTokens: 30, outputTokens: 20, energyJ: 1023.4, carbonG: 0.16 },
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

function panel(value: GreenMeterProjection | null | undefined, open: boolean, close = vi.fn()): Mounted {
  const props = {
    t,
    useProjection: () => value,
    useStore: (selector: (state: { open: boolean }) => unknown) => selector({ open }),
    actions: { close },
  } as unknown as SidebarEnergyPanelProps
  const { container } = render(<SidebarEnergyPanel {...props} />)
  return { close, container }
}

describe('SidebarEnergyPanel', () => {
  test('renders nothing while closed', () => {
    const { container } = panel(meter(), false)
    expect(container.textContent).toBe('')
  })

  test('renders nothing when the projection is absent or null', () => {
    expect(panel(undefined, true).container.textContent).toBe('')
    expect(panel(null, true).container.textContent).toBe('')
  })
  test('renders the chart, totals, and profile when open', () => {
    const { container } = panel(meter(), true)
    expect(screen.getByText('会话能耗明细')).toBeTruthy()
    expect(screen.getByText('h20-proxy-v1 (proxy)')).toBeTruthy()
    expect(screen.getByText('第 1 轮')).toBeTruthy()
    expect(screen.getByText('第 2 轮')).toBeTruthy()
    expect(container.querySelector('svg[data-green-meter="bars"]')).not.toBeNull()
    expect(screen.getByText('1.5 kJ')).toBeTruthy()
  })

  test('chart uses a fixed 24-slot grid so a lone turn renders one normal bar', () => {
    const single = { ...meter(), turns: [{ turn: 1, steps: 1, energyJ: 500, carbonG: 0.08 }] }
    const { container } = panel(single, true)
    const svg = container.querySelector('svg[data-green-meter="bars"]') as SVGElement | null
    expect(svg).not.toBeNull()
    // Fixed slot grid: 24 slots × 3px viewBox, non-uniform scaling allowed.
    expect(svg!.getAttribute('width')).toBe('72')
    expect(svg!.getAttribute('preserveAspectRatio')).toBe('none')
    const rect = svg!.querySelector('rect') as SVGRectElement | null
    expect(rect).not.toBeNull()
    // Right-aligned: the single bar sits in the last slot (x = 23 * 3).
    expect(rect!.getAttribute('x')).toBe('69')
    expect(rect!.getAttribute('width')).toBe('2')
  })

  test('chart labels follow the bars: inset by the empty slots and single-turn shows one label', () => {
    const single = { ...meter(), turns: [{ turn: 7, steps: 1, energyJ: 500, carbonG: 0.08 }] }
    const { container } = panel(single, true)
    const labels = container.querySelector('[data-green-meter="chart-labels"]') as HTMLElement | null
    expect(labels).not.toBeNull()
    // 23 empty slots of 24 → label row inset ≈ 95.8%.
    expect(labels!.style.marginLeft.startsWith('95.833')).toBe(true)
    expect(labels!.querySelectorAll('span')).toHaveLength(1)
    expect(labels!.textContent).toContain('第 7 轮')

    // Two turns: 22 empty slots → inset 91.7%; two labels, oldest left.
    const { container: two } = panel(meter(), true)
    const labelsTwo = two.querySelector('[data-green-meter="chart-labels"]') as HTMLElement | null
    expect(labelsTwo!.style.marginLeft.startsWith('91.666')).toBe(true)
    expect(labelsTwo!.querySelectorAll('span')).toHaveLength(2)
  })

  test('renders the request-granularity list, newest first', () => {
    const { container } = panel(meter(), true)
    expect(screen.getByText('最近请求')).toBeTruthy()
    const rows = container.querySelectorAll('[data-green-meter="request"]')
    expect(rows).toHaveLength(3)
    // Newest first: turn 2 step 1 leads.
    expect(rows[0]!.textContent).toContain('第 2 轮 · 第 1 步')
    expect(rows[0]!.textContent).toContain('20 tok')
    expect(rows[2]!.textContent).toContain('第 1 轮 · 第 1 步')
  })

  test('renders the cache-savings callout when cached tokens exist', () => {
    const { container } = panel(meter(), true)
    expect(container.querySelector('[data-green-meter="savings"]')).not.toBeNull()
    expect(screen.getByText('缓存节碳')).toBeTruthy()
    expect(screen.getByText(/约 1\.4 g CO2e/)).toBeTruthy()
    // Trees equivalent line: 1.42 g / 1000 / 20 kg → < 0.05 trees.
    expect(container.querySelector('[data-green-meter="trees"]')).not.toBeNull()
    expect(screen.getByText(/<0\.05/)).toBeTruthy()
  })

  test('renders the electricity cost row at the configured price', () => {
    const { container } = panel(meter(), true)
    expect(container.querySelector('[data-green-meter="cost"]')).not.toBeNull()
    expect(screen.getByText('电费')).toBeTruthy()
    expect(screen.getByText('约 ¥0.0002')).toBeTruthy()
  })

  test('hides the savings callout when nothing was cached', () => {
    const { container } = panel({ ...meter(), cachedTokens: 0, savedEnergyJ: 0, savedCarbonG: 0 }, true)
    expect(container.querySelector('[data-green-meter="savings"]')).toBeNull()
  })

  test('renders the budget rows', () => {
    panel({ ...meter(), budgetJ: 2_000_000 }, true)
    expect(screen.getByText('预算 2.00 MJ（已用 0%）')).toBeTruthy()
    panel({ ...meter(), budgetJ: 1_000, energyJ: 1_500 }, true)
    expect(screen.getByText('预算超支，新步骤已拒绝')).toBeTruthy()
  })

  test('close dispatches the shared store action', () => {
    const close = vi.fn()
    panel(meter(), true, close)
    fireEvent.click(screen.getByText('关闭'))
    expect(close).toHaveBeenCalledTimes(1)
  })
})
