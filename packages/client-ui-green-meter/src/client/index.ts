/**
 * Green-meter surface plugin, browser half: a compact always-visible energy +
 * carbon readout in the composer dock plus the detail panel. The live value
 * arrives through `useProjection('greenMeter')` (the greenMeter session
 * projection, updated by session/projection frames); the dock and the panel
 * share one panel store handle 鈥?the dock toggles it, the panel renders while
 * it is open.
 *
 * Panel placement (`panelPlacement` config):
 *  - `sidebar` (default): the detail panel renders in the sidebar's
 *    `sidebar.energy` seat, which requires the ui-sidebar slot addition
 *    (see the package README's "Sidebar slot patch" section).
 *  - `popover`: the dock renders the detail panel as a floating card above
 *    the readout 鈥?works on any vanilla DSH install with no patches.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the composer.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the sidebar.energy entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: merges greenMeter into SessionProjectionMap for useProjection.
import type {} from 'dsh-green-meter/client'
import { GreenMeterDock } from './GreenMeterDock.tsx'
import { SidebarEnergyPanel } from './SidebarEnergyPanel.tsx'
import { createGreenMeterPanelStore } from './store.ts'
import { en, zh, type GreenMeterKey } from './locales.ts'

export type { GreenMeterKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Green-meter readout copy. */
    greenMeter: GreenMeterKey
  }
}

/** Client row configuration. */
export interface UiGreenMeterConfig {
  /** Where the detail panel renders; `popover` works on vanilla installs. */
  readonly panelPlacement?: 'sidebar' | 'popover'
}

/** Dictionary namespace owned by this plugin. */
const NS = 'greenMeter'

/** Required services: the slot registry and the locale service. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: the composer-dock readout and the detail panel.
 * `slots.inject` waits on each owner's declaration (apply order is
 * unconstrained) and leaves with this plugin's fiber. One shared store handle
 * carries the open/closed state across both surfaces.
 */
export function apply(ctx: ClientContext, config: UiGreenMeterConfig = {}): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-green-meter: dictionaries')

  const placement = config.panelPlacement ?? 'sidebar'
  // Apply-constructed handle: one instance shared by BOTH surfaces, so the
  // dock's toggle opens the panel.
  const panelStore = createGreenMeterPanelStore()

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'green-meter',
    order: 10,
    locale: NS,
    store: panelStore,
    inject: () => ({ placement }),
  }, GreenMeterDock))

  if (placement === 'sidebar') {
    ctx.slots.inject('sidebar.energy', () => ctx.slots.register({
      name: 'sidebar.energy',
      locale: NS,
      store: panelStore,
    }, SidebarEnergyPanel))
  }
}
