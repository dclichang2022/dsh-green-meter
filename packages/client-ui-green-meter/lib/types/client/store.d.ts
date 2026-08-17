import type { GreenMeterProjection } from '@deepseek-ai/dsh-green-meter/client';
/** Store state: panel visibility plus the latest projection snapshot. */
export type GreenMeterPanelState = {
    open: boolean;
    meter: GreenMeterProjection | null;
};
/**
 * Subscribe to panel-state changes (useSyncExternalStore contract).
 * @param listener - called after every state commit.
 * @returns the unsubscriber.
 */
export declare function subscribePanel(listener: () => void): () => void;
/** Current panel state snapshot (stable between commits). */
export declare function getPanelState(): GreenMeterPanelState;
/** React subscription over the shared panel state. */
export declare function usePanelState(): GreenMeterPanelState;
/** Write set: toggle/close from the surfaces, setMeter from the dock. */
export declare const panelActions: {
    toggle: () => void;
    close: () => void;
    setMeter: (meter: GreenMeterProjection | null) => void;
};
//# sourceMappingURL=store.d.ts.map