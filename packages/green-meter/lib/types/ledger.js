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
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { appendFile, readFile } from 'node:fs/promises';
import { DEFAULT_CARBON_FACTOR_KG_PER_KWH, TREE_CO2_KG_PER_YEAR, resolveProfile, } from "./profiles.js";
import { carbonGrams, estimateStep } from "./estimator.js";
/** Schema version stamped on every ledger row. */
export const STEP_SCHEMA_VERSION = 'dsh-green-meter.step.v1';
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
export class SessionTracker {
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
        if (input + cached + output + reasoning === 0)
            return null;
        const contextTokensEst = input + cached + Math.floor((output + reasoning) / 2);
        const profile = resolveProfile(this.profileKey);
        const estimate = estimateStep(usage, contextTokensEst, profile, this.carbonFactor);
        return {
            schema_version: STEP_SCHEMA_VERSION,
            ts_wall: new Date().toISOString(),
            session_id: sessionId,
            turn,
            step,
            input_tokens: input,
            cached_read_tokens: cached,
            output_tokens: output,
            reasoning_tokens: reasoning,
            context_tokens_est: contextTokensEst,
            energy_j: round4(estimate.energyJ),
            carbon_g: round4(estimate.carbonG),
            profile_id: estimate.profileId,
            confidence: estimate.confidence,
            method: 'token-profile-estimate',
        };
    }
}
function round4(value) {
    return Math.round(value * 10_000) / 10_000;
}
/**
 * Append-only JSONL writer. Appends are promise-chained so rows stay ordered
 * without blocking the session event loop; the ledger remains authoritative
 * even if a write is still in flight when a command reads it (the in-flight
 * row is at most a few milliseconds stale).
 */
