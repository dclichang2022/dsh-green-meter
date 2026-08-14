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
import { H20_MODEL_PROFILES, H20_PROFILES, H20_PROXY_COEFFICIENTS, } from "./h20-profiles.generated.js";
/** Context length the decode-context coefficient is normalized against. */
export const CONTEXT_NORMALIZER_TOKENS = 32768;
/**
 * Ceiling for the decode-context term. The H20 fits clamp `min(ctx, 65536)`,
 * matching the largest context measured in the calibration experiments;
 * beyond that the linear context-rent term would be pure extrapolation.
 */
export const CONTEXT_CAP_TOKENS = 65536;
/** Default grid carbon intensity in kg CO2e per kWh (China 2024 national average). */
export const DEFAULT_CARBON_FACTOR_KG_PER_KWH = 0.5777;
/** Default residential electricity price in CNY per kWh (China average, ~2024). */
export const DEFAULT_ELECTRICITY_PRICE_CNY_PER_KWH = 0.56;
/** CO2 absorbed by one adult tree per year, in kg (widely cited ~20 kg). */
export const TREE_CO2_KG_PER_YEAR = 20;
/** Profile keys accepted by the plugin configuration. */
export const PROFILE_KEYS = [
    // Legacy RTX 3090 / Qwen3-4B fits (kept for the original experiments).
    'qwen3-4b-instruct',
    'qwen3-4b-thinking',
    // H20 request-level fits (primary profiles).
    'qwen-h20-instant',
    'qwen-h20-thinking',
    'gemma-h20-instant',
    'gemma-h20-thinking',
    'qwen-h20',
    'gemma-h20',
    'proxy',
];
const H20_HARDWARE = 'H20 / BF16 / vLLM, 334 canonical agentic tasks';
/** Build one H20-backed profile entry from the generated coefficient table. */
function h20Profile(sourceKey, label) {
    // All keys passed here exist in one of the two generated tables.
    const source = H20_PROFILES[sourceKey] ?? H20_MODEL_PROFILES[sourceKey];
    const fit = source.nRequests > 0
        ? { nRequests: source.nRequests, r2: source.r2, medianRelErr: source.medianRelErr }
        : undefined;
    return {
        profileId: `h20-${sourceKey}-v1`,
        modelLabel: label,
        prefillJPerToken: source.a,
        decodeBaseJPerToken: source.b,
        decodeContextJPerToken: source.c,
        calibration: `${H20_HARDWARE}, request-level NNLS`,
        confidence: 'measured-fit',
        ...fit === undefined ? {} : { fit },
    };
}
/** Profiles keyed by configuration key (all `*-h20-*` plus the proxy). */
export const MODEL_PROFILES = {
    'qwen3-4b-instruct': {
        profileId: 'handoff-e2-instruct-v1',
        modelLabel: 'Qwen3-4B-Instruct-2507 (RTX 3090)',
        prefillJPerToken: 0.0703270418813685,
        decodeBaseJPerToken: 3.67187210972265,
        decodeContextJPerToken: 2.1958596391647727,
        calibration: 'DABStep-30 / RTX 3090 / BF16 / vLLM 0.9.2',
        confidence: 'measured-fit',
        fit: { nRequests: 893, r2: 0.999754, medianRelErr: 0.0243 },
    },
    'qwen3-4b-thinking': {
        profileId: 'handoff-e2-thinking-v1',
        modelLabel: 'Qwen3-4B-Thinking-2507 (RTX 3090)',
        prefillJPerToken: 0.0705920988523323,
        decodeBaseJPerToken: 3.3038388838007173,
        decodeContextJPerToken: 2.7077499379782055,
        calibration: 'DABStep-30 / RTX 3090 / BF16 / vLLM 0.9.2',
        confidence: 'measured-fit',
        fit: { nRequests: 156, r2: 0.999617, medianRelErr: 0.0123 },
    },
    'qwen-h20-instant': h20Profile('qwen-h20-instant', 'Qwen3.5-27B instant'),
    'qwen-h20-thinking': h20Profile('qwen-h20-thinking', 'Qwen3.5-27B thinking'),
    'gemma-h20-instant': h20Profile('gemma-h20-instant', 'Gemma-4-31B-it instant'),
    'gemma-h20-thinking': h20Profile('gemma-h20-thinking', 'Gemma-4-31B-it thinking'),
    'qwen-h20': h20Profile('qwen-h20', 'Qwen3.5-27B (instant+thinking mean)'),
    'gemma-h20': h20Profile('gemma-h20', 'Gemma-4-31B-it (instant+thinking mean)'),
    'proxy': {
        profileId: 'h20-proxy-v1',
        modelLabel: 'Unknown model (H20 Qwen3.5-27B / Gemma-4-31B mean)',
        prefillJPerToken: H20_PROXY_COEFFICIENTS.a,
        decodeBaseJPerToken: H20_PROXY_COEFFICIENTS.b,
        decodeContextJPerToken: H20_PROXY_COEFFICIENTS.c,
        calibration: `${H20_HARDWARE}; mean of the four per-config fits`,
        confidence: 'proxy',
        fit: {
            nRequests: H20_PROXY_COEFFICIENTS.nRequests,
            r2: H20_PROXY_COEFFICIENTS.r2,
            medianRelErr: H20_PROXY_COEFFICIENTS.medianRelErr,
        },
    },
};
/**
 * Resolve a configured profile key to a profile. Unknown keys fall back to
 * the H20 proxy profile, mirroring the vLLM plugin's fail-open behavior.
 * @param key - configured profile key, or undefined for the proxy default.
 */
export function resolveProfile(key) {
    if (key !== undefined && key in MODEL_PROFILES)
        return MODEL_PROFILES[key];
    return MODEL_PROFILES.proxy;
}
/**
 * Best-effort model-id keyword matching for deployments that know their
 * serving model: exact profile keys win, then keyword hints, then proxy.
 * @param modelId - provider model identifier, e.g. `qwen3.5-27b` or `gemma-4`.
 */
export function selectProfile(modelId) {
    if (modelId === undefined)
        return MODEL_PROFILES.proxy;
    const id = modelId.toLowerCase();
    if (id.includes('qwen3-4b'))
        return MODEL_PROFILES['qwen3-4b-instruct'];
    if (id.includes('qwen'))
        return MODEL_PROFILES['qwen-h20'];
    if (id.includes('gemma'))
        return MODEL_PROFILES['gemma-h20'];
    return MODEL_PROFILES.proxy;
}
//# sourceMappingURL=profiles.js.map