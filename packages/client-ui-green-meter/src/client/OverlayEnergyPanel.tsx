/**
 * OverlayEnergyPanel: the green-meter detail panel rendered in the
 * frame-wide `shell.overlay` layer as a right-side floating drawer. This is
 * the zero-config placement: `shell.overlay` is declared by ui-layout and
 * exists in every vanilla install, so no DeepSeek Harness source patch is
 * required. The panel reads the shared module-level panel state — the
 * session-scoped dock owns the `useProjection('greenMeter')` read and mirrors
 * the live snapshot into it via `setMeter`.
 *
 * The header is a drag handle: pointer capture moves the drawer anywhere on
 * screen (clamped so a grab strip stays visible), and the position resets
 * when the panel closes.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { EnergyPanelBody } from './SidebarEnergyPanel.tsx'
import { panelActions, usePanelState } from './store.ts'
import css from './GreenMeterDock.module.css'

/** Full panel props: shell.overlay owner share + locale seat. */
export type OverlayEnergyPanelProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'greenMeter'>

/** Keep at least this many pixels of the drawer inside the viewport. */
const EDGE_KEEP = 80

/** The overlay drawer panel; closed/absent states render nothing. */
export function OverlayEnergyPanel({ t }: OverlayEnergyPanelProps) {
  const { open, meter } = usePanelState()
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ offsetX: number, offsetY: number } | null>(null)
  const [pos, setPos] = useState<{ x: number, y: number } | null>(null)
  // Each reopen starts from the default right-edge dock position.
  useEffect(() => {
    if (!open) setPos(null)
  }, [open])
  if (!open || meter === null) return null

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const panel = panelRef.current
    if (panel === null) return
    const rect = panel.getBoundingClientRect()
    drag.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const panel = panelRef.current
    const grabbed = drag.current
    if (panel === null || grabbed === null) return
    const width = panel.offsetWidth || 264
    const x = Math.min(Math.max(event.clientX - grabbed.offsetX, EDGE_KEEP - width), window.innerWidth - EDGE_KEEP)
    const y = Math.min(Math.max(event.clientY - grabbed.offsetY, 0), window.innerHeight - EDGE_KEEP)
    setPos({ x, y })
  }

  const onPointerUp = (): void => {
    drag.current = null
  }

  return (
    <div
      ref={panelRef}
      className={css.overlayPanel}
      style={pos === null ? undefined : { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto' }}
      data-green-meter="overlay-panel"
    >
      <div
        className={css.panelHead}
        data-green-meter="drag-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className={css.panelTitle}>{t('panelTitle')}</span>
        <button
          className={css.close}
          onPointerDown={(event) => { event.stopPropagation() }}
          onClick={() => { panelActions.close() }}
          data-green-meter="close"
        >{t('close')}</button>
      </div>
      <EnergyPanelBody meter={meter} t={t} />
    </div>
  )
}
