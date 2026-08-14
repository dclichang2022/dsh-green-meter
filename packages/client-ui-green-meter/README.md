# @deepseek-ai/dsh-client-ui-green-meter

Always-visible session energy/carbon readout in the composer dock (the band
under the composer card, beside the shipped stats line). The live value
arrives through `useProjection('greenMeter')` — the `greenMeter` session
projection contributed by the host [`@deepseek-ai/dsh-green-meter`](../../llm/green-meter/README.md)
plugin — so this package owns no store, no refresh chain, and no event
listener. The host row and this browser row are independent: the host row
provides the projection unit, the ledger, and the `/green` command; this row
renders the ambient readout. Removing the host row removes the readout.

## States

| Projection value | Rendered |
|---|---|
| `undefined` (host unit not composed) | nothing |
| `null` (no billable steps yet) | the empty state (`能耗 —`) |
| live totals | `能耗 <value> · 碳 <value> g CO2e`, refreshed by session/projection pushes |

Energy formatting mirrors the `/green` report (J / kJ / MJ tiers).

## Model Experience

None — the widget only renders human-facing session energy/carbon figures from
the `greenMeter` projection; it appends no surface events and adds no
model-visible content.

#### KV Cache effect

Independent — reads only projection values, never the request surface.

## Known Limitations and Deferred Work

- **No per-turn breakdown in the widget** — the ambient readout shows session
  totals; the `/green` command owns the detailed per-turn report.
- **Estimate-only figures** — the values are the token-profile estimates from
  the host plugin (see its method boundaries); measured NVML attribution is a
  separate future path.
