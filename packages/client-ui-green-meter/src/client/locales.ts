/** Dictionary keys of the green-meter readout. */
export type GreenMeterKey =
  | 'empty'
  | 'energy'
  | 'energyLabel'
  | 'carbon'
  | 'panelTitle'
  | 'firstTurn'
  | 'lastTurn'
  | 'requests'
  | 'inputTokens'
  | 'outputTokens'
  | 'carbonTotal'
  | 'profile'
  | 'recentRequests'
  | 'step'
  | 'cacheSaved'
  | 'cacheSavedValue'
  | 'treesSaved'
  | 'costLabel'
  | 'costValue'
  | 'budgetOn'
  | 'budgetOver'
  | 'close'

export const zh: Record<GreenMeterKey, string> = {
  empty: '能耗 —',
  energy: '能耗 {value}',
  energyLabel: '能耗',
  carbon: '碳 {value} g CO2e',
  panelTitle: '会话能耗明细',
  firstTurn: '第 {value} 轮',
  lastTurn: '第 {value} 轮',
  requests: '请求',
  inputTokens: '输入 token',
  outputTokens: '输出 token',
  carbonTotal: '碳足迹',
  profile: '档案',
  recentRequests: '最近请求',
  step: '第 {turn} 轮 · 第 {step} 步',
  cacheSaved: '缓存节碳',
  cacheSavedValue: '约 {value} g CO2e（{tokens} 命中 token 免于重算 prefill）',
  treesSaved: '≈ {value} 棵树一年的吸碳量',
  costLabel: '电费',
  costValue: '约 ¥{value}',
  budgetOn: '预算 {value}（已用 {percent}%）',
  budgetOver: '预算超支，新步骤已拒绝',
  close: '关闭',
}

export const en: Record<GreenMeterKey, string> = {
  empty: 'Energy —',
  energy: 'Energy {value}',
  energyLabel: 'Energy',
  carbon: 'Carbon {value} g CO2e',
  panelTitle: 'Session energy',
  firstTurn: 'Turn {value}',
  lastTurn: 'Turn {value}',
  requests: 'Requests',
  inputTokens: 'Input tokens',
  outputTokens: 'Output tokens',
  carbonTotal: 'Carbon',
  profile: 'Profile',
  recentRequests: 'Recent requests',
  step: 'Turn {turn} · Step {step}',
  cacheSaved: 'Carbon saved by caching',
  cacheSavedValue: '~{value} g CO2e ({tokens} cached tokens skipped prefill)',
  treesSaved: '≈ {value} trees absorbing CO2 for a year',
  costLabel: 'Electricity',
  costValue: '≈ ¥{value}',
  budgetOn: 'Budget {value} ({percent}% used)',
  budgetOver: 'Budget exceeded; new steps rejected',
  close: 'Close',
}
