import { GreenMeterDock } from "./GreenMeterDock.js";
import { OverlayEnergyPanel } from "./OverlayEnergyPanel.js";
import { SidebarEnergyPanel } from "./SidebarEnergyPanel.js";
import { en, zh } from "./locales.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'greenMeter';
/** Required services: the slot registry and the locale service. */
export const inject = ['slots', 'locale'];
/**
 * Client plugin body: the composer-dock readout and the detail panel.
 * `slots.inject` waits on each owner's declaration (apply order is
 * unconstrained) and leaves with this plugin's fiber. The surfaces share the
 * module-level panel store (scope-agnostic), so no engine store handle is
 * attached to the registrations.
 */
export function apply(ctx, config = {}) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-green-meter: dictionaries');
    const placement = config.panelPlacement ?? 'overlay';
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'green-meter',
        order: 10,
        locale: NS,
        inject: () => ({ placement }),
    }, GreenMeterDock));
    if (placement === 'sidebar') {
        ctx.slots.inject('sidebar.energy', () => ctx.slots.register({
            name: 'sidebar.energy',
            locale: NS,
        }, SidebarEnergyPanel));
    }
    if (placement === 'overlay') {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'green-meter',
            locale: NS,
        }, OverlayEnergyPanel));
    }
}
//# sourceMappingURL=index.js.map