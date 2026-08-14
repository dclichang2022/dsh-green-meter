/**
 * GreenMeterDock: the ambient energy/carbon readout under the composer card —
 * the totals label plus a per-turn energy bar sparkline. Clicking it toggles
 * the detail panel: `sidebar` placement renders it in the sidebar's
 * `sidebar.energy` seat, `popover` placement renders it as a floating card
 * above the readout (both share one panel store handle).
 *
 * `undefined` = host green-meter unit not composed (render nothing); `null` =
 * no billable steps yet (the fallback state); otherwise the live values.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type { GreenMeterProjection, GreenMeterTurn } from '@deepseek-ai/dsh-green-meter/client';
import { createGreenMeterPanelStore } from './store.ts';
import type { GreenMeterKey } from './locales.ts';
/** J → J/kJ/MJ, mirroring the /green report's energy formatting. */
export declare function formatEnergy(joules: number): string;
/** Full dock-entry props: runtime share (InputZone + session kit incl. useProjection), panel store, locale, placement. */
export type GreenMeterDockProps = PropsRuntime<'conversation.composer.dock'> & PropsLocale<'greenMeter'> & PropsStore<ReturnType<typeof createGreenMeterPanelStore>> & {
    placement: 'sidebar' | 'popover';
};
/** Inline SVG per-turn energy bars; renders nothing for an empty series. */
export declare function EnergyBars({ turns, maxTurns, height }: {
    turns: readonly GreenMeterTurn[];
    maxTurns: number;
    height?: number;
}): import("react").JSX.Element | null;
/**
 * Floating detail card for the `popover` placement: the same panel body as
 * the sidebar seat, anchored above the readout.
 */
export declare function PopoverPanel({ meter, t, onClose }: {
    meter: GreenMeterProjection;
    t: (key: GreenMeterKey, values?: Record<string, string>) => string;
    onClose: () => void;
}): import("react").JSX.Element;
export declare function GreenMeterDock({ useProjection, useStore, actions, placement, t }: GreenMeterDockProps): import("react").JSX.Element | null;
//# sourceMappingURL=GreenMeterDock.d.ts.map