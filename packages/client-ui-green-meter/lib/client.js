window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-green-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		//#region \0dsh-css:C:\Users\asus\Documents\Qoder\2026-08-13\chat-4\deepseek-harness\packages\client\ui-green-meter\src\client\GreenMeterDock.module.css.mjs
		const css = ".RQwx2G_root{color:var(--dsw-text-tertiary);white-space:nowrap;align-items:center;gap:6px;font-size:12px;display:inline-flex;position:relative}.RQwx2G_trigger{font:inherit;color:inherit;cursor:pointer;background:0 0;border:none;align-items:center;gap:6px;padding:0;display:inline-flex}.RQwx2G_trigger:hover{color:var(--dsw-text-secondary)}.RQwx2G_sep{color:var(--dsw-text-quaternary)}.RQwx2G_spark{vertical-align:middle;opacity:.9;display:inline-block}.RQwx2G_spark rect{fill:currentColor}.RQwx2G_sidebarPanel{border:1px solid var(--dsw-border);background:var(--dsw-surface);color:var(--dsw-text-secondary);border-radius:8px;padding:10px 12px}.RQwx2G_sidebarPanel .RQwx2G_spark{width:100%;height:auto}.RQwx2G_popoverPanel{z-index:30;border:1px solid var(--dsw-border);background:var(--dsw-surface);width:260px;color:var(--dsw-text-secondary);white-space:normal;border-radius:8px;padding:10px 12px;position:absolute;bottom:calc(100% + 6px);left:0;box-shadow:0 8px 24px #0000001f}.RQwx2G_popoverPanel .RQwx2G_spark{width:100%;height:auto}.RQwx2G_panelHead{justify-content:space-between;align-items:center;margin-bottom:8px;display:flex}.RQwx2G_panelTitle{font-weight:600}.RQwx2G_close{color:var(--dsw-text-tertiary);cursor:pointer;background:0 0;border:none;border-radius:4px;padding:2px 6px;font-size:12px}.RQwx2G_close:hover{color:var(--dsw-text-primary)}.RQwx2G_panelChart{padding:4px 0 2px}.RQwx2G_chartLabels{color:var(--dsw-text-quaternary);justify-content:space-between;font-size:11px;display:flex}.RQwx2G_rows{gap:4px;margin:8px 0 0;display:grid}.RQwx2G_row{justify-content:space-between;gap:12px;display:flex}.RQwx2G_row dt{color:var(--dsw-text-tertiary)}.RQwx2G_row dd{color:var(--dsw-text-secondary);margin:0}.RQwx2G_budget{background:var(--dsw-surface-secondary);border-radius:6px;margin-top:8px;padding:6px 8px;font-size:12px}.RQwx2G_savings{background:#3c9e6d1a;border:1px solid #3c9e6d73;border-radius:6px;flex-direction:column;gap:2px;margin-top:8px;padding:6px 8px;font-size:12px;display:flex}.RQwx2G_savingsTitle{color:#2f8a5c;font-weight:600}.RQwx2G_savingsValue{color:var(--dsw-text-secondary)}.RQwx2G_requestList{border-top:1px solid var(--dsw-border);margin-top:10px;padding-top:8px}.RQwx2G_requestTitle{margin-bottom:4px;font-size:12px;font-weight:600}.RQwx2G_requestRows{max-height:150px;margin:0;padding:0;list-style:none;overflow-y:auto}.RQwx2G_requestRow{justify-content:space-between;gap:8px;padding:2px 0;font-size:11px;line-height:1.5;display:flex}.RQwx2G_requestLabel{color:var(--dsw-text-tertiary);white-space:nowrap}.RQwx2G_requestValue{color:var(--dsw-text-secondary);text-align:right}";
		const tagId = "@deepseek-ai/dsh-client-ui-green-meter/GreenMeterDock.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-green-meter";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var GreenMeterDock_module_css_default = {
			"requestList": "RQwx2G_requestList",
			"budget": "RQwx2G_budget",
			"panelHead": "RQwx2G_panelHead",
			"savingsValue": "RQwx2G_savingsValue",
			"trigger": "RQwx2G_trigger",
			"spark": "RQwx2G_spark",
			"panelTitle": "RQwx2G_panelTitle",
			"savingsTitle": "RQwx2G_savingsTitle",
			"panelChart": "RQwx2G_panelChart",
			"requestRow": "RQwx2G_requestRow",
			"requestValue": "RQwx2G_requestValue",
			"root": "RQwx2G_root",
			"chartLabels": "RQwx2G_chartLabels",
			"sep": "RQwx2G_sep",
			"savings": "RQwx2G_savings",
			"requestLabel": "RQwx2G_requestLabel",
			"sidebarPanel": "RQwx2G_sidebarPanel",
			"requestTitle": "RQwx2G_requestTitle",
			"requestRows": "RQwx2G_requestRows",
			"rows": "RQwx2G_rows",
			"close": "RQwx2G_close",
			"row": "RQwx2G_row",
			"popoverPanel": "RQwx2G_popoverPanel"
		};
		//#endregion
		//#region src/client/SidebarEnergyPanel.tsx
		/** CO2 absorbed by one adult tree per year, in kg — mirrors the host's TREE_CO2_KG_PER_YEAR. */
		const TREE_CO2_KG_PER_YEAR = 20;
		/** Trees-equivalent formatting, mirroring the /green report's formatTrees. */
		function formatTrees(trees) {
			if (trees >= 100) return Math.round(trees).toLocaleString("en-US");
			if (trees >= .05) return trees.toFixed(1).replace(/\.0$/, "");
			return "<0.05";
		}
		/** The shared detail body: per-turn chart, totals, savings, requests, budget. */
		function EnergyPanelBody({ meter, t }) {
			const recent = meter.turns.slice(-24);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GreenMeterDock_module_css_default.panelChart,
					"data-green-meter": "chart",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EnergyBars, {
						turns: recent,
						maxTurns: 24,
						height: 44
					}), recent.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: GreenMeterDock_module_css_default.chartLabels,
						"aria-hidden": "true",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("firstTurn", { value: String(recent[0].turn) }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("lastTurn", { value: String(recent[recent.length - 1].turn) }) })]
					}) : null]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
					className: GreenMeterDock_module_css_default.rows,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GreenMeterDock_module_css_default.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("requests") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: meter.requests })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GreenMeterDock_module_css_default.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("inputTokens") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: meter.inputTokens.toLocaleString("en-US") })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GreenMeterDock_module_css_default.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("outputTokens") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: meter.outputTokens.toLocaleString("en-US") })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GreenMeterDock_module_css_default.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("energyLabel") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: formatEnergy(meter.energyJ) })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GreenMeterDock_module_css_default.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("carbonTotal") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [meter.carbonG.toFixed(1), " g CO2e"] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GreenMeterDock_module_css_default.row,
							"data-green-meter": "cost",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("costLabel") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: t("costValue", { value: meter.costCny.toFixed(4) }) })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GreenMeterDock_module_css_default.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("profile") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
								meter.profileId,
								" (",
								meter.confidence,
								")"
							] })]
						})
					]
				}),
				meter.savedCarbonG > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GreenMeterDock_module_css_default.savings,
					"data-green-meter": "savings",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: GreenMeterDock_module_css_default.savingsTitle,
							children: t("cacheSaved")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: GreenMeterDock_module_css_default.savingsValue,
							children: t("cacheSavedValue", {
								value: meter.savedCarbonG.toFixed(1),
								tokens: meter.cachedTokens.toLocaleString("en-US")
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: GreenMeterDock_module_css_default.savingsValue,
							"data-green-meter": "trees",
							children: t("treesSaved", { value: formatTrees(meter.savedCarbonG / 1e3 / TREE_CO2_KG_PER_YEAR) })
						})
					]
				}) : null,
				meter.steps.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GreenMeterDock_module_css_default.requestList,
					"data-green-meter": "requests",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: GreenMeterDock_module_css_default.requestTitle,
						children: t("recentRequests")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: GreenMeterDock_module_css_default.requestRows,
						children: [...meter.steps].reverse().map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: GreenMeterDock_module_css_default.requestRow,
							"data-green-meter": "request",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: GreenMeterDock_module_css_default.requestLabel,
								children: t("step", {
									turn: String(entry.turn),
									step: String(entry.step)
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: GreenMeterDock_module_css_default.requestValue,
								children: [
									formatEnergy(entry.energyJ),
									" · ",
									entry.carbonG.toFixed(2),
									" g · ",
									entry.outputTokens.toLocaleString("en-US"),
									" tok"
								]
							})]
						}, `${entry.turn}-${entry.step}`))
					})]
				}) : null,
				meter.budgetJ > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: GreenMeterDock_module_css_default.budget,
					"data-green-meter": "budget",
					children: meter.energyJ > meter.budgetJ ? t("budgetOver") : t("budgetOn", {
						value: formatEnergy(meter.budgetJ),
						percent: String(Math.round(meter.energyJ / meter.budgetJ * 100))
					})
				}) : null
			] });
		}
		/** The sidebar detail panel; closed/absent states render nothing. */
		function SidebarEnergyPanel({ useProjection, useStore, actions, t }) {
			const open = useStore((state) => state.open);
			const meter = useProjection("greenMeter");
			if (!open || meter === void 0 || meter === null) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: GreenMeterDock_module_css_default.sidebarPanel,
				"data-green-meter": "sidebar-panel",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GreenMeterDock_module_css_default.panelHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: GreenMeterDock_module_css_default.panelTitle,
						children: t("panelTitle")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: GreenMeterDock_module_css_default.close,
						onClick: () => {
							actions.close();
						},
						"data-green-meter": "close",
						children: t("close")
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EnergyPanelBody, {
					meter,
					t
				})]
			});
		}
		//#endregion
		//#region src/client/GreenMeterDock.tsx
		/** J → J/kJ/MJ, mirroring the /green report's energy formatting. */
		function formatEnergy(joules) {
			if (joules >= 1e6) return `${(joules / 1e6).toFixed(2)} MJ`;
			if (joules >= 1e3) return `${(joules / 1e3).toFixed(1)} kJ`;
			return `${joules.toFixed(1)} J`;
		}
		/** One bar per turn, width 2px + 1px gap, normalized to the series max. */
		function bars(turns, barWidth, gap, height, offset) {
			const max = Math.max(1, ...turns.map((turn) => turn.energyJ));
			return turns.map((turn, index) => {
				const h = Math.max(1, Math.round(turn.energyJ / max * height));
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: (offset + index) * (barWidth + gap),
					y: height - h,
					width: barWidth,
					height: h,
					"data-turn": turn.turn
				}, turn.turn);
			});
		}
		/**
		* Inline SVG per-turn energy bars; renders nothing for an empty series.
		* The viewBox uses a FIXED slot grid (`maxTurns` slots × 3px) with the bars
		* right-aligned, so CSS stretching (panel charts use width:100%) keeps bar
		* proportions stable — a lone turn renders as one normal-width bar at the
		* right edge instead of a giant column.
		*/
		function EnergyBars({ turns, maxTurns, height = 14 }) {
			const shown = turns.slice(-maxTurns);
			if (shown.length === 0) return null;
			const slots = Math.max(maxTurns, 1);
			const width = slots * 3;
			const offset = slots - shown.length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				className: GreenMeterDock_module_css_default.spark,
				width,
				height,
				viewBox: `0 0 ${width} ${height}`,
				preserveAspectRatio: "none",
				"data-green-meter": "bars",
				"aria-hidden": "true",
				children: bars(shown, 2, 1, height, offset)
			});
		}
		/**
		* Floating detail card for the `popover` placement: the same panel body as
		* the sidebar seat, anchored above the readout.
		*/
		function PopoverPanel({ meter, t, onClose }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: GreenMeterDock_module_css_default.popoverPanel,
				"data-green-meter": "panel",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GreenMeterDock_module_css_default.panelHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: GreenMeterDock_module_css_default.panelTitle,
						children: t("panelTitle")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: GreenMeterDock_module_css_default.close,
						onClick: onClose,
						"data-green-meter": "close",
						children: t("close")
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EnergyPanelBody, {
					meter,
					t
				})]
			});
		}
		function GreenMeterDock({ useProjection, useStore, actions, placement, t }) {
			const meter = useProjection("greenMeter");
			const open = useStore((state) => state.open);
			if (meter === void 0) return null;
			if (meter === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: GreenMeterDock_module_css_default.root,
				"data-green-meter": "empty",
				children: t("empty")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: GreenMeterDock_module_css_default.root,
				"data-green-meter": "live",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					className: GreenMeterDock_module_css_default.trigger,
					onClick: () => {
						actions.toggle();
					},
					"data-green-meter": "toggle",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("energy", { value: formatEnergy(meter.energyJ) }) }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: GreenMeterDock_module_css_default.sep,
							"aria-hidden": true,
							children: "·"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("carbon", { value: meter.carbonG.toFixed(1) }) }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EnergyBars, {
							turns: meter.turns,
							maxTurns: 40
						})
					]
				}), placement === "popover" && open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PopoverPanel, {
					meter,
					t,
					onClose: () => {
						actions.close();
					}
				}) : null]
			});
		}
		//#endregion
		//#region src/client/store.ts
		/**
		* Shared viewing-state store for the green-meter surface: the composer-dock
		* readout toggles `open`, the sidebar energy panel renders while it is open.
		* One handle is constructed in `apply` and passed to BOTH registrations, so
		* the two entries share one instance (framework-constructed per entry only
		* when a factory is passed instead).
		*/
		/**
		* Create the green-meter panel store handle.
		* @returns the store handle (spec + type + identity + factory in one).
		*/
		function createGreenMeterPanelStore() {
			return (0, _deepseek_ai_dsh_client_runtime_client.defineStore)({
				init: () => ({ open: false }),
				actions: {
					toggle: (draft) => {
						draft.open = !draft.open;
					},
					close: (draft) => {
						draft.open = false;
					}
				}
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const zh = {
			empty: "能耗 —",
			energy: "能耗 {value}",
			energyLabel: "能耗",
			carbon: "碳 {value} g CO2e",
			panelTitle: "会话能耗明细",
			firstTurn: "第 {value} 轮",
			lastTurn: "第 {value} 轮",
			requests: "请求",
			inputTokens: "输入 token",
			outputTokens: "输出 token",
			carbonTotal: "碳足迹",
			profile: "档案",
			recentRequests: "最近请求",
			step: "第 {turn} 轮 · 第 {step} 步",
			cacheSaved: "缓存节碳",
			cacheSavedValue: "约 {value} g CO2e（{tokens} 命中 token 免于重算 prefill）",
			treesSaved: "≈ {value} 棵树一年的吸碳量",
			costLabel: "电费",
			costValue: "约 ¥{value}",
			budgetOn: "预算 {value}（已用 {percent}%）",
			budgetOver: "预算超支，新步骤已拒绝",
			close: "关闭"
		};
		const en = {
			empty: "Energy —",
			energy: "Energy {value}",
			energyLabel: "Energy",
			carbon: "Carbon {value} g CO2e",
			panelTitle: "Session energy",
			firstTurn: "Turn {value}",
			lastTurn: "Turn {value}",
			requests: "Requests",
			inputTokens: "Input tokens",
			outputTokens: "Output tokens",
			carbonTotal: "Carbon",
			profile: "Profile",
			recentRequests: "Recent requests",
			step: "Turn {turn} · Step {step}",
			cacheSaved: "Carbon saved by caching",
			cacheSavedValue: "~{value} g CO2e ({tokens} cached tokens skipped prefill)",
			treesSaved: "≈ {value} trees absorbing CO2 for a year",
			costLabel: "Electricity",
			costValue: "≈ ¥{value}",
			budgetOn: "Budget {value} ({percent}% used)",
			budgetOver: "Budget exceeded; new steps rejected",
			close: "Close"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "greenMeter";
		/** Required services: the slot registry and the locale service. */
		const inject = ["slots", "locale"];
		/**
		* Client plugin body: the composer-dock readout and the detail panel.
		* `slots.inject` waits on each owner's declaration (apply order is
		* unconstrained) and leaves with this plugin's fiber. One shared store handle
		* carries the open/closed state across both surfaces.
		*/
		function apply(ctx, config = {}) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-green-meter: dictionaries");
			const placement = config.panelPlacement ?? "sidebar";
			const panelStore = createGreenMeterPanelStore();
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "green-meter",
				order: 10,
				locale: NS,
				store: panelStore,
				inject: () => ({ placement })
			}, GreenMeterDock));
			if (placement === "sidebar") ctx.slots.inject("sidebar.energy", () => ctx.slots.register({
				name: "sidebar.energy",
				locale: NS,
				store: panelStore
			}, SidebarEnergyPanel));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map