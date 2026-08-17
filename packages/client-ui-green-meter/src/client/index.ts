/**
 * Green-meter surface plugin, browser half: a compact always-visible energy +
 * carbon readout in the composer dock plus the detail panel. The live value
 * arrives through `useProjection('greenMeter')` (the greenMeter session
 * projection, updated by session/projection frames); the dock mirrors the
 * snapshot into the shared panel store so every panel placement renders from
 * one source.
 *
 * Panel placement (`panelPlacement` config):
 *  - `overlay` (default): a right-side floating drawer in the frame-wide
 *    `shell.overlay` layer 鈥?zero configuration, works on any vanilla DSH
 *    install, no source patches.
 *  - `sidebar`: the detail panel renders in the sidebar's `sidebar.energy`
 *    seat, which requires the optional ui-sidebar slot addition (see the
 *    repo's `patches/` directory).
 *  - `popover`: the dock renders the detail panel as a floating card above
 *    the readout.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the composer.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the sidebar.energy entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the ui-layout SlotMap merge (the shell.overlay entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: merges greenMeter into SessionProjectionMap for useProjection.
import type {} from 'dsh-green-meter/client'
import { GreenMeterDock } from './GreenMeterDock.tsx'
import { OverlayEnergyPanel } from './OverlayEnergyPanel.tsx'
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
  /** Where the detail panel renders; `overlay` is the zero-config default. */
  readonly panelPlacement?: 'sidebar' | 'popover' | 'overlay'
}

/** Dictionary namespace owned by this plugin. */
const NS = 'greenMeter'

/** Required services: the slot registry and the locale service. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: the composer-dock readout and the detail panel.
 * `slots.inject` waits on each owner's declaration (apply order is
 * unconstrained) and leaves with this plugin's fiber. One shared store handle
 * carries the open/closed state and the live snapshot across all surfaces.
 */
export function apply(ctx: ClientContext, config: UiGreenMeterConfig = {}): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-green-meter: dictionaries')

  const placement = config.panelPlacement ?? 'overlay'
  // Apply-constructed handle: one instance shared by ALL surfaces, so the
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

  if (placement === 'overlay') {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'green-meter',
      locale: NS,
      store: panelStore,
    }, OverlayEnergyPanel))
  }
}
