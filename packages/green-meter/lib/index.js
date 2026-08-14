import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { z } from "zod";
const H20_PROFILES = {
	"qwen-h20-instant": {
		a: .1472796518,
		b: 8.8999022474,
		c: .7736639824,
		nRequests: 1434,
		r2: .999596,
		medianRelErr: .028229
	},
	"qwen-h20-thinking": {
		a: .1434396374,
		b: 8.7922757907,
		c: .8881486801,
		nRequests: 1301,
		r2: .999739,
		medianRelErr: .026014
	},
	"gemma-h20-instant": {
		a: .2061794517,
		b: 10.558868673,
		c: 1.3962853656,
		nRequests: 1202,
		r2: .9983,
		medianRelErr: .024305
	},
	"gemma-h20-thinking": {
		a: .2093063688,
		b: 10.6376018484,
		c: 1.2931363736,
		nRequests: 1188,
		r2: .999427,
		medianRelErr: .012332
	}
};
const H20_MODEL_PROFILES = {
	"qwen-h20": {
		a: .1453596446,
		b: 8.8460890191,
		c: .8309063313,
		nRequests: 0,
		r2: 0,
		medianRelErr: 0
	},
	"gemma-h20": {
		a: .2077429103,
		b: 10.5982352607,
		c: 1.3447108696,
		nRequests: 0,
		r2: 0,
		medianRelErr: 0
	}
};
const H20_PROXY_COEFFICIENTS = {
	a: .1765512774,
	b: 9.7221621399,
	c: 1.0878086004,
	nRequests: 5125,
	r2: .982134,
	medianRelErr: .124239
};
//#endregion
//#region lib/types/profiles.js
/**
* Versioned token-to-energy calibration profiles.
*
* Two calibration families:
*  - `qwen3-4b-*` (legacy): the `handoff-e2-v1` fits from the original LLM
*    Powermeter experiments on a single RTX 3090 / BF16 / vLLM 0.9.2
*    (Qwen3-4B, 1049 scheduler-attributed requests).
*  - `*-h20*` (current): request-level non-negative least-squares fits over
*    5125 conservation-filtered requests from the frozen H20 experiment
*    dataset (Qwen3.5-27B and Gemma-4-31B-it, DABStep/Terminal-Bench/
*    SWE-bench-Pro agentic workloads). These are the primary profiles: the
*    H20 coefficients were fitted on modern API-scale models with median
*    relative errors of 1.2-2.8%, replacing the 4B/3090 extrapolation as the
*    general-purpose default.
*
* @module @deepseek-ai/dsh-green-meter/profiles
*/
/** Context length the decode-context coefficient is normalized against. */
const CONTEXT_NORMALIZER_TOKENS = 32768;
/**
* Ceiling for the decode-context term. The H20 fits clamp `min(ctx, 65536)`,
* matching the largest context measured in the calibration experiments;
* beyond that the linear context-rent term would be pure extrapolation.
*/
const CONTEXT_CAP_TOKENS = 65536;
/** Default grid carbon intensity in kg CO2e per kWh (China 2024 national average). */
const DEFAULT_CARBON_FACTOR_KG_PER_KWH = .5777;
/** Default residential electricity price in CNY per kWh (China average, ~2024). */
const DEFAULT_ELECTRICITY_PRICE_CNY_PER_KWH = .56;
/** Profile keys accepted by the plugin configuration. */
const PROFILE_KEYS = [
	"qwen3-4b-instruct",
	"qwen3-4b-thinking",
	"qwen-h20-instant",
	"qwen-h20-thinking",
	"gemma-h20-instant",
	"gemma-h20-thinking",
	"qwen-h20",
	"gemma-h20",
	"proxy"
];
const H20_HARDWARE = "H20 / BF16 / vLLM, 334 canonical agentic tasks";
/** Build one H20-backed profile entry from the generated coefficient table. */
function h20Profile(sourceKey, label) {
	const source = H20_PROFILES[sourceKey] ?? H20_MODEL_PROFILES[sourceKey];
	const fit = source.nRequests > 0 ? {
		nRequests: source.nRequests,
		r2: source.r2,
		medianRelErr: source.medianRelErr
	} : void 0;
	return {
		profileId: `h20-${sourceKey}-v1`,
		modelLabel: label,
		prefillJPerToken: source.a,
		decodeBaseJPerToken: source.b,
		decodeContextJPerToken: source.c,
		calibration: `${H20_HARDWARE}, request-level NNLS`,
		confidence: "measured-fit",
		...fit === void 0 ? {} : { fit }
	};
}
/** Profiles keyed by configuration key (all `*-h20-*` plus the proxy). */
const MODEL_PROFILES = {
	"qwen3-4b-instruct": {
		profileId: "handoff-e2-instruct-v1",
		modelLabel: "Qwen3-4B-Instruct-2507 (RTX 3090)",
		prefillJPerToken: .0703270418813685,
		decodeBaseJPerToken: 3.67187210972265,
		decodeContextJPerToken: 2.1958596391647727,
		calibration: "DABStep-30 / RTX 3090 / BF16 / vLLM 0.9.2",
		confidence: "measured-fit",
		fit: {
			nRequests: 893,
			r2: .999754,
			medianRelErr: .0243
		}
	},
	"qwen3-4b-thinking": {
		profileId: "handoff-e2-thinking-v1",
		modelLabel: "Qwen3-4B-Thinking-2507 (RTX 3090)",
		prefillJPerToken: .0705920988523323,
		decodeBaseJPerToken: 3.3038388838007173,
		decodeContextJPerToken: 2.7077499379782055,
		calibration: "DABStep-30 / RTX 3090 / BF16 / vLLM 0.9.2",
		confidence: "measured-fit",
		fit: {
			nRequests: 156,
			r2: .999617,
			medianRelErr: .0123
		}
	},
	"qwen-h20-instant": h20Profile("qwen-h20-instant", "Qwen3.5-27B instant"),
	"qwen-h20-thinking": h20Profile("qwen-h20-thinking", "Qwen3.5-27B thinking"),
	"gemma-h20-instant": h20Profile("gemma-h20-instant", "Gemma-4-31B-it instant"),
	"gemma-h20-thinking": h20Profile("gemma-h20-thinking", "Gemma-4-31B-it thinking"),
	"qwen-h20": h20Profile("qwen-h20", "Qwen3.5-27B (instant+thinking mean)"),
	"gemma-h20": h20Profile("gemma-h20", "Gemma-4-31B-it (instant+thinking mean)"),
	"proxy": {
		profileId: "h20-proxy-v1",
		modelLabel: "Unknown model (H20 Qwen3.5-27B / Gemma-4-31B mean)",
		prefillJPerToken: H20_PROXY_COEFFICIENTS.a,
		decodeBaseJPerToken: H20_PROXY_COEFFICIENTS.b,
		decodeContextJPerToken: H20_PROXY_COEFFICIENTS.c,
		calibration: `${H20_HARDWARE}; mean of the four per-config fits`,
		confidence: "proxy",
		fit: {
			nRequests: H20_PROXY_COEFFICIENTS.nRequests,
			r2: H20_PROXY_COEFFICIENTS.r2,
			medianRelErr: H20_PROXY_COEFFICIENTS.medianRelErr
		}
	}
};
/**
* Resolve a configured profile key to a profile. Unknown keys fall back to
* the H20 proxy profile, mirroring the vLLM plugin's fail-open behavior.
* @param key - configured profile key, or undefined for the proxy default.
*/
function resolveProfile(key) {
	if (key !== void 0 && key in MODEL_PROFILES) return MODEL_PROFILES[key];
	return MODEL_PROFILES.proxy;
}
/**
* Best-effort model-id keyword matching for deployments that know their
* serving model: exact profile keys win, then keyword hints, then proxy.
* @param modelId - provider model identifier, e.g. `qwen3.5-27b` or `gemma-4`.
*/
function selectProfile(modelId) {
	if (modelId === void 0) return MODEL_PROFILES.proxy;
	const id = modelId.toLowerCase();
	if (id.includes("qwen3-4b")) return MODEL_PROFILES["qwen3-4b-instruct"];
	if (id.includes("qwen")) return MODEL_PROFILES["qwen-h20"];
	if (id.includes("gemma")) return MODEL_PROFILES["gemma-h20"];
	return MODEL_PROFILES.proxy;
}
//#endregion
//#region lib/types/estimator.js
/**
* Pure token-to-energy estimation: converts one model call's token accounting
* into joules and grams CO2e using a calibrated {@link ModelProfile}.
*
* The token vocabulary mirrors the DSH `TokenUsage` split: input is uncached
* prompt only, cached reads are reported separately, and reasoning tokens are
* billed as decode work — the same disjoint accounting the handoff regression
* was fitted against.
*
* @module @deepseek-ai/dsh-green-meter/estimator
*/
/** Convert joules to grams CO2e under a grid factor in kg CO2e per kWh. */
function carbonGrams(energyJ, factorKgPerKwh) {
	return Math.max(0, energyJ) / 36e5 * factorKgPerKwh * 1e3;
}
/**
* Estimate one model call's energy and carbon.
* @param usage - disjoint token accounting reported for the call.
* @param contextTokensEst - estimated KV context length during decode.
* @param profile - calibrated coefficient profile to apply.
* @param carbonFactor - grid intensity in kg CO2e per kWh.
* @returns phase-split energy and carbon estimate; all token inputs are
* clamped to non-negative values.
*/
function estimateStep(usage, contextTokensEst, profile, carbonFactor) {
	const prefillTokens = Math.max(0, Math.trunc(usage.inputTokens ?? 0));
	const decodeTokens = Math.max(0, Math.trunc(usage.outputTokens ?? 0)) + Math.max(0, Math.trunc(usage.reasoningTokens ?? 0));
	const contextTokens = Math.min(CONTEXT_CAP_TOKENS, Math.max(0, contextTokensEst));
	const prefillJ = profile.prefillJPerToken * prefillTokens;
	const decodeJ = (profile.decodeBaseJPerToken + profile.decodeContextJPerToken * contextTokens / CONTEXT_NORMALIZER_TOKENS) * decodeTokens;
	const energyJ = prefillJ + decodeJ;
	return {
		prefillTokens,
		decodeTokens,
		prefillJ,
		decodeJ,
		energyJ,
		carbonG: carbonGrams(energyJ, carbonFactor),
		profileId: profile.profileId,
		confidence: profile.confidence
	};
}
//#endregion
//#region lib/types/ledger.js
/**
* Session-level tracking, durable JSONL ledger, and human-facing report
* rendering for the green-meter plugin.
*
* The ledger is the authoritative aggregation source: rows are appended per
* accounted model step, and `/green` re-reads the file so a plugin reload
* (HMR) mid-session cannot lose or double-count history. The tracker itself
* is stateless (per-request context semantics), so reloads cannot drift it.
*
* @module @deepseek-ai/dsh-green-meter/ledger
*/
/** Schema version stamped on every ledger row. */
const STEP_SCHEMA_VERSION = "dsh-green-meter.step.v1";
/**
* Stateless per-request context estimator. The context seen during one
* request's decode is the request's own prompt surface (uncached input plus
* cached reads) plus roughly half of its own output — the scheduler hook's
* `context_len` semantics (computed-before plus scheduled, averaged over the
* request's decode steps). No state accumulates across requests, so a plugin
* reload (HMR) cannot drift or double-count; cached prefixes are never summed
* across requests. The estimator caps the context term at the calibration
* ceiling (64K) regardless.
*/
var SessionTracker = class {
	profileKey;
	carbonFactor;
	constructor(profileKey, carbonFactor) {
		this.profileKey = profileKey;
		this.carbonFactor = carbonFactor;
	}
	/**
	* Account one `assistant/message` step. Returns a ledger row, or null when
	* the step carries no billable token accounting.
	*/
	record(sessionId, turn, step, usage) {
		const input = Math.max(0, Math.trunc(usage.inputTokens ?? 0));
		const cached = Math.max(0, Math.trunc(usage.cacheReadTokens ?? 0));
		const output = Math.max(0, Math.trunc(usage.outputTokens ?? 0));
		const reasoning = Math.max(0, Math.trunc(usage.reasoningTokens ?? 0));
		if (input + cached + output + reasoning === 0) return null;
		const contextTokensEst = input + cached + Math.floor((output + reasoning) / 2);
		const estimate = estimateStep(usage, contextTokensEst, resolveProfile(this.profileKey), this.carbonFactor);
		return {
			schema_version: STEP_SCHEMA_VERSION,
			ts_wall: (/* @__PURE__ */ new Date()).toISOString(),
			session_id: sessionId,
			turn,
			step,
			input_tokens: input,
			cached_read_tokens: cached,
			output_tokens: output,
			reasoning_tokens: reasoning,
			context_tokens_est: contextTokensEst,
			energy_j: round4$1(estimate.energyJ),
			carbon_g: round4$1(estimate.carbonG),
			profile_id: estimate.profileId,
			confidence: estimate.confidence,
			method: "token-profile-estimate"
		};
	}
};
function round4$1(value) {
	return Math.round(value * 1e4) / 1e4;
}
/**
* Append-only JSONL writer. Appends are promise-chained so rows stay ordered
* without blocking the session event loop; the ledger remains authoritative
* even if a write is still in flight when a command reads it (the in-flight
* row is at most a few milliseconds stale).
*/
var LedgerWriter = class {
	path;
	chain = Promise.resolve();
	dirCreated = false;
	constructor(path) {
		this.path = path;
	}
	append(record) {
		this.chain = this.chain.then(async () => {
			if (!this.dirCreated) {
				await mkdir(dirname(this.path), { recursive: true });
				this.dirCreated = true;
			}
			await appendFile(this.path, JSON.stringify(record) + "\n", "utf8");
		});
		return this.chain;
	}
	/** Settle all queued writes; used by tests and teardown. */
	flush() {
		return this.chain;
	}
};
/** Read and parse the ledger; malformed or foreign-schema lines are skipped. */
async function scanLedger(path) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return [];
	}
	const rows = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			const record = JSON.parse(trimmed);
			if (typeof record === "object" && record !== null && record.schema_version === "dsh-green-meter.step.v1" && record.method === "token-profile-estimate") rows.push(record);
		} catch {}
	}
	return rows;
}
/** Fold one session's rows into totals. */
function computeTotals(rows) {
	let requests = 0;
	let inputTokens = 0;
	let cachedReadTokens = 0;
	let outputTokens = 0;
	let reasoningTokens = 0;
	let energyJ = 0;
	let carbonG = 0;
	for (const row of rows) {
		requests += 1;
		inputTokens += row.input_tokens;
		cachedReadTokens += row.cached_read_tokens;
		outputTokens += row.output_tokens;
		reasoningTokens += row.reasoning_tokens;
		energyJ += row.energy_j;
		carbonG += row.carbon_g;
	}
	return {
		requests,
		inputTokens,
		cachedReadTokens,
		outputTokens,
		reasoningTokens,
		energyJ,
		carbonG
	};
}
function formatNumber(value) {
	return value.toLocaleString("en-US");
}
function formatEnergy(joules) {
	if (joules >= 1e6) return `${(joules / 1e6).toFixed(2)} MJ`;
	if (joules >= 1e3) return `${(joules / 1e3).toFixed(1)} kJ`;
	return `${joules.toFixed(1)} J`;
}
/** Trees-equivalent formatting: sensible precision for the savings callout. */
function formatTrees(trees) {
	if (trees >= 100) return Math.round(trees).toLocaleString("en-US");
	if (trees >= .05) return trees.toFixed(1).replace(/\.0$/, "");
	return "<0.05";
}
/** Per-turn energy breakdown rows (turn, steps, energy, carbon). */
function turnBreakdown(rows) {
	const byTurn = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const entry = byTurn.get(row.turn) ?? {
			steps: 0,
			energyJ: 0,
			carbonG: 0
		};
		entry.steps += 1;
		entry.energyJ += row.energy_j;
		entry.carbonG += row.carbon_g;
		byTurn.set(row.turn, entry);
	}
	return byTurn;
}
/**
* Render the `/green` report for one session. Plain text so it reads well in
* any command surface; never enters model context.
*/
function formatSessionReport(rows, sessionId, profile, carbonFactor, budgetJ, priceCnyPerKwh, ledgerPath) {
	const totals = computeTotals(rows);
	const lines = ["Green Meter — energy & carbon estimate", ""];
	lines.push(`Session        : ${sessionId}`);
	lines.push("Method         : token-profile estimate (no hardware measurement)");
	lines.push(`Profile        : ${profile.profileId} — ${profile.modelLabel} (${profile.confidence})`);
	lines.push(`Calibration    : ${profile.calibration}`);
	if (profile.fit !== void 0) lines.push(`Fit quality    : ${profile.fit.nRequests} requests, R2=${profile.fit.r2.toFixed(4)}, median error ${(profile.fit.medianRelErr * 100).toFixed(1)}%`);
	lines.push(`Carbon factor  : ${carbonFactor} kg CO2e/kWh`, "");
	lines.push(`Electricity    : ${priceCnyPerKwh} CNY/kWh (China residential average)`, "");
	if (budgetJ > 0) {
		const remaining = Math.max(0, budgetJ - totals.energyJ);
		const status = totals.energyJ > budgetJ ? "EXCEEDED (new steps rejected)" : `${(totals.energyJ / budgetJ * 100).toFixed(0)}% used`;
		lines.push(`Budget         : ${formatEnergy(budgetJ)} — ${status}, ${formatEnergy(remaining)} remaining`, "");
	}
	if (totals.requests === 0) {
		lines.push("No model steps recorded for this session yet.");
		lines.push("");
		lines.push(`Ledger: ${ledgerPath}`);
		lines.push("");
		lines.push("Method boundary: GPU operational energy modeled from token counts with the");
		lines.push(`${profile.calibration} calibration. API-side inference on other hardware or`);
		lines.push("models is an engineering estimate, not a measurement; CPU, host memory,");
		lines.push("cooling, and embodied carbon are outside this boundary.");
		return lines.join("\n");
	}
	lines.push(`Requests       : ${formatNumber(totals.requests)}`);
	lines.push(`Input tokens   : ${formatNumber(totals.inputTokens)} (cached read ${formatNumber(totals.cachedReadTokens)})`);
	lines.push(`Output tokens  : ${formatNumber(totals.outputTokens)} (reasoning ${formatNumber(totals.reasoningTokens)})`);
	lines.push(`Est. energy    : ${formatEnergy(totals.energyJ)} (${(totals.energyJ / 36e5).toFixed(4)} kWh)`);
	lines.push(`Est. carbon    : ${totals.carbonG.toFixed(1)} g CO2e`);
	lines.push(`Est. cost      : ~¥${(totals.energyJ / 36e5 * priceCnyPerKwh).toFixed(4)} (${priceCnyPerKwh} CNY/kWh)`);
	if (totals.cachedReadTokens > 0) {
		const savedCarbonG = carbonGrams(profile.prefillJPerToken * totals.cachedReadTokens, carbonFactor);
		const trees = savedCarbonG / 1e3 / 20;
		lines.push(`Cache savings  : ~${savedCarbonG.toFixed(1)} g CO2e (${formatNumber(totals.cachedReadTokens)} cached tokens skipped prefill, counterfactual)`);
		lines.push(`                 ≈ ${formatTrees(trees)} 棵树一年的吸碳量`);
	}
	const outputTokens = totals.outputTokens + totals.reasoningTokens;
	if (outputTokens > 0) lines.push(`J / out token  : ${(totals.energyJ / outputTokens).toFixed(2)}`);
	const byTurn = [...turnBreakdown(rows).entries()].sort(([a], [b]) => a - b);
	if (byTurn.length > 0) {
		lines.push("");
		lines.push("Energy per turn (last 10):");
		for (const [turn, entry] of byTurn.slice(-10)) lines.push(`  turn ${String(turn).padStart(2)}: ${entry.steps} step(s), ${formatEnergy(entry.energyJ)}, ${entry.carbonG.toFixed(1)} g CO2e`);
	}
	lines.push("");
	lines.push(`Ledger: ${ledgerPath}`);
	lines.push("");
	lines.push("Method boundary: GPU operational energy modeled from token counts with the");
	lines.push(`${profile.calibration} calibration. API-side inference on other hardware or`);
	lines.push("models is an engineering estimate, not a measurement; CPU, host memory,");
	lines.push("cooling, and embodied carbon are outside this boundary.");
	return lines.join("\n");
}
//#endregion
//#region lib/types/projection.js
/**
* The `greenMeter` projection unit: a pure synchronous fold of
* `assistant/message` usage into per-session energy/carbon totals plus a
* capped per-turn series, so the Web widget reads host-computed live values
* through `useProjection('greenMeter')` — totals for the readout label and
* the series for the bar chart.
*
* Same-reference discipline: a non-billable event returns the previous state,
* so the registry's Object.is gate skips all downstream work. Per-step values
* are rounded like the ledger rows, so widget totals agree with `/green`.
*
* @module @deepseek-ai/dsh-green-meter/projection
*/
const EMPTY = {
	requests: 0,
	inputTokens: 0,
	outputTokens: 0,
	reasoningTokens: 0,
	cachedTokens: 0,
	energyJ: 0,
	carbonG: 0,
	turns: [],
	steps: []
};
const turnSchema = z.object({
	turn: z.number().int().positive(),
	steps: z.number().int().nonnegative(),
	energyJ: z.number().nonnegative(),
	carbonG: z.number().nonnegative()
}).strict();
const stepSchema = z.object({
	turn: z.number().int().positive(),
	step: z.number().int().positive(),
	inputTokens: z.number().nonnegative(),
	outputTokens: z.number().nonnegative(),
	energyJ: z.number().nonnegative(),
	carbonG: z.number().nonnegative()
}).strict();
const greenMeterSchema = z.object({
	requests: z.number().int().nonnegative(),
	inputTokens: z.number().nonnegative(),
	outputTokens: z.number().nonnegative(),
	reasoningTokens: z.number().nonnegative(),
	cachedTokens: z.number().nonnegative(),
	energyJ: z.number().nonnegative(),
	carbonG: z.number().nonnegative(),
	savedEnergyJ: z.number().nonnegative(),
	savedCarbonG: z.number().nonnegative(),
	costCny: z.number().nonnegative(),
	priceCnyPerKwh: z.number().nonnegative(),
	profileId: z.string(),
	confidence: z.enum(["measured-fit", "proxy"]),
	turns: z.array(turnSchema).max(60),
	steps: z.array(stepSchema).max(100),
	budgetJ: z.number().nonnegative()
}).strict();
/** Round to 4 decimals — matches the ledger row so widget totals agree with /green. */
function round4(value) {
	return Math.round(value * 1e4) / 1e4;
}
/** Append one step's estimate to the per-turn series, capped at the latest N. */
function appendTurn(turns, turn, energyJ, carbonG) {
	const last = turns.at(-1);
	if (last !== void 0 && last.turn === turn) {
		const updated = {
			turn: last.turn,
			steps: last.steps + 1,
			energyJ: round4(last.energyJ + energyJ),
			carbonG: round4(last.carbonG + carbonG)
		};
		return [...turns.slice(0, -1), updated];
	}
	const entry = {
		turn,
		steps: 1,
		energyJ: round4(energyJ),
		carbonG: round4(carbonG)
	};
	const extended = [...turns, entry];
	return extended.length > 60 ? extended.slice(-60) : extended;
}
/** Append one model call to the per-request series, capped at the latest N. */
function appendStep(steps, turn, step, input, output, energyJ, carbonG) {
	const entry = {
		turn,
		step,
		inputTokens: input,
		outputTokens: output,
		energyJ: round4(energyJ),
		carbonG: round4(carbonG)
	};
	const extended = [...steps, entry];
	return extended.length > 100 ? extended.slice(-100) : extended;
}
/** Build the projection unit for one resolved profile + carbon factor. */
function greenMeterProjectionDefinition(profileKey, carbonFactor, budgetJ = 0, priceCnyPerKwh = .56) {
	const profile = resolveProfile(profileKey);
	return {
		key: "greenMeter",
		schema: greenMeterSchema.nullable(),
		init: () => null,
		apply: (state, event) => {
			if (event.type !== "assistant/message" || event.data.usage === void 0) return state;
			const usage = event.data.usage;
			const input = Math.max(0, Math.trunc(usage.inputTokens ?? 0));
			const cached = Math.max(0, Math.trunc(usage.cacheReadTokens ?? 0));
			const output = Math.max(0, Math.trunc(usage.outputTokens ?? 0));
			const reasoning = Math.max(0, Math.trunc(usage.reasoningTokens ?? 0));
			if (input + cached + output + reasoning === 0) return state;
			const estimate = estimateStep(usage, input + cached + Math.floor((output + reasoning) / 2), profile, carbonFactor);
			const prev = state ?? EMPTY;
			return {
				requests: prev.requests + 1,
				inputTokens: prev.inputTokens + input,
				outputTokens: prev.outputTokens + output + reasoning,
				reasoningTokens: prev.reasoningTokens + reasoning,
				cachedTokens: prev.cachedTokens + cached,
				energyJ: round4(prev.energyJ + estimate.energyJ),
				carbonG: round4(prev.carbonG + estimate.carbonG),
				turns: appendTurn(prev.turns, event.data.turn, estimate.energyJ, estimate.carbonG),
				steps: appendStep(prev.steps, event.data.turn, event.data.step, input, output + reasoning, estimate.energyJ, estimate.carbonG)
			};
		},
		view: (state) => state === null ? null : {
			requests: state.requests,
			inputTokens: state.inputTokens,
			outputTokens: state.outputTokens,
			reasoningTokens: state.reasoningTokens,
			cachedTokens: state.cachedTokens,
			energyJ: state.energyJ,
			carbonG: state.carbonG,
			savedEnergyJ: round4(profile.prefillJPerToken * state.cachedTokens),
			savedCarbonG: round4(carbonGrams(profile.prefillJPerToken * state.cachedTokens, carbonFactor)),
			costCny: round4(state.energyJ / 36e5 * priceCnyPerKwh),
			priceCnyPerKwh,
			profileId: profile.profileId,
			confidence: profile.confidence,
			turns: state.turns,
			steps: state.steps,
			budgetJ
		},
		stateVersion: 5
	};
}
//#endregion
//#region lib/types/index.js
/**
* Green Meter: token-profile energy and carbon estimation for agentic
* sessions.
*
* The plugin observes durable `assistant/message` events, converts each
* step's disjoint token accounting into joules and grams CO2e with the
* calibrated `handoff-e2-v1` profiles, appends one row per accounted step to
* a JSONL ledger under the Harness home, and registers the human-facing
* `/green` slash command that renders the session report.
*
* This is an estimate-only path: it never touches hardware. When the
* deployment also runs the vLLM green-meter plugin on the same host, its
* measured ledger can be joined on session-scoped task tags later.
*
* @module @deepseek-ai/dsh-green-meter
*/
const name = "green-meter";
const inject = ["commands", "tools"];
function profileKeyFrom(config) {
	const fromConfig = config.profile;
	const fromEnv = process.env.DSH_GREEN_PROFILE;
	const candidate = fromConfig ?? fromEnv;
	return PROFILE_KEYS.includes(candidate ?? "") ? candidate : "proxy";
}
function carbonFactorFrom(config) {
	const fromEnv = process.env.DSH_GREEN_CARBON_FACTOR;
	const value = config.carbonFactorKgPerKwh ?? (fromEnv === void 0 ? void 0 : Number(fromEnv));
	if (value === void 0 || !Number.isFinite(value) || value < 0) return DEFAULT_CARBON_FACTOR_KG_PER_KWH;
	return value;
}
function electricityPriceFrom(config) {
	const fromEnv = process.env.DSH_GREEN_PRICE_CNY;
	const value = config.electricityPriceCnyPerKwh ?? (fromEnv === void 0 ? void 0 : Number(fromEnv));
	if (value === void 0 || !Number.isFinite(value) || value <= 0) return DEFAULT_ELECTRICITY_PRICE_CNY_PER_KWH;
	return value;
}
function ledgerPathFrom(config) {
	return join(config.dir ?? process.env.DSH_GREEN_DIR ?? join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "green-meter"), "ledger.jsonl");
}
function budgetFrom(config) {
	const fromEnv = process.env.DSH_GREEN_BUDGET_J;
	const value = config.budgetJ ?? (fromEnv === void 0 ? void 0 : Number(fromEnv));
	if (value === void 0 || !Number.isFinite(value) || value <= 0) return 0;
	return value;
}
/** Value-schema declaration for the `green_meter` tool output. */
const GREEN_QUERY_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		session_id: {
			type: "string",
			required: true
		},
		method: {
			type: "string",
			required: true
		},
		profile_id: {
			type: "string",
			required: true
		},
		confidence: {
			type: "string",
			required: true,
			enum: ["measured-fit", "proxy"]
		},
		requests: {
			type: "integer",
			required: true
		},
		input_tokens: {
			type: "integer",
			required: true
		},
		output_tokens: {
			type: "integer",
			required: true
		},
		reasoning_tokens: {
			type: "integer",
			required: true
		},
		energy_j: {
			type: "number",
			required: true
		},
		energy_kwh: {
			type: "number",
			required: true
		},
		carbon_g: {
			type: "number",
			required: true
		},
		cost_cny: {
			type: "number",
			required: true
		},
		price_cny_per_kwh: {
			type: "number",
			required: true
		},
		budget: {
			type: "object",
			additionalProperties: false,
			properties: {
				budget_j: {
					type: "number",
					required: true
				},
				remaining_j: {
					type: "number",
					required: true
				},
				over_budget: {
					type: "boolean",
					required: true
				}
			}
		}
	}
};
/**
* Mount the green-meter plugin: session event accounting plus the `/green`
* command. Monitoring failures are contained — they must never break the
* agent loop, matching the vLLM plugin's fail-open discipline.
*/
function apply(ctx, config = {}) {
	const profileKey = profileKeyFrom(config);
	const carbonFactor = carbonFactorFrom(config);
	const priceCnyPerKwh = electricityPriceFrom(config);
	const ledgerPath = ledgerPathFrom(config);
	const budgetJ = budgetFrom(config);
	const writer = new LedgerWriter(ledgerPath);
	const tracker = new SessionTracker(profileKey, carbonFactor);
	const energyTotals = /* @__PURE__ */ new Map();
	ctx.on("session/event", (session, event) => {
		if (event.type !== "assistant/message" || event.data.usage === void 0) return;
		try {
			const record = tracker.record(session.id, event.data.turn, event.data.step, event.data.usage);
			if (record !== null) {
				energyTotals.set(session.id, (energyTotals.get(session.id) ?? 0) + record.energy_j);
				writer.append(record);
			}
		} catch {}
	});
	ctx.inject(["sessionProjections"], (projectionCtx) => {
		projectionCtx.sessionProjections.register(greenMeterProjectionDefinition(profileKey, carbonFactor, budgetJ, priceCnyPerKwh));
	});
	if (budgetJ > 0) {
		const warned = /* @__PURE__ */ new Set();
		ctx.on("agent/pre-step", (payload, next) => {
			const used = energyTotals.get(payload.agent.session.id) ?? 0;
			if (used <= budgetJ) return next();
			if (!warned.has(payload.agent.session.id)) {
				warned.add(payload.agent.session.id);
				try {
					payload.agent.inject(createUserMessage({
						content: [{
							type: "text",
							text: `Green Meter: this session's estimated energy (${Math.round(used / 1e3)} kJ) has exceeded the configured budget (${Math.round(budgetJ / 1e3)} kJ); new steps are rejected until the budget is raised or the session ends.`
						}],
						source: {
							kind: "plugin",
							plugin: "green-meter"
						}
					}));
				} catch {}
			}
			return Promise.resolve({ kind: "reject" });
		});
	}
	ctx.commands.register({
		name: "green",
		description: "show this session's estimated energy and carbon footprint",
		recordInput: false,
		handler: (invocation) => reportCommand(invocation, profileKey, carbonFactor, budgetJ, priceCnyPerKwh, ledgerPath)
	});
	ctx.tools.register(defineTool({
		name: "green_meter",
		description: "Query this session's estimated GPU energy and carbon footprint. Token-profile estimate from the green-meter calibration; no hardware measurement. Reports cumulative session totals plus the configured energy budget when one is set.",
		parameters: {},
		output: {
			schema: GREEN_QUERY_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value)
			}]
		},
		execute: (_args, exec) => toolQuery(exec, profileKey, budgetJ, priceCnyPerKwh, ledgerPath)
	}));
	ctx.effect(() => async () => {
		await writer.flush();
	});
}
/** Resolve the handler's session rows from the authoritative ledger. */
async function reportCommand(invocation, profileKey, carbonFactor, budgetJ, priceCnyPerKwh, ledgerPath) {
	const sessionId = invocation.agent.session.id;
	return {
		kind: "success",
		text: formatSessionReport((await scanLedger(ledgerPath)).filter((row) => row.session_id === sessionId), sessionId, resolveProfile(profileKey), carbonFactor, budgetJ, priceCnyPerKwh, ledgerPath)
	};
}
/** Resolve one `green_meter` tool call from the authoritative ledger. */
async function toolQuery(exec, profileKey, budgetJ, priceCnyPerKwh, ledgerPath) {
	const sessionId = exec.agent?.session.id;
	if (sessionId === void 0) throw new Error("green_meter requires a calling agent session");
	const totals = computeTotals((await scanLedger(ledgerPath)).filter((row) => row.session_id === sessionId));
	const profile = resolveProfile(profileKey);
	const budget = budgetJ > 0 ? {
		budget_j: budgetJ,
		remaining_j: Math.max(0, budgetJ - totals.energyJ),
		over_budget: totals.energyJ > budgetJ
	} : void 0;
	return {
		session_id: sessionId,
		method: "token-profile-estimate",
		profile_id: profile.profileId,
		confidence: profile.confidence,
		requests: totals.requests,
		input_tokens: totals.inputTokens,
		output_tokens: totals.outputTokens,
		reasoning_tokens: totals.reasoningTokens,
		energy_j: Math.round(totals.energyJ * 1e4) / 1e4,
		energy_kwh: totals.energyJ / 36e5,
		carbon_g: Math.round(totals.carbonG * 1e4) / 1e4,
		cost_cny: Math.round(totals.energyJ / 36e5 * priceCnyPerKwh * 1e4) / 1e4,
		price_cny_per_kwh: priceCnyPerKwh,
		...budget === void 0 ? {} : { budget }
	};
}
//#endregion
export { DEFAULT_CARBON_FACTOR_KG_PER_KWH, LedgerWriter, PROFILE_KEYS, SessionTracker, apply, carbonGrams, computeTotals, estimateStep, formatSessionReport, inject, name, resolveProfile, scanLedger, selectProfile };
