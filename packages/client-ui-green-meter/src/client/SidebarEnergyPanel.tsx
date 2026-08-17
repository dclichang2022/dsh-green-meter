/**
 * SidebarEnergyPanel: the green-meter detail surface rendered in the
 * sidebar's `sidebar.energy` seat 鈥?the composer-dock readout toggles it via
 * the shared panel store, and the live values arrive through
 * `useProjection('greenMeter')` (session-scoped slot kit). Renders nothing
 * while closed or while no session is current. The panel body itself is
 * exported as `EnergyPanelBody` so the dock's popover placement reuses it.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { GreenMeterProjection } from 'dsh-green-meter/client'
import { EnergyBars, formatEnergy } from './GreenMeterDock.tsx'
import { createGreenMeterPanelStore } from './store.ts'
import type { GreenMeterKey } from './locales.ts'
import css from './GreenMeterDock.module.css'

/** CO2 absorbed by one adult tree per year, in kg 鈥?mirrors the host's TREE_CO2_KG_PER_YEAR. */
const TREE_CO2_KG_PER_YEAR = 20

/** Trees-equivalent formatting, mirroring the /green report's formatTrees. */
function formatTrees(trees: number): string {
  if (trees >= 100) return Math.round(trees).toLocaleString('en-US')
  if (trees >= 0.05) return trees.toFixed(1).replace(/\.0$/, '')
  return '<0.05'
}

type PanelTranslate = (key: GreenMeterKey, values?: Record<string, string>) => string

/** The shared detail body: per-turn chart, totals, savings, requests, budget. */
export function EnergyPanelBody({ meter, t }: { meter: GreenMeterProjection, t: PanelTranslate }) {
  const recent = meter.turns.slice(-24)
  return (
    <>
      <div className={css.panelChart} data-green-meter="chart">
        <EnergyBars turns={recent} maxTurns={24} height={44} />
        {recent.length === 1
          ? <div className={css.chartLabels} data-green-meter="chart-labels" aria-hidden="true">
            <span>{t('firstTurn', { value: String(recent[0]!.turn) })}</span>
          </div>
          : recent.length > 0
            ? <div className={css.chartLabels} data-green-meter="chart-labels" aria-hidden="true">
              <span>{t('firstTurn', { value: String(recent[0]!.turn) })}</span>
              <span>{t('lastTurn', { value: String(recent[recent.length - 1]!.turn) })}</span>
            </div>
            : null}
      </div>
      <dl className={css.rows}>
        <div className={css.row}><dt>{t('requests')}</dt><dd>{meter.requests}</dd></div>
        <div className={css.row}><dt>{t('inputTokens')}</dt><dd>{meter.inputTokens.toLocaleString('en-US')}</dd></div>
        <div className={css.row}><dt>{t('outputTokens')}</dt><dd>{meter.outputTokens.toLocaleString('en-US')}</dd></div>
        <div className={css.row}><dt>{t('energyLabel')}</dt><dd>{formatEnergy(meter.energyJ)}</dd></div>
        <div className={css.row}><dt>{t('carbonTotal')}</dt><dd>{meter.carbonG.toFixed(1)} g CO2e</dd></div>
        <div className={css.row} data-green-meter="cost"><dt>{t('costLabel')}</dt><dd>{t('costValue', { value: meter.costCny.toFixed(4) })}</dd></div>
        <div className={css.row}><dt>{t('profile')}</dt><dd>{meter.profileId} ({meter.confidence})</dd></div>
      </dl>
      {meter.savedCarbonG > 0
        ? <div className={css.savings} data-green-meter="savings">
          <span className={css.savingsTitle}>{t('cacheSaved')}</span>
          <span className={css.savingsValue}>
            {t('cacheSavedValue', {
              value: meter.savedCarbonG.toFixed(1),
              tokens: meter.cachedTokens.toLocaleString('en-US'),
            })}
          </span>
          <span className={css.savingsValue} data-green-meter="trees">
            {t('treesSaved', { value: formatTrees(meter.savedCarbonG / 1000 / TREE_CO2_KG_PER_YEAR) })}
          </span>
        </div>
        : null}
      {meter.steps.length > 0
        ? <div className={css.requestList} data-green-meter="requests">
          <div className={css.requestTitle}>{t('recentRequests')}</div>
          <ul className={css.requestRows}>
            {[...meter.steps].reverse().map((entry) => (
              <li key={`${entry.turn}-${entry.step}`} className={css.requestRow} data-green-meter="request">
                <span className={css.requestLabel}>{t('step', { turn: String(entry.turn), step: String(entry.step) })}</span>
                <span className={css.requestValue}>
                  {formatEnergy(entry.energyJ)} 路 {entry.carbonG.toFixed(2)} g 路 {entry.outputTokens.toLocaleString('en-US')} tok
                </span>
              </li>
            ))}
          </ul>
        </div>
        : null}
      {meter.budgetJ > 0
        ? <div className={css.budget} data-green-meter="budget">
          {meter.energyJ > meter.budgetJ
            ? t('budgetOver')
            : t('budgetOn', {
              value: formatEnergy(meter.budgetJ),
              percent: String(Math.round(meter.energyJ / meter.budgetJ * 100)),
            })}
        </div>
        : null}
    </>
  )
}

/** Full panel props: sidebar.energy owner share + session kit + panel store + locale seat. */
export type SidebarEnergyPanelProps =
  PropsRuntime<'sidebar.energy'>
  & PropsLocale<'greenMeter'>
  & PropsStore<ReturnType<typeof createGreenMeterPanelStore>>

/** The sidebar detail panel; closed/absent states render nothing. */
export function SidebarEnergyPanel({ useProjection, useStore, actions, t }: SidebarEnergyPanelProps) {
  const open = useStore(state => state.open)
  const meter = useProjection('greenMeter') as GreenMeterProjection | null | undefined
  if (!open || meter === undefined || meter === null) return null
  return (
    <div className={css.sidebarPanel} data-green-meter="sidebar-panel">
      <div className={css.panelHead}>
        <span className={css.panelTitle}>{t('panelTitle')}</span>
        <button className={css.close} onClick={() => { actions.close() }} data-green-meter="close">{t('close')}</button>
      </div>
      <EnergyPanelBody meter={meter} t={t} />
    </div>
  )
}
