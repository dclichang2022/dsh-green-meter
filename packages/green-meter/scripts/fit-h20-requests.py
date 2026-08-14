#!/usr/bin/env python3
"""Request-level H20 calibration fit for dsh-green-meter.

Builds a per-request dataset from the extracted attribution.json files
(analysis/h20_request_level/flat) for the 334 canonical tasks, then fits and
compares three estimator models per config:

  A. E1-curve anchor:      E = a * prefill + beta_E1(ctx) * decode
     (a fitted; the measured E1 decode curve anchors the context term)
  B. free NNLS:            E = a * prefill + b * decode + c * decode * ctx/32768
     (the original 3090 parameterization, non-negative least squares)
  C. scaled E1 curve:      E = a * prefill + s * beta_E1(ctx) * decode
     (a and s fitted; keeps the measured shape, recalibrates its level)

Inputs: ../scripts/../.. doesn't exist — see constants below.
Outputs: ../src/h20-profiles.generated.ts with the chosen model's constants
         plus per-model diagnostics as comments.
"""

from __future__ import annotations

import csv
import json
import os
import math
import statistics
from pathlib import Path

import numpy as np
from scipy.optimize import nnls

FROZEN = Path(os.environ.get(
    "GREEN_METER_FROZEN_DIR",
    r"C:/Users/asus/Documents/LLM Powermeter/analysis/frozen_20260809",
))
FLAT = Path(os.environ.get(
    "GREEN_METER_FLAT_DIR",
    r"C:/Users/asus/Documents/LLM Powermeter/analysis/h20_request_level/flat",
))
OUT = Path(__file__).resolve().parent.parent / "src" / "h20-profiles.generated.ts"

CONFIG_KEYS = {
    "Qwen Instant": "qwen-h20-instant",
    "Qwen Thinking": "qwen-h20-thinking",
    "Gemma Instant": "gemma-h20-instant",
    "Gemma Thinking": "gemma-h20-thinking",
}
# Canonical config dir names as they appear in results/ paths.
DIR_OF = {
    "Qwen Instant": "qwen35-27b-instant",
    "Qwen Thinking": "qwen35-27b-thinking",
    "Gemma Instant": "gemma4-31b-instant-compact",
    "Gemma Thinking": "gemma4-31b-thinking-compact",
}
MODEL_OF = {
    "Qwen Instant": "Qwen",
    "Qwen Thinking": "Qwen",
    "Gemma Instant": "Gemma",
    "Gemma Thinking": "Gemma",
}


def interp(curve: list[tuple[float, float]], ctx: float) -> float:
    if ctx <= curve[0][0]:
        return curve[0][1]
    if ctx >= curve[-1][0]:
        return curve[-1][1]
    for (x0, y0), (x1, y1) in zip(curve, curve[1:]):
        if x0 <= ctx <= x1:
            return y0 + (y1 - y0) * (ctx - x0) / (x1 - x0)
    raise AssertionError("unreachable")


def fit_report(name: str, y_true: np.ndarray, y_pred: np.ndarray, n: int) -> dict:
    y_t, y_p = np.asarray(y_true, float), np.asarray(y_pred, float)
    if n == 0:
        return {"name": name, "n": 0, "r2": 0.0, "median_rel_err": 0.0, "p90_rel_err": 0.0}
    ss_res = float(((y_t - y_p) ** 2).sum())
    ss_tot = float(((y_t - y_t.mean()) ** 2).sum())
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
    rel = np.abs(y_p - y_t) / np.maximum(y_t, 1e-6)
    return {
        "name": name, "n": n, "r2": r2,
        "median_rel_err": float(np.median(rel)),
        "p90_rel_err": float(np.percentile(rel, 90)),
    }


