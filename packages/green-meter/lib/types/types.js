/**
 * Pure types of the green-meter domain: the ONE home of the `greenMeter`
 * projection-key declaration. Free of the package's host-side value imports
 * (cordis, node builtins, the estimator), so client aggregates may merge the
 * key through `@deepseek-ai/dsh-green-meter/client` without dragging the host
 * root in. Mirrors dsh-session-stats/types and dsh-goal/types.
 * @module @deepseek-ai/dsh-green-meter/types
 */
/** Cap on the per-turn series kept in the projection. */
export const GREEN_METER_MAX_TURNS = 60;
/** Cap on the per-request series kept in the projection. */
export const GREEN_METER_MAX_STEPS = 100;
//# sourceMappingURL=types.js.map