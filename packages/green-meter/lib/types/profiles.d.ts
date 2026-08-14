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
export declare const CONTEXT_NORMALIZER_TOKENS = 32768;
/**
 * Ceiling for the decode-context term. The H20 fits clamp `min(ctx, 65536)`,
 * matching the largest context measured in the calibration experiments;
 * beyond that the linear context-rent term would be pure extrapolation.
 */
export declare const CONTEXT_CAP_TOKENS = 65536;
/** Default grid carbon intensity in kg CO2e per kWh (China 2024 national average). */
export declare const DEFAULT_CARBON_FACTOR_KG_PER_KWH = 0.5777;
/** Default residential electricity price in CNY per kWh (China average, ~2024). */
export declare const DEFAULT_ELECTRICITY_PRICE_CNY_PER_KWH = 0.56;
/** CO2 absorbed by one adult tree per year, in kg (widely cited ~20 kg). */
export declare const TREE_CO2_KG_PER_YEAR = 20;
/** Fit diagnostics recorded with a profile, surfaced in `/green` reports. */
export interface ProfileFit {
    readonly nRequests: number;
    readonly r2: number;
    readonly medianRelErr: number;
}
/** One calibrated model profile: the per-token coefficients of the fit. */
export interface ModelProfile {
    readonly profileId: string;
    readonly modelLabel: string;
    readonly prefillJPerToken: number;
    readonly decodeBaseJPerToken: number;
    readonly decodeContextJPerToken: number;
    readonly calibration: string;
    readonly confidence: 'measured-fit' | 'proxy';
    readonly fit?: ProfileFit;
}
/** Profile keys accepted by the plugin configuration. */
export declare const PROFILE_KEYS: readonly ["qwen3-4b-instruct", "qwen3-4b-thinking", "qwen-h20-instant", "qwen-h20-thinking", "gemma-h20-instant", "gemma-h20-thinking", "qwen-h20", "gemma-h20", "proxy"];
export type ProfileKey = typeof PROFILE_KEYS[number];
/** Profiles keyed by configuration key (all `*-h20-*` plus the proxy). */
export declare const MODEL_PROFILES: Readonly<Record<ProfileKey, ModelProfile>>;
/**
 * Resolve a configured profile key to a profile. Unknown keys fall back to
 * the H20 proxy profile, mirroring the vLLM plugin's fail-open behavior.
 * @param key - configured profile key, or undefined for the proxy default.
 */
export declare function resolveProfile(key: string | undefined): ModelProfile;
/**
 * Best-effort model-id keyword matching for deployments that know their
 * serving model: exact profile keys win, then keyword hints, then proxy.
 * @param modelId - provider model identifier, e.g. `qwen3.5-27b` or `gemma-4`.
 */
export declare function selectProfile(modelId: string | undefined): ModelProfile;
//# sourceMappingURL=profiles.d.ts.map