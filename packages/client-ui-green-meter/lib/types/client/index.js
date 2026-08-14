import { GreenMeterDock } from "./GreenMeterDock.js";
import { SidebarEnergyPanel } from "./SidebarEnergyPanel.js";
import { createGreenMeterPanelStore } from "./store.js";
import { en, zh } from "./locales.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'greenMeter';
/** Required services: the slot registry and the locale service. */
export const inject = ['slots', 'locale'];
/**
 * Client plugin body: the composer-dock readout and the detail panel.
 * `slots.inject` waits on each owner's declaration (apply order is
 * unconstrained) and leaves with this plugin's fiber. One shared store handle
 * carries the open/closed state across both surfaces.
 */
export function apply(ctx, config = {}) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-green-meter: dictionaries');
    const placement = config.panelPlacement ?? 'sidebar';
    // Apply-constructed handle: one instance shared by BOTH surfaces, so the
    // dock's toggle opens the panel.
    const panelStore = createGreenMeterPanelStore();
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'green-meter',
        order: 10,
        locale: NS,
        store: panelStore,
        inject: () => ({ placement }),
    }, GreenMeterDock));
    if (placement === 'sidebar') {
        ctx.slots.inject('sidebar.energy', () => ctx.slots.register({
            name: 'sidebar.energy',
            locale: NS,
            store: panelStore,
        }, SidebarEnergyPanel));
    }
}
//# sourceMappingURL=index.js.map