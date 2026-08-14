# dsh-green-meter

**Energy & carbon metering for DeepSeek Harness — see what your agentic sessions actually cost.**

A [dsh-plugin](https://github.com/topics/dsh-plugin) that estimates every model call's **energy (J/kWh)**, **carbon footprint (g CO2e)** and **electricity cost (CNY)** from token accounting, records everything in a JSONL ledger, and surfaces it live in the web GUI: a per-turn energy chart, a per-request energy list, the counterfactual **carbon saved by prefix caching** (with a tree-absorption equivalent), the `/green` report, a `green_meter` tool the agent can call on itself, and an optional per-session **energy budget**.

> This is the **estimate-only** path: it works with any API-backed provider (DeepSeek API, OpenAI-compatible endpoints, local vLLM) and never touches hardware. Measured (NVML) attribution is available through the sibling [`vllm-green-meter`](https://github.com/green-meter/green-meter-plugin) plugin.

---

## What you get

| Surface | What it shows |
|---|---|
| **Composer dock** (always visible under the input box) | `能耗 1.5 kJ · 碳 0.2 g` plus a per-turn energy sparkline |
| **Detail panel** (click the readout) | per-turn energy chart, session totals (requests, tokens, energy, carbon, **electricity cost**), **cache carbon savings ≈ N trees/year**, per-request energy list (turn · step granularity), profile + fit quality, budget status |
| **`/green`** | full text report: totals, per-turn breakdown, cost, cache savings, method boundary |
| **`green_meter` tool** | the agent can query its own session energy/carbon/cost/budget |
| **Energy budget** | `budgetJ` rejects new steps once the session estimate exceeds it and injects one warning |
| **Ledger** | `$DSH_HOME/green-meter/ledger.jsonl`, one row per accounted model call (schema `dsh-green-meter.step.v1`) |

## Quick start

```bash
# 1. Install into your dsh profile
cd ~/.dsh/profiles/web          # (Windows: %USERPROFILE%\.dsh\profiles\web)
pnpm add dsh-green-meter dsh-client-ui-green-meter

# 2. Mount the plugins in your profile's cordis.patch.yml
```

```yaml
- insert:
    - id: green-meter
      name: 'dsh-green-meter'
      config:
        profile: proxy                 # calibration profile, see below
        carbonFactorKgPerKwh: 0.5777   # China grid 2024
        electricityPriceCnyPerKwh: 0.56 # China residential average
        budgetJ: 0                     # 0 = energy budget off

    # Browser surface: the dock readout + detail panel.
    - id: ui-green-meter
      name: 'dsh-client-ui-green-meter'
      config:
        panelPlacement: popover        # popover works on vanilla installs;
                                       # sidebar needs the optional patch below
```

Restart `dsh web`, refresh the page, and chat — the readout appears under the composer. Type `/green` for the report.

### Full experience: sidebar panel (optional)

`panelPlacement: sidebar` renders the detail panel inside the sidebar's blank space. That seat is an extension of the `dsh-client-ui-sidebar` package — apply the provided patch to your DeepSeek Harness checkout and rebuild the sidebar bundle:

```bash
cd /path/to/deepseek-harness
git apply /path/to/dsh-green-meter/patches/ui-sidebar-sidebar-energy.patch
pnpm --filter @deepseek-ai/dsh-client-ui-sidebar bundle
```

`panelPlacement: popover` (default) needs no patches at all.

## Calibration — where the numbers come from

`E = a × uncached_input_tokens + (b + c × min(ctx, 65536) / 32768) × decode_tokens`

The primary profiles are **request-level non-negative least-squares fits over 5,125 conservation-filtered requests** from a frozen H20 experiment dataset (Qwen3.5-27B / Gemma-4-31B-it, DABStep / Terminal-Bench / SWE-bench-Pro agentic workloads):

| Profile | a (J/prefill tok) | b (J/decode tok) | c (ctx term) | R² | median err | n |
|---|---|---|---|---|---|---|
| `qwen-h20-instant` | 0.147 | 8.900 | 0.774 | 0.9996 | 2.8% | 1434 |
| `qwen-h20-thinking` | 0.143 | 8.792 | 0.888 | 0.9997 | 2.6% | 1301 |
| `gemma-h20-instant` | 0.206 | 10.559 | 1.396 | 0.9983 | 2.4% | 1202 |
| `gemma-h20-thinking` | 0.209 | 10.638 | 1.293 | 0.9994 | 1.2% | 1188 |
| **`proxy` (default)** | 0.177 | 9.722 | 1.088 | 0.982 | 12.4% | 5125 |

Legacy RTX 3090 / Qwen3-4B fits (`qwen3-4b-instruct`, `qwen3-4b-thinking`) ship too. The regression script lives in [`packages/green-meter/scripts/fit-h20-requests.py`](packages/green-meter/scripts/fit-h20-requests.py) and regenerates `src/h20-profiles.generated.ts` (it expects the frozen dataset layout described in that script's header).

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `profile` | `proxy` | `qwen-h20-*`, `gemma-h20-*`, `qwen3-4b-*`, `proxy` |
| `carbonFactorKgPerKwh` | `0.5777` | grid carbon intensity (China 2024 national average) |
| `electricityPriceCnyPerKwh` | `0.56` | electricity price (China residential average, ~2024) |
| `dir` | `<DSH_HOME>/green-meter` | ledger directory |
| `budgetJ` | `0` (off) | session energy budget; over-budget steps are rejected |

Environment fallbacks: `DSH_GREEN_PROFILE`, `DSH_GREEN_CARBON_FACTOR`, `DSH_GREEN_PRICE_CNY`, `DSH_GREEN_DIR`, `DSH_GREEN_BUDGET_J`.

## Method boundaries (please read)

- **Scope:** modeled GPU operational energy from token counts. No CPU/RAM, no cooling/PUE, no embodied carbon.
- **Carbon & cost** are engineering estimates (energy × configurable factors), not certified measurements.
- **Proxy profile** extrapolates to unknown models; the H20 fits carry their own fit quality in every report.
- Cache savings are **counterfactual**: cached tokens that would otherwise be recomputed as prefill (`a × cached_tokens`).

## 💎 thebestai

<!-- TODO: thebestai promo — replace with the real URL and wording -->
**[thebestai](https://THEBESTAI_URL_PLACEHOLDER)** is our AI platform. Use dsh-green-meter and get a **thebestai membership benefit** — TODO: replace with the exact benefit wording (e.g. free trial days / discount code).

## Development

```bash
pnpm install
pnpm --filter dsh-green-meter test        # vitest, GPU-free (39 tests)
pnpm --filter dsh-client-ui-green-meter test
# Rebuilding bundles requires the DeepSeek Harness checkout as dev dependency
# source (see packages/*/tsconfig.json); shipped lib/ is prebuilt.
```

## License

[MIT](LICENSE)
