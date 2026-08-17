// @vitest-environment jsdom
/**
 * OverlayEnergyPanel presentation behavior: the closed/absent states render
 * nothing; the open state renders the drawer with the shared-store snapshot;
 * close dispatches the shared store action; the header drags the drawer.
 * @module @deepseek-ai/dsh-client-ui-green-meter/tests/OverlayEnergyPanel
 */

import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OverlayEnergyPanel, type OverlayEnergyPanelProps } from '../src/client/OverlayEnergyPanel.tsx'
import { panelActions } from '../src/client/store.ts'
import type { GreenMeterProjection, GreenMeterTurn } from 'dsh-green-meter/client'
import { zh, type GreenMeterKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  panelActions.close()
  panelActions.setMeter(null)
})

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
  container: HTMLElement
}

function overlay(open: boolean, value: GreenMeterProjection | null): Mounted {
  panelActions.setMeter(value)
  if (open) panelActions.toggle()
  const { container } = render(<OverlayEnergyPanel {...{ t } as unknown as OverlayEnergyPanelProps} />)
  return { container }
}

describe('OverlayEnergyPanel', () => {
  test('renders nothing while closed or without a snapshot', () => {
    expect(overlay(false, meter()).container.textContent).toBe('')
    expect(overlay(true, null).container.textContent).toBe('')
  })

  test('renders the drawer panel from the shared-store snapshot', () => {
    const { container } = overlay(true, meter())
    expect(container.querySelector('[data-green-meter="overlay-panel"]')).not.toBeNull()
    expect(screen.getByText('会话能耗明细')).toBeTruthy()
    expect(screen.getByText('h20-proxy-v1 (proxy)')).toBeTruthy()
    expect(screen.getByText('最近请求')).toBeTruthy()
  })

  test('close dispatches the shared store action and hides the drawer', () => {
    overlay(true, meter())
    fireEvent.click(screen.getByText('关闭'))
    expect(screen.queryByText('会话能耗明细')).toBeNull()
  })

  test('dragging the header moves the drawer and clamps it inside the viewport', () => {
    const { container } = overlay(true, meter())
    const panel = container.querySelector('[data-green-meter="overlay-panel"]') as HTMLElement
    const handle = container.querySelector('[data-green-meter="drag-handle"]') as HTMLElement
    // jsdom lays nothing out: pin the drawer's initial rect.
    Object.defineProperty(panel, 'getBoundingClientRect', {
      value: () => ({
        left: 700, top: 60, right: 964, bottom: 400,
        x: 700, y: 60, width: 264, height: 340, toJSON: () => ({}),
      }),
    })
    fireEvent.pointerDown(handle, { clientX: 720, clientY: 80 })
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 200 })
    // offset (20, 20) → x = 280, y = 180.
    expect(panel.style.left).toBe('280px')
    expect(panel.style.top).toBe('180px')
    fireEvent.pointerUp(handle)
    // A move after release must not reposition.
    fireEvent.pointerMove(handle, { clientX: 10, clientY: 10 })
    expect(panel.style.left).toBe('280px')
  })

  test('dragging far left clamps the drawer so a grab strip stays visible', () => {
    const { container } = overlay(true, meter())
    const panel = container.querySelector('[data-green-meter="overlay-panel"]') as HTMLElement
    const handle = container.querySelector('[data-green-meter="drag-handle"]') as HTMLElement
    Object.defineProperty(panel, 'getBoundingClientRect', {
      value: () => ({
        left: 700, top: 60, right: 964, bottom: 400,
        x: 700, y: 60, width: 264, height: 340, toJSON: () => ({}),
      }),
    })
    fireEvent.pointerDown(handle, { clientX: 720, clientY: 80 })
    fireEvent.pointerMove(handle, { clientX: -200, clientY: 5000 })
    // x clamps to EDGE_KEEP - width = 80 - 264 = -184; y clamps to
    // innerHeight - EDGE_KEEP = 768 - 80 = 688.
    expect(panel.style.left).toBe('-184px')
    expect(panel.style.top).toBe('688px')
  })
})
