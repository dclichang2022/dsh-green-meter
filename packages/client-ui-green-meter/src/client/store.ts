/**
 * Module-level panel state for the green-meter surface: the composer-dock
 * readout toggles `open` and mirrors the live projection snapshot into
 * `meter` (the dock is session-scoped and owns the `useProjection` read), so
 * root-scoped panel placements (the `shell.overlay` drawer) can render the
 * detail panel without their own session kit.
 *
 * This is a module-level external store, NOT an engine store handle: the
 * slot engine pins a shared handle to the scope of its first mount
 * ("one handle, one scope"), and the dock (session) plus the overlay drawer
 * (root) render in different scopes. A scope-agnostic singleton every
 * surface subscribes to sidesteps the pin while keeping one source of truth.
 */
import { useSyncExternalStore } from 'react'
import type { GreenMeterProjection } from 'dsh-green-meter/client'

/** Store state: panel visibility plus the latest projection snapshot. */
export type GreenMeterPanelState = {
  open: boolean
  meter: GreenMeterProjection | null
}

let current: GreenMeterPanelState = { open: false, meter: null }
const listeners = new Set<() => void>()

function commit(next: GreenMeterPanelState): void {
  current = next
  for (const listener of listeners) listener()
}

/**
 * Subscribe to panel-state changes (useSyncExternalStore contract).
 * @param listener - called after every state commit.
 * @returns the unsubscriber.
 */
export function subscribePanel(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Current panel state snapshot (stable between commits). */
export function getPanelState(): GreenMeterPanelState {
  return current
}

/** React subscription over the shared panel state. */
export function usePanelState(): GreenMeterPanelState {
  return useSyncExternalStore(subscribePanel, getPanelState)
}

/** Write set: toggle/close from the surfaces, setMeter from the dock. */
export const panelActions = {
  toggle: (): void => { commit({ ...current, open: !current.open }) },
  close: (): void => { commit({ ...current, open: false }) },
  setMeter: (meter: GreenMeterProjection | null): void => {
    if (current.meter !== meter) commit({ ...current, meter })
  },
}
