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
 *    `shell.overlay` layer — zero configuration, works on any vanilla DSH
 *    install, no source patches.
 *  - `sidebar`: the detail panel renders in the sidebar's `sidebar.energy`
 *    seat, which requires the optional ui-sidebar slot addition (see the
 *    repo's `patches/` directory).
 *  - `popover`: the dock renders the detail panel as a floating card above
 *    the readout.
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
    /** Where the detail panel renders; `overlay` is the zero-config default. */
    readonly panelPlacement?: 'sidebar' | 'popover' | 'overlay';
}
/** Required services: the slot registry and the locale service. */
export declare const inject: string[];
/**
 * Client plugin body: the composer-dock readout and the detail panel.
 * `slots.inject` waits on each owner's declaration (apply order is
 * unconstrained) and leaves with this plugin's fiber. The surfaces share the
 * module-level panel store (scope-agnostic), so no engine store handle is
 * attached to the registrations.
 */
export declare function apply(ctx: ClientContext, config?: UiGreenMeterConfig): void;
//# sourceMappingURL=index.d.ts.map