def main() -> None:
    # Canonical task set from the frozen CSV.
    canonical: set[tuple[str, str]] = set()
    with open(FROZEN / "canonical_rows.csv", newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            canonical.add((DIR_OF[row["config"]], row["task"]))

    manifest = json.loads((FLAT / "manifest.json").read_text(encoding="utf-8"))
    files: dict[tuple[str, str], Path] = {}
    for entry in manifest:
        parts = entry["tar_path"].split("/")
        # results/<config>/<task>/attribution.json          (len 4)
        # results/<config>/<suite-dir>/<instance>/...json   (len 5, SWE)
        if parts[0] == "results" and parts[-1] == "attribution.json" and len(parts) in (4, 5):
            key = (parts[1], parts[-2])
            if key in canonical:
                files[key] = FLAT / entry["file"]

    e1_raw = json.loads(
        (FROZEN / "canonical_dataset.json").read_text(encoding="utf-8")
    )["summary"]["e1"]
    e1 = {
        model: sorted({(round(p["ctx"], 1), round(p["beta_mean"], 4)) for p in pts})
        for model, pts in e1_raw.items()
    }

    # Per-request rows keyed by display config.
    rows: dict[str, list[dict]] = {k: [] for k in CONFIG_KEYS}
    used = 0
    for (cfg_dir, task), path in files.items():
        display = next(k for k, v in DIR_OF.items() if v == cfg_dir)
        if display not in rows:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        if not data.get("conservation", {}).get("pass", False):
            continue
        for req in data.get("requests", []):
            if req.get("overlap", True):
                continue
            rows[display].append(req)
            used += 1
    print(f"canonical tasks matched: {len(files)}; request rows: {used}")

    # Fit and compare models per config.
    results: dict[str, dict] = {}
    for display, reqs in rows.items():
        prefill = np.array([max(0, r["n_prefill_tokens"]) for r in reqs], float)
        decode = np.array([max(0, r["n_decode_tokens"]) for r in reqs], float)
        ctx = np.array([max(0, r["ctx_max"]) for r in reqs], float)
        energy = np.array([max(0, r["E_total_J"]) for r in reqs], float)
        curve = e1[MODEL_OF[display]]
        beta = np.array([interp(curve, c) for c in ctx])

        # A: a only, E1 curve anchored.
        aA = float((prefill * (energy - beta * decode)).sum() / (prefill * prefill).sum()) \
            if prefill.sum() > 0 else 0.0
        predA = aA * prefill + beta * decode

        # B: free NNLS (a, b, c).
        X = np.column_stack([prefill, decode, decode * ctx / 32768.0])
        coefB, _ = nnls(X, energy)
        predB = X @ coefB

        # C: scaled E1 curve (a, s).
        XC = np.column_stack([prefill, beta * decode])
        coefC, _ = nnls(XC, energy)
        predC = XC @ coefC

        reports = [
            fit_report("A_e1_anchor", energy, predA, len(reqs)),
            fit_report("B_free_nnls", energy, predB, len(reqs)),
            fit_report("C_scaled_e1", energy, predC, len(reqs)),
        ]
        results[display] = {
            "n_requests": len(reqs),
            "aA": aA,
            "coefB": list(coefB),
            "coefC": list(coefC),
            "reports": reports,
        }
        print(f"== {display} ({len(reqs)} requests)")
        for rep in reports:
            print(f"   {rep['name']:14s} r2={rep['r2']:.4f} "
                  f"med_err={rep['median_rel_err']:.1%} p90_err={rep['p90_rel_err']:.1%}")
        print(f"   A: a={aA:.4f}  B: a={coefB[0]:.4f} b={coefB[1]:.4f} c={coefB[2]:.4f}"
              f"  C: a={coefC[0]:.4f} s={coefC[1]:.4f}")

    # Proxy: mean of the four per-config fits (mirrors the 3090 proxy design).
    # A pooled NNLS over mixed-model rows lands on degenerate corners
    # (c -> 0) because one shared (b, c) cannot represent two decode-cost
    # levels at once; the mean-of-fits is the stable general-purpose choice.
    coefPool = np.mean([results[k]["coefB"] for k in CONFIG_KEYS], axis=0)
    all_prefill = np.concatenate([np.array([max(0, r["n_prefill_tokens"]) for r in reqs], float)
                                  for reqs in rows.values()])
    all_decode = np.concatenate([np.array([max(0, r["n_decode_tokens"]) for r in reqs], float)
                                 for reqs in rows.values()])
    all_ctx = np.concatenate([np.array([min(65536.0, max(0, r["ctx_max"])) for r in reqs], float)
                              for reqs in rows.values()])
    all_energy = np.concatenate([np.array([max(0, r["E_total_J"]) for r in reqs], float)
                                 for reqs in rows.values()])
    XB = np.column_stack([all_prefill, all_decode, all_decode * all_ctx / 32768.0])
    predPool = XB @ coefPool
    repPool = fit_report("proxy_mean", all_energy, predPool, len(all_energy))
    print(f"== proxy (mean of fits): a={coefPool[0]:.4f} b={coefPool[1]:.4f} c={coefPool[2]:.4f} "
          f"r2={repPool['r2']:.4f} med_err={repPool['median_rel_err']:.1%}")

    # Emit TypeScript (chosen model: B, free NNLS, ctx capped at 64K).
    lines = [
        "// AUTO-GENERATED by scripts/fit-h20-requests.py from the frozen H20 dataset",
        "// (analysis/frozen_20260809) and per-request attribution records extracted",
        "// from backups/h20_paper_backup_20260809.tar.gz (request-level, conservation",
        "// filtered). Do not edit by hand; rerun the script to regenerate.",
        "//",
        "// Chosen estimator model (B): E = a * uncached_prefill",
        "//   + (b + c * min(ctx, 65536) / 32768) * decode_tokens,",
        "// fitted per config by non-negative least squares on request-level rows.",
        "// Hardware: NVIDIA H20, BF16, vLLM; Qwen3.5-27B / Gemma-4-31B-it.",
        "",
        "export interface H20Coefficients {",
        "  readonly a: number",
        "  readonly b: number",
        "  readonly c: number",
        "  readonly nRequests: number",
        "  readonly r2: number",
        "  readonly medianRelErr: number",
        "}",
        "",
    ]
    for display, key in CONFIG_KEYS.items():
        r = results[display]
        rep_b = next(x for x in r["reports"] if x["name"] == "B_free_nnls")
        lines.append(f"const {key.upper().replace('-', '_')} = {{")
        lines.append(f"  a: {r['coefB'][0]:.10f},")
        lines.append(f"  b: {r['coefB'][1]:.10f},")
        lines.append(f"  c: {r['coefB'][2]:.10f},")
        lines.append(f"  nRequests: {r['n_requests']},")
        lines.append(f"  r2: {rep_b['r2']:.6f},")
        lines.append(f"  medianRelErr: {rep_b['median_rel_err']:.6f},")
        lines.append("}")
        lines.append("")
    lines.append("export const H20_PROFILES: Readonly<Record<string, Readonly<H20Coefficients>>> = {")
    for display, key in CONFIG_KEYS.items():
        const_name = key.upper().replace("-", "_")
        lines.append(f"  '{key}': {const_name},")
    lines.append("}")
    lines.append("")
    # Model-level means (instant + thinking share one checkpoint per family).
    qwen_mean = np.mean([results["Qwen Instant"]["coefB"], results["Qwen Thinking"]["coefB"]], axis=0)
    gemma_mean = np.mean([results["Gemma Instant"]["coefB"], results["Gemma Thinking"]["coefB"]], axis=0)
    lines.append("export const H20_MODEL_PROFILES: Readonly<Record<string, Readonly<H20Coefficients>>> = {")
    lines.append(f"  'qwen-h20': {{ a: {qwen_mean[0]:.10f}, b: {qwen_mean[1]:.10f}, c: {qwen_mean[2]:.10f},")
    lines.append("    nRequests: 0, r2: 0, medianRelErr: 0 },")
    lines.append(f"  'gemma-h20': {{ a: {gemma_mean[0]:.10f}, b: {gemma_mean[1]:.10f}, c: {gemma_mean[2]:.10f},")
    lines.append("    nRequests: 0, r2: 0, medianRelErr: 0 },")
    lines.append("}")
    lines.append("")
    lines.append(f"export const H20_PROXY_COEFFICIENTS: Readonly<H20Coefficients> = {{")
    lines.append(f"  a: {coefPool[0]:.10f},")
    lines.append(f"  b: {coefPool[1]:.10f},")
    lines.append(f"  c: {coefPool[2]:.10f},")
    lines.append(f"  nRequests: {len(all_energy)},")
    lines.append(f"  r2: {repPool['r2']:.6f},")
    lines.append(f"  medianRelErr: {repPool['median_rel_err']:.6f},")
    lines.append("}")
    lines.append("")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
