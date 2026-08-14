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
import type { Context } from '@deepseek-ai/cordis';
import { type ProfileKey } from './profiles.ts';
export declare const name = "green-meter";
export declare const inject: string[];
/** Plugin row configuration; environment variables act as fallbacks. */
export interface GreenMeterConfig {
    /** Calibration profile key; unknown keys fall back to `proxy`. */
    readonly profile?: ProfileKey;
    /** Grid carbon intensity in kg CO2e per kWh. */
    readonly carbonFactorKgPerKwh?: number;
    /** Residential electricity price in CNY per kWh (China average default). */
    readonly electricityPriceCnyPerKwh?: number;
    /** Ledger directory; defaults to `<DSH_HOME>/green-meter`. */
    readonly dir?: string;
    /**
     * Session energy budget in joules; `0`/absent disables the guard. When a
     * session exceeds the budget, new steps are rejected at `agent/pre-step`
     * and one plugin-sourced warning is injected for the model to see.
     */
    readonly budgetJ?: number;
}
/**
 * Mount the green-meter plugin: session event accounting plus the `/green`
 * command. Monitoring failures are contained — they must never break the
 * agent loop, matching the vLLM plugin's fail-open discipline.
 */
export declare function apply(ctx: Context, config?: GreenMeterConfig): void;
export { DEFAULT_CARBON_FACTOR_KG_PER_KWH, PROFILE_KEYS, resolveProfile, selectProfile, type ModelProfile, type ProfileFit, type ProfileKey, } from './profiles.ts';
export { carbonGrams, estimateStep, type StepEstimate, type StepUsage, } from './estimator.ts';
export { computeTotals, formatSessionReport, LedgerWriter, scanLedger, SessionTracker, type SessionTotals, type StepRecord, } from './ledger.ts';
export type { GreenMeterProjection } from './types.ts';
//# sourceMappingURL=index.d.ts.map