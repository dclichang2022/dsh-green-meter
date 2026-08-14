# dsh-green-meter

Energy & carbon estimation for agentic sessions in DeepSeek Harness. The
plugin observes every model call, converts its token accounting into **energy
(J/kWh)**, **carbon (g CO2e)** and **electricity cost (CNY)** with calibrated
per-model profiles, records everything in a JSONL ledger, and exposes the
`/green` command, the `green_meter` tool, and the live Web readout.

Works with any API-backed provider — no hardware access needed.

## Surfaces

- **`/green`** — session report: tokens, energy, carbon, cost, per-turn
  breakdown, cache-savings counterfactual.
- **`green_meter` tool** — the model can query its own session's energy,
  carbon, cost and budget.
- **`greenMeter` session projection + `dsh-client-ui-green-meter`** — the
  always-visible energy/carbon readout in the composer dock.
- **Energy budget** — `budgetJ > 0` rejects new steps once the session
  estimate exceeds the budget and injects one warning.
- **Ledger** — one JSONL row per accounted model call
  (`<DSH_HOME>/green-meter/ledger.jsonl`, schema `dsh-green-meter.step.v1`).

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `profile` | `proxy` | calibration profile (`proxy`, `qwen-h20-*`, `gemma-h20-*`, `qwen3-4b-*`) |
| `carbonFactorKgPerKwh` | `0.5777` | grid carbon intensity |
| `electricityPriceCnyPerKwh` | `0.56` | electricity price (CNY/kWh) |
| `dir` | `<DSH_HOME>/green-meter` | ledger directory |
| `budgetJ` | `0` (off) | session energy budget in joules |

Environment fallbacks: `DSH_GREEN_PROFILE`, `DSH_GREEN_CARBON_FACTOR`,
`DSH_GREEN_PRICE_CNY`, `DSH_GREEN_DIR`, `DSH_GREEN_BUDGET_J`.

```yaml
- insert:
    - id: green-meter
      name: 'dsh-green-meter'
      config:
        profile: proxy
        carbonFactorKgPerKwh: 0.5777
        budgetJ: 0
```

## Method boundaries

- **Estimate, not measurement** — energy is modeled from token accounting
  with calibrated per-model profiles; carbon and cost are energy ×
  configurable factors.
- **Scope** — GPU operational energy only. No CPU/memory, no cooling/PUE,
  no embodied carbon.
- **Cache savings are counterfactual** — cached tokens that would otherwise
  be recomputed.

## Model Experience

None, as the plugin only observes `assistant/message` usage and renders
human-facing `/green` command output, appending no surface events and adding
no model-visible content.

#### KV Cache effect

Independent — the plugin neither reads nor mutates the request surface, so
prompt stability and provider-side cache reuse are unaffected.

## Known Limitations and Deferred Work

- **Estimate-only path** — no hardware measurement.
- **Per-session scope** — subagent/fork lineage is not aggregated into a
  task-level total.
- **Sidebar panel** — requires the optional `ui-sidebar` patch shipped in the
  repo's `patches/` directory; the popover placement works without it.
