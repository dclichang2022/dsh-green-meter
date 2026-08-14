import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { EnergyBars, formatEnergy } from "./GreenMeterDock.js";
import css from './GreenMeterDock.module.css';
/** CO2 absorbed by one adult tree per year, in kg — mirrors the host's TREE_CO2_KG_PER_YEAR. */
const TREE_CO2_KG_PER_YEAR = 20;
/** Trees-equivalent formatting, mirroring the /green report's formatTrees. */
function formatTrees(trees) {
    if (trees >= 100)
        return Math.round(trees).toLocaleString('en-US');
    if (trees >= 0.05)
        return trees.toFixed(1).replace(/\.0$/, '');
    return '<0.05';
}
/** The shared detail body: per-turn chart, totals, savings, requests, budget. */
export function EnergyPanelBody({ meter, t }) {
    const recent = meter.turns.slice(-24);
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: css.panelChart, "data-green-meter": "chart", children: [_jsx(EnergyBars, { turns: recent, maxTurns: 24, height: 44 }), recent.length > 0
                        ? _jsxs("div", { className: css.chartLabels, "aria-hidden": "true", children: [_jsx("span", { children: t('firstTurn', { value: String(recent[0].turn) }) }), _jsx("span", { children: t('lastTurn', { value: String(recent[recent.length - 1].turn) }) })] })
                        : null] }), _jsxs("dl", { className: css.rows, children: [_jsxs("div", { className: css.row, children: [_jsx("dt", { children: t('requests') }), _jsx("dd", { children: meter.requests })] }), _jsxs("div", { className: css.row, children: [_jsx("dt", { children: t('inputTokens') }), _jsx("dd", { children: meter.inputTokens.toLocaleString('en-US') })] }), _jsxs("div", { className: css.row, children: [_jsx("dt", { children: t('outputTokens') }), _jsx("dd", { children: meter.outputTokens.toLocaleString('en-US') })] }), _jsxs("div", { className: css.row, children: [_jsx("dt", { children: t('energyLabel') }), _jsx("dd", { children: formatEnergy(meter.energyJ) })] }), _jsxs("div", { className: css.row, children: [_jsx("dt", { children: t('carbonTotal') }), _jsxs("dd", { children: [meter.carbonG.toFixed(1), " g CO2e"] })] }), _jsxs("div", { className: css.row, "data-green-meter": "cost", children: [_jsx("dt", { children: t('costLabel') }), _jsx("dd", { children: t('costValue', { value: meter.costCny.toFixed(4) }) })] }), _jsxs("div", { className: css.row, children: [_jsx("dt", { children: t('profile') }), _jsxs("dd", { children: [meter.profileId, " (", meter.confidence, ")"] })] })] }), meter.savedCarbonG > 0
                ? _jsxs("div", { className: css.savings, "data-green-meter": "savings", children: [_jsx("span", { className: css.savingsTitle, children: t('cacheSaved') }), _jsx("span", { className: css.savingsValue, children: t('cacheSavedValue', {
                                value: meter.savedCarbonG.toFixed(1),
                                tokens: meter.cachedTokens.toLocaleString('en-US'),
                            }) }), _jsx("span", { className: css.savingsValue, "data-green-meter": "trees", children: t('treesSaved', { value: formatTrees(meter.savedCarbonG / 1000 / TREE_CO2_KG_PER_YEAR) }) })] })
                : null, meter.steps.length > 0
                ? _jsxs("div", { className: css.requestList, "data-green-meter": "requests", children: [_jsx("div", { className: css.requestTitle, children: t('recentRequests') }), _jsx("ul", { className: css.requestRows, children: [...meter.steps].reverse().map((entry) => (_jsxs("li", { className: css.requestRow, "data-green-meter": "request", children: [_jsx("span", { className: css.requestLabel, children: t('step', { turn: String(entry.turn), step: String(entry.step) }) }), _jsxs("span", { className: css.requestValue, children: [formatEnergy(entry.energyJ), " \u00B7 ", entry.carbonG.toFixed(2), " g \u00B7 ", entry.outputTokens.toLocaleString('en-US'), " tok"] })] }, `${entry.turn}-${entry.step}`))) })] })
                : null, meter.budgetJ > 0
                ? _jsx("div", { className: css.budget, "data-green-meter": "budget", children: meter.energyJ > meter.budgetJ
                        ? t('budgetOver')
                        : t('budgetOn', {
                            value: formatEnergy(meter.budgetJ),
                            percent: String(Math.round(meter.energyJ / meter.budgetJ * 100)),
                        }) })
                : null] }));
}
/** The sidebar detail panel; closed/absent states render nothing. */
export function SidebarEnergyPanel({ useProjection, useStore, actions, t }) {
    const open = useStore(state => state.open);
    const meter = useProjection('greenMeter');
    if (!open || meter === undefined || meter === null)
        return null;
    return (_jsxs("div", { className: css.sidebarPanel, "data-green-meter": "sidebar-panel", children: [_jsxs("div", { className: css.panelHead, children: [_jsx("span", { className: css.panelTitle, children: t('panelTitle') }), _jsx("button", { className: css.close, onClick: () => { actions.close(); }, "data-green-meter": "close", children: t('close') })] }), _jsx(EnergyPanelBody, { meter: meter, t: t })] }));
}
//# sourceMappingURL=SidebarEnergyPanel.js.map