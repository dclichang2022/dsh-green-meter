# dsh-client-ui-green-meter

Browser surface for [`dsh-green-meter`](../green-meter/README.md): the
always-visible energy/carbon readout in the composer dock (beside the shipped
stats line), the detail panel (per-turn chart, per-request list, totals,
cache-savings callout), and the sidebar seat for the panel.

The live value arrives through `useProjection('greenMeter')` — the `greenMeter`
session projection contributed by the host plugin — so this package owns no
store, no refresh chain, and no event listener.

## Placement

| `panelPlacement` | Detail panel location | Requirements |
|---|---|---|
| `popover` (default) | floating card above the readout | none — works on vanilla installs |
| `sidebar` | inside the sidebar's blank space | apply `patches/ui-sidebar-sidebar-energy.patch` to a DeepSeek Harness checkout and rebuild `dsh-client-ui-sidebar` |

## States

| Projection value | Rendered |
|---|---|
| `undefined` (host unit not composed) | nothing |
| `null` (no billable steps yet) | the empty state (`能耗 —`) |
| live totals | `能耗 <value> · 碳 <value> g CO2e`, refreshed by session/projection pushes |

## Model Experience

None — the widget only renders human-facing session energy/carbon figures from
the `greenMeter` projection; it appends no surface events and adds no
model-visible content.

#### KV Cache effect

Independent — reads only projection values, never the request surface.

## Known Limitations and Deferred Work

- **No per-turn breakdown in the widget** — the detail panel shows the
  per-turn chart and per-request list; `/green` owns the detailed report.
- **Estimate-only figures** — the values are token-profile estimates from the
  host plugin (see its method boundaries).
