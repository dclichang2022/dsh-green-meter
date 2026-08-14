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
import { DEFAULT_CARBON_FACTOR_KG_PER_KWH, type ModelProfile, type ProfileKey } from './profiles.ts';
import { carbonGrams, estimateStep, type StepUsage } from './estimator.ts';
/** Schema version stamped on every ledger row. */
export declare const STEP_SCHEMA_VERSION = "dsh-green-meter.step.v1";
/** One durable ledger row: an accounted model step with its estimate. */
export interface StepRecord {
    readonly schema_version: typeof STEP_SCHEMA_VERSION;
    readonly ts_wall: string;
    readonly session_id: string;
    readonly turn: number;
    readonly step: number;
    readonly input_tokens: number;
    readonly cached_read_tokens: number;
    readonly output_tokens: number;
    readonly reasoning_tokens: number;
    readonly context_tokens_est: number;
    readonly energy_j: number;
    readonly carbon_g: number;
    readonly profile_id: string;
    readonly confidence: 'measured-fit' | 'proxy';
    readonly method: 'token-profile-estimate';
}
/** Aggregated totals folded from one session's ledger rows. */
export interface SessionTotals {
    readonly requests: number;
    readonly inputTokens: number;
    readonly cachedReadTokens: number;
    readonly outputTokens: number;
    readonly reasoningTokens: number;
    readonly energyJ: number;
    readonly carbonG: number;
}
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
export declare class SessionTracker {
    private readonly profileKey;
    private readonly carbonFactor;
    constructor(profileKey: ProfileKey, carbonFactor: number);
    /**
     * Account one `assistant/message` step. Returns a ledger row, or null when
     * the step carries no billable token accounting.
     */
    record(sessionId: string, turn: number, step: number, usage: StepUsage): StepRecord | null;
}
/**
 * Append-only JSONL writer. Appends are promise-chained so rows stay ordered
 * without blocking the session event loop; the ledger remains authoritative
 * even if a write is still in flight when a command reads it (the in-flight
 * row is at most a few milliseconds stale).
 */
export declare class LedgerWriter {
    readonly path: string;
    private chain;
    private dirCreated;
    constructor(path: string);
    append(record: StepRecord): Promise<void>;
    /** Settle all queued writes; used by tests and teardown. */
    flush(): Promise<void>;
}
/** Read and parse the ledger; malformed or foreign-schema lines are skipped. */
export declare function scanLedger(path: string): Promise<StepRecord[]>;
/** Fold one session's rows into totals. */
export declare function computeTotals(rows: readonly StepRecord[]): SessionTotals;
/** Trees-equivalent formatting: sensible precision for the savings callout. */
export declare function formatTrees(trees: number): string;
/**
 * Render the `/green` report for one session. Plain text so it reads well in
 * any command surface; never enters model context.
 */
export declare function formatSessionReport(rows: readonly StepRecord[], sessionId: string, profile: ModelProfile, carbonFactor: number, budgetJ: number, priceCnyPerKwh: number, ledgerPath: string): string;
export { carbonGrams, estimateStep };
export { DEFAULT_CARBON_FACTOR_KG_PER_KWH };
//# sourceMappingURL=ledger.d.ts.map