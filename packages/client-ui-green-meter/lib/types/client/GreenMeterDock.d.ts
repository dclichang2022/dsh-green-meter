import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { GreenMeterProjection, GreenMeterTurn } from '@deepseek-ai/dsh-green-meter/client';
import type { GreenMeterKey } from './locales.ts';
/** J → J/kJ/MJ, mirroring the /green report's energy formatting. */
export declare function formatEnergy(joules: number): string;
/** Full dock-entry props: runtime share (InputZone + session kit incl. useProjection), locale, placement. */
export type GreenMeterDockProps = PropsRuntime<'conversation.composer.dock'> & PropsLocale<'greenMeter'> & {
    placement: 'sidebar' | 'popover' | 'overlay';
};
/**
 * Inline SVG per-turn energy bars; renders nothing for an empty series.
 * The viewBox uses a FIXED slot grid (`maxTurns` slots × 3px) with bars
 * left-aligned from the first slot, so CSS stretching (panel charts use
 * width:100%) keeps bar proportions stable — a lone turn renders as one
 * normal-width bar at the left edge.
 */
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
export declare function GreenMeterDock({ useProjection, placement, t }: GreenMeterDockProps): import("react").JSX.Element | null;
//# sourceMappingURL=GreenMeterDock.d.ts.map