/**
 * SidebarEnergyPanel: the green-meter detail surface rendered in the
 * sidebar's `sidebar.energy` seat — the composer-dock readout toggles it via
 * the shared panel store, and the live values arrive through
 * `useProjection('greenMeter')` (session-scoped slot kit). Renders nothing
 * while closed or while no session is current. The panel body itself is
 * exported as `EnergyPanelBody` so the dock's popover placement reuses it.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type { GreenMeterProjection } from '@deepseek-ai/dsh-green-meter/client';
import { createGreenMeterPanelStore } from './store.ts';
import type { GreenMeterKey } from './locales.ts';
type PanelTranslate = (key: GreenMeterKey, values?: Record<string, string>) => string;
/** The shared detail body: per-turn chart, totals, savings, requests, budget. */
export declare function EnergyPanelBody({ meter, t }: {
    meter: GreenMeterProjection;
    t: PanelTranslate;
}): import("react").JSX.Element;
/** Full panel props: sidebar.energy owner share + session kit + panel store + locale seat. */
export type SidebarEnergyPanelProps = PropsRuntime<'sidebar.energy'> & PropsLocale<'greenMeter'> & PropsStore<ReturnType<typeof createGreenMeterPanelStore>>;
/** The sidebar detail panel; closed/absent states render nothing. */
export declare function SidebarEnergyPanel({ useProjection, useStore, actions, t }: SidebarEnergyPanelProps): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=SidebarEnergyPanel.d.ts.map