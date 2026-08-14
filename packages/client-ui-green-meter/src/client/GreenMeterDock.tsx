/**
 * GreenMeterDock: the ambient energy/carbon readout under the composer card —
 * the totals label plus a per-turn energy bar sparkline. Clicking it toggles
 * the detail panel: `sidebar` placement renders it in the sidebar's
 * `sidebar.energy` seat, `popover` placement renders it as a floating card
 * above the readout (both share one panel store handle).
 *
 * `undefined` = host green-meter unit not composed (render nothing); `null` =
 * no billable steps yet (the fallback state); otherwise the live values.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { GreenMeterProjection, GreenMeterTurn } from '@deepseek-ai/dsh-green-meter/client'
import { EnergyPanelBody } from './SidebarEnergyPanel.tsx'
import { createGreenMeterPanelStore } from './store.ts'
import type { GreenMeterKey } from './locales.ts'
import css from './GreenMeterDock.module.css'

/** J → J/kJ/MJ, mirroring the /green report's energy formatting. */
export function formatEnergy(joules: number): string {
  if (joules >= 1_000_000) return `${(joules / 1_000_000).toFixed(2)} MJ`
  if (joules >= 1_000) return `${(joules / 1_000).toFixed(1)} kJ`
  return `${joules.toFixed(1)} J`
}

/** Full dock-entry props: runtime share (InputZone + session kit incl. useProjection), panel store, locale, placement. */
export type GreenMeterDockProps =
  PropsRuntime<'conversation.composer.dock'>
  & PropsLocale<'greenMeter'>
  & PropsStore<ReturnType<typeof createGreenMeterPanelStore>>
  & { placement: 'sidebar' | 'popover' }

/** One bar per turn, width 2px + 1px gap, normalized to the series max. */
function bars(turns: readonly GreenMeterTurn[], barWidth: number, gap: number, height: number): React.JSX.Element[] {
  const max = Math.max(1, ...turns.map(turn => turn.energyJ))
  return turns.map((turn, index) => {
    const h = Math.max(1, Math.round(turn.energyJ / max * height))
    return (
      <rect
        key={turn.turn}
        x={index * (barWidth + gap)}
        y={height - h}
        width={barWidth}
        height={h}
        data-turn={turn.turn}
      />
    )
  })
}

/**
 * Inline SVG per-turn energy bars; renders nothing for an empty series.
 * The viewBox uses a FIXED slot grid (`maxTurns` slots × 3px) with bars
 * left-aligned from the first slot, so CSS stretching (panel charts use
 * width:100%) keeps bar proportions stable — a lone turn renders as one
 * normal-width bar at the left edge.
 */
export function EnergyBars({ turns, maxTurns, height = 14 }: { turns: readonly GreenMeterTurn[], maxTurns: number, height?: number }) {
  const shown = turns.slice(-maxTurns)
  if (shown.length === 0) return null
  const slots = Math.max(maxTurns, 1)
  const width = slots * 3
  return (
    <svg className={css.spark} width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      data-green-meter="bars" aria-hidden="true">
      {bars(shown, 2, 1, height)}
    </svg>
  )
}

/**
 * Floating detail card for the `popover` placement: the same panel body as
 * the sidebar seat, anchored above the readout.
 */
export function PopoverPanel(
  { meter, t, onClose }: { meter: GreenMeterProjection, t: (key: GreenMeterKey, values?: Record<string, string>) => string, onClose: () => void },
) {
  return (
    <div className={css.popoverPanel} data-green-meter="panel">
      <div className={css.panelHead}>
        <span className={css.panelTitle}>{t('panelTitle')}</span>
        <button className={css.close} onClick={onClose} data-green-meter="close">{t('close')}</button>
      </div>
      <EnergyPanelBody meter={meter} t={t} />
    </div>
  )
}

export function GreenMeterDock({ useProjection, useStore, actions, placement, t }: GreenMeterDockProps) {
  const meter = useProjection('greenMeter') as GreenMeterProjection | null | undefined
  const open = useStore(state => state.open)
  if (meter === undefined) return null
  if (meter === null) {
    return <div className={css.root} data-green-meter="empty">{t('empty')}</div>
  }
  return (
    <div className={css.root} data-green-meter="live">
      <button className={css.trigger} onClick={() => { actions.toggle() }} data-green-meter="toggle">
        <span>{t('energy', { value: formatEnergy(meter.energyJ) })}</span>
        <span className={css.sep} aria-hidden>·</span>
        <span>{t('carbon', { value: meter.carbonG.toFixed(1) })}</span>
        <EnergyBars turns={meter.turns} maxTurns={40} />
      </button>
      {placement === 'popover' && open
        ? <PopoverPanel meter={meter} t={t} onClose={() => { actions.close() }} />
        : null}
    </div>
  )
}