export class LedgerWriter {
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
            await appendFile(this.path, JSON.stringify(record) + '\n', 'utf8');
        });
        return this.chain;
    }
    /** Settle all queued writes; used by tests and teardown. */
    flush() {
        return this.chain;
    }
}
/** Read and parse the ledger; malformed or foreign-schema lines are skipped. */
export async function scanLedger(path) {
    let text;
    try {
        text = await readFile(path, 'utf8');
    }
    catch {
        return [];
    }
    const rows = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0)
            continue;
        try {
            const record = JSON.parse(trimmed);
            if (typeof record === 'object' && record !== null
                && record.schema_version === STEP_SCHEMA_VERSION
                && record.method === 'token-profile-estimate') {
                rows.push(record);
            }
        }
        catch {
            // A torn or foreign line must not break the whole report.
        }
    }
    return rows;
}
/** Fold one session's rows into totals. */
export function computeTotals(rows) {
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
    return { requests, inputTokens, cachedReadTokens, outputTokens, reasoningTokens, energyJ, carbonG };
}
function formatNumber(value) {
    return value.toLocaleString('en-US');
}
function formatEnergy(joules) {
    if (joules >= 1_000_000)
        return `${(joules / 1_000_000).toFixed(2)} MJ`;
    if (joules >= 1_000)
        return `${(joules / 1_000).toFixed(1)} kJ`;
    return `${joules.toFixed(1)} J`;
}
/** Trees-equivalent formatting: sensible precision for the savings callout. */
export function formatTrees(trees) {
    if (trees >= 100)
        return Math.round(trees).toLocaleString('en-US');
    if (trees >= 0.05)
        return trees.toFixed(1).replace(/\.0$/, '');
    return '<0.05';
}
/** Per-turn energy breakdown rows (turn, steps, energy, carbon). */
function turnBreakdown(rows) {
    const byTurn = new Map();
    for (const row of rows) {
        const entry = byTurn.get(row.turn) ?? { steps: 0, energyJ: 0, carbonG: 0 };
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
export function formatSessionReport(rows, sessionId, profile, carbonFactor, budgetJ, priceCnyPerKwh, ledgerPath) {
    const totals = computeTotals(rows);
    const lines = ['Green Meter — energy & carbon estimate', ''];
    lines.push(`Session        : ${sessionId}`);
    lines.push('Method         : token-profile estimate (no hardware measurement)');
    lines.push(`Profile        : ${profile.profileId} — ${profile.modelLabel} (${profile.confidence})`);
    lines.push(`Calibration    : ${profile.calibration}`);
    if (profile.fit !== undefined) {
        lines.push(`Fit quality    : ${profile.fit.nRequests} requests, R2=${profile.fit.r2.toFixed(4)},`
            + ` median error ${(profile.fit.medianRelErr * 100).toFixed(1)}%`);
    }
    lines.push(`Carbon factor  : ${carbonFactor} kg CO2e/kWh`, '');
    lines.push(`Electricity    : ${priceCnyPerKwh} CNY/kWh (China residential average)`, '');
    if (budgetJ > 0) {
        const remaining = Math.max(0, budgetJ - totals.energyJ);
        const status = totals.energyJ > budgetJ ? 'EXCEEDED (new steps rejected)' : `${(totals.energyJ / budgetJ * 100).toFixed(0)}% used`;
        lines.push(`Budget         : ${formatEnergy(budgetJ)} — ${status}, ${formatEnergy(remaining)} remaining`, '');
    }
    if (totals.requests === 0) {
        lines.push('No model steps recorded for this session yet.');
        lines.push('');
        lines.push(`Ledger: ${ledgerPath}`);
        lines.push('');
        lines.push('Method boundary: GPU operational energy modeled from token counts with the');
        lines.push(`${profile.calibration} calibration. API-side inference on other hardware or`);
        lines.push('models is an engineering estimate, not a measurement; CPU, host memory,');
        lines.push('cooling, and embodied carbon are outside this boundary.');
        return lines.join('\n');
    }
    lines.push(`Requests       : ${formatNumber(totals.requests)}`);
    lines.push(`Input tokens   : ${formatNumber(totals.inputTokens)} (cached read ${formatNumber(totals.cachedReadTokens)})`);
    lines.push(`Output tokens  : ${formatNumber(totals.outputTokens)} (reasoning ${formatNumber(totals.reasoningTokens)})`);
    lines.push(`Est. energy    : ${formatEnergy(totals.energyJ)} (${(totals.energyJ / 3_600_000).toFixed(4)} kWh)`);
    lines.push(`Est. carbon    : ${totals.carbonG.toFixed(1)} g CO2e`);
    lines.push(`Est. cost      : ~¥${(totals.energyJ / 3_600_000 * priceCnyPerKwh).toFixed(4)}`
        + ` (${priceCnyPerKwh} CNY/kWh)`);
    if (totals.cachedReadTokens > 0) {
        const savedJ = profile.prefillJPerToken * totals.cachedReadTokens;
        const savedCarbonG = carbonGrams(savedJ, carbonFactor);
        const trees = savedCarbonG / 1000 / TREE_CO2_KG_PER_YEAR;
        lines.push(`Cache savings  : ~${savedCarbonG.toFixed(1)} g CO2e`
            + ` (${formatNumber(totals.cachedReadTokens)} cached tokens skipped prefill, counterfactual)`);
        lines.push(`                 ≈ ${formatTrees(trees)} 棵树一年的吸碳量`);
    }
    const outputTokens = totals.outputTokens + totals.reasoningTokens;
    if (outputTokens > 0) {
        lines.push(`J / out token  : ${(totals.energyJ / outputTokens).toFixed(2)}`);
    }
    const byTurn = [...turnBreakdown(rows).entries()].sort(([a], [b]) => a - b);
    if (byTurn.length > 0) {
        lines.push('');
        lines.push('Energy per turn (last 10):');
        for (const [turn, entry] of byTurn.slice(-10)) {
            lines.push(`  turn ${String(turn).padStart(2)}: ${entry.steps} step(s), ${formatEnergy(entry.energyJ)}, ${entry.carbonG.toFixed(1)} g CO2e`);
        }
    }
    lines.push('');
    lines.push(`Ledger: ${ledgerPath}`);
    lines.push('');
    lines.push('Method boundary: GPU operational energy modeled from token counts with the');
    lines.push(`${profile.calibration} calibration. API-side inference on other hardware or`);
    lines.push('models is an engineering estimate, not a measurement; CPU, host memory,');
    lines.push('cooling, and embodied carbon are outside this boundary.');
    return lines.join('\n');
}
export { carbonGrams, estimateStep };
export { DEFAULT_CARBON_FACTOR_KG_PER_KWH };
//# sourceMappingURL=ledger.js.map