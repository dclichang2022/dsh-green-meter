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
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import { type ProfileKey } from './profiles.ts';
import { type GreenMeterStep, type GreenMeterTurn } from './types.ts';
/** Fold accumulator; plain JSON per the projection-unit contract. */
interface GreenMeterFoldState {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    energyJ: number;
    carbonG: number;
    turns: GreenMeterTurn[];
    steps: GreenMeterStep[];
}
/** Build the projection unit for one resolved profile + carbon factor. */
export declare function greenMeterProjectionDefinition(profileKey: ProfileKey, carbonFactor: number, budgetJ?: number, priceCnyPerKwh?: number): ProjectionDefinition<'greenMeter', GreenMeterFoldState | null>;
export {};
//# sourceMappingURL=projection.d.ts.map