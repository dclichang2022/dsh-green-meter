/**
 * Shared viewing-state store for the green-meter surface: the composer-dock
 * readout toggles `open`, the sidebar energy panel renders while it is open.
 * One handle is constructed in `apply` and passed to BOTH registrations, so
 * the two entries share one instance (framework-constructed per entry only
 * when a factory is passed instead).
 */
import { type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client';
/** Store state: whether the sidebar energy panel is open. */
export type GreenMeterPanelState = {
    open: boolean;
};
/** Complete write set: toggle from the dock, close from the panel. */
export type GreenMeterPanelActions = {
    toggle: (draft: GreenMeterPanelState) => void;
    close: (draft: GreenMeterPanelState) => void;
};
/**
 * Create the green-meter panel store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export declare function createGreenMeterPanelStore(): EngineStoreHandle<GreenMeterPanelState, GreenMeterPanelActions>;
//# sourceMappingURL=store.d.ts.map