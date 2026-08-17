/**
 * OverlayEnergyPanel: the green-meter detail panel rendered in the
 * frame-wide `shell.overlay` layer as a right-side floating drawer. This is
 * the zero-config placement: `shell.overlay` is declared by ui-layout and
 * exists in every vanilla install, so no DeepSeek Harness source patch is
 * required. The panel reads the shared store 鈥?the session-scoped dock owns
 * the `useProjection('greenMeter')` read and mirrors the live snapshot into
 * the store via `setMeter`.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { EnergyPanelBody } from './SidebarEnergyPanel.tsx'
import { createGreenMeterPanelStore } from './store.ts'
import css from './GreenMeterDock.module.css'

/** Full panel props: shell.overlay owner share + panel store + locale seat. */
export type OverlayEnergyPanelProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'greenMeter'>
  & PropsStore<ReturnType<typeof createGreenMeterPanelStore>>

/** The overlay drawer panel; closed/absent states render nothing. */
export function OverlayEnergyPanel({ useStore, actions, t }: OverlayEnergyPanelProps) {
  const open = useStore(state => state.open)
  const meter = useStore(state => state.meter)
  if (!open || meter === null) return null
  return (
    <div className={css.overlayPanel} data-green-meter="overlay-panel">
      <div className={css.panelHead}>
        <span className={css.panelTitle}>{t('panelTitle')}</span>
        <button className={css.close} onClick={() => { actions.close() }} data-green-meter="close">{t('close')}</button>
      </div>
      <EnergyPanelBody meter={meter} t={t} />
    </div>
  )
}
