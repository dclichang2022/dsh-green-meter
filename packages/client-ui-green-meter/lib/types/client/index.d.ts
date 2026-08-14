/**
 * Green-meter surface plugin, browser half: a compact always-visible energy +
 * carbon readout in the composer dock plus the detail panel. The live value
 * arrives through `useProjection('greenMeter')` (the greenMeter session
 * projection, updated by session/projection frames); the dock and the panel
 * share one panel store handle — the dock toggles it, the panel renders while
 * it is open.
 *
 * Panel placement (`panelPlacement` config):
 *  - `sidebar` (default): the detail panel renders in the sidebar's
 *    `sidebar.energy` seat, which requires the ui-sidebar slot addition
 *    (see the package README's "Sidebar slot patch" section).
 *  - `popover`: the dock renders the detail panel as a floating card above
 *    the readout — works on any vanilla DSH install with no patches.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type GreenMeterKey } from './locales.ts';
export type { GreenMeterKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Green-meter readout copy. */
        greenMeter: GreenMeterKey;
    }
}
/** Client row configuration. */
export interface UiGreenMeterConfig {
    /** Where the detail panel renders; `popover` works on vanilla installs. */
    readonly panelPlacement?: 'sidebar' | 'popover';
}
/** Required services: the slot registry and the locale service. */
export declare const inject: string[];
/**
 * Client plugin body: the composer-dock readout and the detail panel.
 * `slots.inject` waits on each owner's declaration (apply order is
 * unconstrained) and leaves with this plugin's fiber. One shared store handle
 * carries the open/closed state across both surfaces.
 */
export declare function apply(ctx: ClientContext, config?: UiGreenMeterConfig): void;
//# sourceMappingURL=index.d.ts.map