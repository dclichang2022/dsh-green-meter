/**
 * Pure types of the green-meter domain: the ONE home of the `greenMeter`
 * projection-key declaration. Free of the package's host-side value imports
 * (cordis, node builtins, the estimator), so client aggregates may merge the
 * key through `@deepseek-ai/dsh-green-meter/client` without dragging the host
 * root in. Mirrors dsh-session-stats/types and dsh-goal/types.
 * @module @deepseek-ai/dsh-green-meter/types
 */
export {};
/** One turn's energy/carbon aggregate in the live per-turn series. */
export interface GreenMeterTurn {
    /** 1-based turn index. */
    readonly turn: number;
    /** Accounted model steps in this turn. */
    readonly steps: number;
    /** Estimated energy in joules. */
    readonly energyJ: number;
    /** Estimated carbon in grams CO2e. */
    readonly carbonG: number;
}
/** One model call's estimate in the live per-request series. */
export interface GreenMeterStep {
    /** 1-based turn index. */
    readonly turn: number;
    /** 1-based step index inside the turn (one step = one model request). */
    readonly step: number;
    /** Uncached prompt input tokens. */
    readonly inputTokens: number;
    /** Output tokens including reasoning. */
    readonly outputTokens: number;
    /** Estimated energy in joules. */
    readonly energyJ: number;
    /** Estimated carbon in grams CO2e. */
    readonly carbonG: number;
}
/** Live per-session energy/carbon readout; `null` until the first billable step. */
export interface GreenMeterProjection {
    /** Accounted model steps so far. */
    readonly requests: number;
    /** Uncached prompt input tokens. */
    readonly inputTokens: number;
    /** Output tokens including reasoning. */
    readonly outputTokens: number;
    /** Reasoning tokens. */
    readonly reasoningTokens: number;
    /** Summed estimated energy in joules. */
    readonly energyJ: number;
    /** Summed estimated carbon in grams CO2e. */
    readonly carbonG: number;
    /** Resolved calibration profile id. */
    readonly profileId: string;
    /** Calibration confidence. */
    readonly confidence: 'measured-fit' | 'proxy';
    /**
     * Per-turn energy series in ascending turn order, capped at the most
     * recent {@link GREEN_METER_MAX_TURNS} turns — the widget's bar chart.
     */
    readonly turns: readonly GreenMeterTurn[];
    /**
     * Per-request energy series in ascending (turn, step) order, capped at the
     * most recent {@link GREEN_METER_MAX_STEPS} model calls — the panel's
     * request-granularity list, matching the trajectory's step markers.
     */
    readonly steps: readonly GreenMeterStep[];
    /** Cache-hit prompt tokens (prefix caching avoided their prefill). */
    readonly cachedTokens: number;
    /**
     * Counterfactual energy saved by prefix caching: the prefill work those
     * cache-hit tokens would otherwise have cost (a * cachedTokens).
     */
    readonly savedEnergyJ: number;
    /** Counterfactual carbon saved by prefix caching, grams CO2e. */
    readonly savedCarbonG: number;
    /**
     * Estimated electricity cost of the session energy, in CNY, at the
     * configured residential price.
     */
    readonly costCny: number;
    /** Electricity price used for the cost estimate, CNY per kWh. */
    readonly priceCnyPerKwh: number;
    /**
     * Configured session energy budget in joules; `0` when the guard is off.
     * Steps are rejected once the cumulative estimate exceeds it.
     */
    readonly budgetJ: number;
}
/** Cap on the per-turn series kept in the projection. */
export declare const GREEN_METER_MAX_TURNS = 60;
/** Cap on the per-request series kept in the projection. */
export declare const GREEN_METER_MAX_STEPS = 100;
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        greenMeter: GreenMeterProjection | null;
    }
}
//# sourceMappingURL=types.d.ts.map