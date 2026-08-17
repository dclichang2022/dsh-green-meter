# dsh-green-meter

**Energy & carbon metering for DeepSeek Harness — see what your agentic sessions cost.**

A [dsh-plugin](https://github.com/topics/dsh-plugin) that turns every model call into **energy (J/kWh)**, **carbon footprint (g CO2e)** and **electricity cost (CNY)** — estimated from token accounting, so it works with any API-backed provider (DeepSeek API, OpenAI-compatible endpoints, local vLLM) without touching hardware.

Install it, chat as usual, and watch your session's energy bill in real time.

---

## ✨ Features

| Surface | What you see |
|---|---|
| **Composer dock** (always visible under the input box) | live `能耗 1.5 kJ · 碳 0.2 g` readout + per-turn energy sparkline |
| **Detail panel** (click the readout) | floating draggable drawer with per-turn energy chart, per-request energy list, session totals (tokens / energy / carbon / **electricity cost**), **carbon saved by caching ≈ N trees per year** |
| **`/green`** | one-command session energy report |
| **`green_meter` tool** | the agent can query its own energy, carbon, cost and budget at any time |
| **Energy budget** | optional per-session budget — over-budget steps are rejected with a warning |
| **JSONL ledger** | every model call recorded, ready for your own analysis |

## 🚀 Quick start

```bash
# 1. Install into your dsh profile
cd ~/.dsh/profiles/web          # (Windows: %USERPROFILE%\.dsh\profiles\web)
pnpm add dsh-green-meter dsh-client-ui-green-meter

# 2. Mount the plugins in your profile's cordis.patch.yml (see examples/)
```

```yaml
- insert:
    - id: green-meter
      name: 'dsh-green-meter'

    - id: ui-green-meter
      name: 'dsh-client-ui-green-meter'
      config:
        panelPlacement: overlay   # overlay (default) = floating draggable drawer, zero-config
```

Restart `dsh web`, refresh, and the readout appears under the composer. Type `/green` anytime.

The detail panel opens as a floating drawer you can drag anywhere — no changes
to the DeepSeek Harness repo are needed. `panelPlacement` can be omitted
(`overlay` is the default); `popover` is another patch-free option.

### Sidebar panel (optional, needs a one-time DSH edit)

`panelPlacement: sidebar` renders the detail panel inside the sidebar's blank
space. Skip this section if the drawer above is enough — it is the recommended
setup. The seat needs one small addition to `packages/client/ui-sidebar`
(everything else stays untouched). Two ways, pick one:

**A. Patch (fresh checkout of deepseek-harness)**

```bash
cd /path/to/deepseek-harness
git apply /path/to/dsh-green-meter/patches/ui-sidebar-sidebar-energy.patch
pnpm --filter @deepseek-ai/dsh-client-ui-sidebar bundle
```

**B. Anchor-based installer (any version; use this when `git apply` fails)**

```powershell
cd /path/to/deepseek-harness
powershell -ExecutionPolicy Bypass -File /path/to/dsh-green-meter/patches/apply-sidebar-energy.ps1
pnpm --filter @deepseek-ai/dsh-client-ui-sidebar bundle
```

The installer edits by unique code anchors (no line numbers), so it works even
when the patch's context no longer matches your checkout, and it is idempotent
— running it twice is safe.

## ⚙️ Configuration

| Key | Default | Meaning |
|---|---|---|
| `profile` | `proxy` | calibration profile (`proxy`, `qwen-h20-*`, `gemma-h20-*`, `qwen3-4b-*`) |
| `carbonFactorKgPerKwh` | `0.5777` | grid carbon intensity |
| `electricityPriceCnyPerKwh` | `0.56` | electricity price (CNY/kWh) |
| `dir` | `<DSH_HOME>/green-meter` | ledger directory |
| `budgetJ` | `0` (off) | session energy budget in joules |

Environment fallbacks: `DSH_GREEN_PROFILE`, `DSH_GREEN_CARBON_FACTOR`, `DSH_GREEN_PRICE_CNY`, `DSH_GREEN_DIR`, `DSH_GREEN_BUDGET_J`.

## 📌 Method notes

- **Estimate, not measurement** — energy is modeled from token accounting with calibrated per-model profiles; carbon and cost are energy × configurable factors.
- **GPU operational energy only** — CPU, memory, cooling and embodied carbon are out of scope.
- **Cache savings are counterfactual** — cached tokens that would otherwise be recomputed.

## 💎 thebestai

**[thebestai](https://thebestai.net)** is our AI platform. 欢迎大家通过反馈意见可以使用我们的 AI Greentoken 系列服务。

## Development

```bash
pnpm install
pnpm test
```

## License

[MIT](LICENSE)
