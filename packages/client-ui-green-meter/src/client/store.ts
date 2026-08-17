/**
 * Shared viewing-state store for the green-meter surface: the composer-dock
 * readout toggles `open` and mirrors the live projection snapshot into
 * `meter` (the dock is session-scoped and owns the `useProjection` read), so
 * root-scoped panel placements (the `shell.overlay` drawer) can render the
 * detail panel without their own session kit. One handle is constructed in
 * `apply` and passed to ALL registrations, so every surface shares one
 * instance.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { GreenMeterProjection } from 'dsh-green-meter/client'

/** Store state: panel visibility plus the latest projection snapshot. */
export type GreenMeterPanelState = {
  open: boolean
  meter: GreenMeterProjection | null
}

/** Complete write set: toggle/close from the surfaces, setMeter from the dock. */
export type GreenMeterPanelActions = {
  toggle: (draft: GreenMeterPanelState) => void
  close: (draft: GreenMeterPanelState) => void
  setMeter: (draft: GreenMeterPanelState, meter: GreenMeterProjection | null) => void
}

/**
 * Create the green-meter panel store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createGreenMeterPanelStore(): EngineStoreHandle<GreenMeterPanelState, GreenMeterPanelActions> {
  return defineStore({
    init: (): GreenMeterPanelState => ({ open: false, meter: null }),
    actions: {
      toggle: (draft) => { draft.open = !draft.open },
      close: (draft) => { draft.open = false },
      setMeter: (draft, meter) => { draft.meter = meter },
    },
  })
}
