import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useEffect } from 'react';
import { EnergyPanelBody } from "./SidebarEnergyPanel.js";
import { panelActions, usePanelState } from "./store.js";
import css from './GreenMeterDock.module.css';
/** J → J/kJ/MJ, mirroring the /green report's energy formatting. */
export function formatEnergy(joules) {
    if (joules >= 1_000_000)
        return `${(joules / 1_000_000).toFixed(2)} MJ`;
    if (joules >= 1_000)
        return `${(joules / 1_000).toFixed(1)} kJ`;
    return `${joules.toFixed(1)} J`;
}
/** One bar per turn, width 2px + 1px gap, normalized to the series max. */
function bars(turns, barWidth, gap, height) {
    const max = Math.max(1, ...turns.map(turn => turn.energyJ));
    return turns.map((turn, index) => {
        const h = Math.max(1, Math.round(turn.energyJ / max * height));
        return (_jsx("rect", { x: index * (barWidth + gap), y: height - h, width: barWidth, height: h, "data-turn": turn.turn }, turn.turn));
    });
}
/**
 * Inline SVG per-turn energy bars; renders nothing for an empty series.
 * The viewBox uses a FIXED slot grid (`maxTurns` slots × 3px) with bars
 * left-aligned from the first slot, so CSS stretching (panel charts use
 * width:100%) keeps bar proportions stable — a lone turn renders as one
 * normal-width bar at the left edge.
 */
export function EnergyBars({ turns, maxTurns, height = 14 }) {
    const shown = turns.slice(-maxTurns);
    if (shown.length === 0)
        return null;
    const slots = Math.max(maxTurns, 1);
    const width = slots * 3;
    return (_jsx("svg", { className: css.spark, width: width, height: height, viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", "data-green-meter": "bars", "aria-hidden": "true", children: bars(shown, 2, 1, height) }));
}
/**
 * Floating detail card for the `popover` placement: the same panel body as
 * the sidebar seat, anchored above the readout.
 */
export function PopoverPanel({ meter, t, onClose }) {
    return (_jsxs("div", { className: css.popoverPanel, "data-green-meter": "panel", children: [_jsxs("div", { className: css.panelHead, children: [_jsx("span", { className: css.panelTitle, children: t('panelTitle') }), _jsx("button", { className: css.close, onClick: onClose, "data-green-meter": "close", children: t('close') })] }), _jsx(EnergyPanelBody, { meter: meter, t: t })] }));
}
export function GreenMeterDock({ useProjection, placement, t }) {
    const meter = useProjection('greenMeter');
    const { open } = usePanelState();
    // Mirror the live snapshot into the shared panel state so root-scoped panel
    // placements (the shell.overlay drawer) can render without session kit.
    useEffect(() => {
        panelActions.setMeter(meter ?? null);
    }, [meter]);
    if (meter === undefined)
        return null;
    if (meter === null) {
        return _jsx("div", { className: css.root, "data-green-meter": "empty", children: t('empty') });
    }
    return (_jsxs("div", { className: css.root, "data-green-meter": "live", children: [_jsxs("button", { className: css.trigger, onClick: () => { panelActions.toggle(); }, "data-green-meter": "toggle", children: [_jsx("span", { children: t('energy', { value: formatEnergy(meter.energyJ) }) }), _jsx("span", { className: css.sep, "aria-hidden": true, children: "\u00B7" }), _jsx("span", { children: t('carbon', { value: meter.carbonG.toFixed(1) }) }), _jsx(EnergyBars, { turns: meter.turns, maxTurns: 40 })] }), placement === 'popover' && open
                ? _jsx(PopoverPanel, { meter: meter, t: t, onClose: () => { panelActions.close(); } })
                : null] }));
}
//# sourceMappingURL=GreenMeterDock.js.map