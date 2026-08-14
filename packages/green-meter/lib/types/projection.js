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
import { z } from 'zod';
import { carbonGrams, estimateStep } from "./estimator.js";
import { resolveProfile } from "./profiles.js";
import { GREEN_METER_MAX_STEPS, GREEN_METER_MAX_TURNS, } from "./types.js";
const EMPTY = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    energyJ: 0,
    carbonG: 0,
    turns: [],
    steps: [],
};
const turnSchema = z.object({
    turn: z.number().int().positive(),
    steps: z.number().int().nonnegative(),
    energyJ: z.number().nonnegative(),
    carbonG: z.number().nonnegative(),
}).strict();
const stepSchema = z.object({
    turn: z.number().int().positive(),
    step: z.number().int().positive(),
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    energyJ: z.number().nonnegative(),
    carbonG: z.number().nonnegative(),
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
    confidence: z.enum(['measured-fit', 'proxy']),
    turns: z.array(turnSchema).max(GREEN_METER_MAX_TURNS),
    steps: z.array(stepSchema).max(GREEN_METER_MAX_STEPS),
    budgetJ: z.number().nonnegative(),
}).strict();
/** Round to 4 decimals — matches the ledger row so widget totals agree with /green. */
function round4(value) {
    return Math.round(value * 10_000) / 10_000;
}
/** Append one step's estimate to the per-turn series, capped at the latest N. */
function appendTurn(turns, turn, energyJ, carbonG) {
    const last = turns.at(-1);
    if (last !== undefined && last.turn === turn) {
        const updated = {
            turn: last.turn,
            steps: last.steps + 1,
            energyJ: round4(last.energyJ + energyJ),
            carbonG: round4(last.carbonG + carbonG),
        };
        return [...turns.slice(0, -1), updated];
    }
    const entry = { turn, steps: 1, energyJ: round4(energyJ), carbonG: round4(carbonG) };
    const extended = [...turns, entry];
    return extended.length > GREEN_METER_MAX_TURNS ? extended.slice(-GREEN_METER_MAX_TURNS) : extended;
}
/** Append one model call to the per-request series, capped at the latest N. */
function appendStep(steps, turn, step, input, output, energyJ, carbonG) {
    const entry = {
        turn,
        step,
        inputTokens: input,
        outputTokens: output,
        energyJ: round4(energyJ),
        carbonG: round4(carbonG),
    };
    const extended = [...steps, entry];
    return extended.length > GREEN_METER_MAX_STEPS ? extended.slice(-GREEN_METER_MAX_STEPS) : extended;
}
/** Build the projection unit for one resolved profile + carbon factor. */
export function greenMeterProjectionDefinition(profileKey, carbonFactor, budgetJ = 0, priceCnyPerKwh = 0.56) {
    const profile = resolveProfile(profileKey);
    return {
        key: 'greenMeter',
        schema: greenMeterSchema.nullable(),
        init: () => null,
        apply: (state, event) => {
            if (event.type !== 'assistant/message' || event.data.usage === undefined)
                return state;
            const usage = event.data.usage;
            const input = Math.max(0, Math.trunc(usage.inputTokens ?? 0));
            const cached = Math.max(0, Math.trunc(usage.cacheReadTokens ?? 0));
            const output = Math.max(0, Math.trunc(usage.outputTokens ?? 0));
            const reasoning = Math.max(0, Math.trunc(usage.reasoningTokens ?? 0));
            if (input + cached + output + reasoning === 0)
                return state;
            const contextTokensEst = input + cached + Math.floor((output + reasoning) / 2);
            const estimate = estimateStep(usage, contextTokensEst, profile, carbonFactor);
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
                steps: appendStep(prev.steps, event.data.turn, event.data.step, input, output + reasoning, estimate.energyJ, estimate.carbonG),
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
            costCny: round4(state.energyJ / 3_600_000 * priceCnyPerKwh),
            priceCnyPerKwh,
            profileId: profile.profileId,
            confidence: profile.confidence,
            turns: state.turns,
            steps: state.steps,
            budgetJ,
        },
        stateVersion: 5,
    };
}
//# sourceMappingURL=projection.js.map