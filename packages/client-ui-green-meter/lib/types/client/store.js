/**
 * Shared viewing-state store for the green-meter surface: the composer-dock
 * readout toggles `open`, the sidebar energy panel renders while it is open.
 * One handle is constructed in `apply` and passed to BOTH registrations, so
 * the two entries share one instance (framework-constructed per entry only
 * when a factory is passed instead).
 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client';
/**
 * Create the green-meter panel store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createGreenMeterPanelStore() {
    return defineStore({
        init: () => ({ open: false }),
        actions: {
            toggle: (draft) => { draft.open = !draft.open; },
            close: (draft) => { draft.open = false; },
        },
    });
}
//# sourceMappingURL=store.js.map