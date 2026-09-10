/**
 * Green DSH Desktop console renderer. Vanilla DOM + inline SVG; every number
 * comes from the main process snapshot (ledger aggregation + hardware sampler).
 */
(() => {
  'use strict'

  const $ = selector => document.querySelector(selector)
  const $$ = selector => Array.from(document.querySelectorAll(selector))
  const bridge = window.greenConsole

  // ── formatting ─────────────────────────────────────────────
  const fmtEnergy = (joules) => {
    if (!Number.isFinite(joules) || joules <= 0) return '0 J'
    if (joules >= 1e6) return `${(joules / 1e6).toFixed(2)} MJ`
    if (joules >= 1e3) return `${(joules / 1e3).toFixed(1)} kJ`
    return `${joules.toFixed(1)} J`
  }

  const fmtCarbon = (grams) => {
    if (!Number.isFinite(grams) || grams === 0) return '0 g'
    const abs = Math.abs(grams)
    if (abs < 0.001) return `${(grams * 1e6).toFixed(0)} µg`
    if (abs < 1) return `${grams.toFixed(3)} g`
    if (abs < 1000) return `${grams.toFixed(1)} g`
    return `${(grams / 1000).toFixed(2)} kg`
  }

  const fmtCny = (value) => {
    if (!Number.isFinite(value)) return '0'
    const decimals = Math.abs(value) < 1 ? 4 : 2
    let text = value.toFixed(decimals)
    if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '')
    return text
  }

  const fmtInt = value => (Number.isFinite(value) ? value.toLocaleString('en-US') : '0')

  const fmtTokens = (value) => {
    if (!Number.isFinite(value) || value === 0) return '0'
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
    return String(value)
  }

  const fmtGB = value => `${(Number(value) || 0).toFixed(1)} GiB`

  const fmtTime = (ts) => {
    if (typeof ts !== 'string' || ts.length < 19) return '—'
    const date = new Date(ts)
    if (Number.isNaN(date.getTime())) return '—'
    const pad = number => String(number).padStart(2, '0')
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  const shortId = id => (typeof id === 'string' && id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : String(id ?? '—'))

  const trees = (carbonG) => {
    const value = (carbonG / 1000) / 20
    if (value >= 100) return Math.round(value).toLocaleString('en-US')
    if (value >= 0.05) return value.toFixed(1).replace(/\.0$/, '')
    return value > 0 ? '<0.05' : '0'
  }

  // ── svg helpers ────────────────────────────────────────────
  const NS = 'http://www.w3.org/2000/svg'

  function svg(tag, attrs = {}) {
    const element = document.createElementNS(NS, tag)
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value))
    return element
  }

  /** FreeToken-style donut gauge. */
  function ring({ label, value, sub, pct, tone }) {
    const size = 118
    const radius = 46
    const circumference = 2 * Math.PI * radius
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0))
    const wrap = document.createElement('div')
    wrap.className = `ring${tone === undefined ? '' : ` ${tone}`}`
    const chart = svg('svg', { viewBox: `0 0 ${size} ${size}` })
    chart.append(svg('circle', { class: 'ring-track', cx: size / 2, cy: size / 2, r: radius }))
    chart.append(svg('circle', {
      class: 'ring-fill',
      cx: size / 2,
      cy: size / 2,
      r: radius,
      transform: `rotate(-90 ${size / 2} ${size / 2})`,
      'stroke-dasharray': `${(circumference * clamped) / 100} ${circumference}`,
    }))
    const text = svg('text', { class: 'ring-text', x: size / 2, y: size / 2 + 2, 'text-anchor': 'middle' })
    text.textContent = value
    chart.append(text)
    if (sub !== undefined && sub !== '') {
      const subText = svg('text', { class: 'ring-sub', x: size / 2, y: size / 2 + 16, 'text-anchor': 'middle' })
      subText.textContent = sub
      chart.append(subText)
    }
    wrap.append(chart)
    const labelElement = document.createElement('div')
    labelElement.className = 'ring-label'
    labelElement.textContent = label
    wrap.append(labelElement)
    return wrap
  }

  /** Vertical bar chart with value-scaled heights and first/last axis labels. */
  function barChart(items, { valueKey, labelKey, height = 150 }) {
    const container = document.createElement('div')
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = '还没有数据'
      container.append(empty)
      return container
    }
    const width = Math.max(320, items.length * 26)
    const max = Math.max(...items.map(item => Number(item[valueKey]) || 0), 1)
    const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', height })
    items.forEach((item, index) => {
      const value = Number(item[valueKey]) || 0
      const barHeight = Math.max(2, Math.round((value / max) * (height - 26)))
      chart.append(svg('rect', {
        x: index * 26 + 6,
        y: height - 18 - barHeight,
        width: 14,
        height: barHeight,
        rx: 3,
        fill: '#2563eb',
        opacity: value === 0 ? 0.15 : 0.85,
      }))
    })
    container.append(chart)
    const labels = document.createElement('div')
    labels.className = 'chart-axis'
    const first = document.createElement('span')
    first.textContent = String(items[0][labelKey] ?? '')
    const last = document.createElement('span')
    last.textContent = String(items[items.length - 1][labelKey] ?? '')
    labels.append(first, last)
    container.append(labels)
    return container
  }

  /** Filled sparkline over a rolling history window. */
  function sparkline(values, { height = 96, max = 100, color = '#2563eb' }) {
    const container = document.createElement('div')
    if (values.length < 2) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = '采样中…'
      container.append(empty)
      return container
    }
    const width = 600
    const points = values.map((value, index) => {
      const x = (index / (values.length - 1)) * width
      const y = height - Math.max(0, Math.min(max, value)) / max * (height - 8) - 4
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', height })
    chart.append(svg('polygon', {
      points: `0,${height} ${points.join(' ')} ${width},${height}`,
      fill: color,
      opacity: 0.12,
    }))
    chart.append(svg('polyline', {
      points: points.join(' '),
      fill: 'none',
      stroke: color,
      'stroke-width': 2,
      'stroke-linejoin': 'round',
    }))
    container.append(chart)
    return container
  }

  function tableRow(cells) {
    const row = document.createElement('tr')
    for (const cell of cells) {
      const td = document.createElement('td')
      if (typeof cell === 'object' && cell !== null) {
        td.textContent = cell.text
        if (cell.class !== undefined) td.className = cell.class
        if (cell.title !== undefined) td.title = cell.title
      } else {
        td.textContent = String(cell)
      }
      row.append(td)
    }
    return row
  }

  function fillTable(selector, rows, emptyText) {
    const body = $(selector).querySelector('tbody')
    body.replaceChildren()
    if (rows.length === 0) {
      const row = document.createElement('tr')
      const cell = document.createElement('td')
      cell.colSpan = 12
      cell.className = 'empty'
      cell.textContent = emptyText
      row.append(cell)
      body.append(row)
      return
    }
    for (const row of rows) body.append(row)
  }

  // ── state ──────────────────────────────────────────────────
  let snapshot = null
  let settingsDirty = false
  let currentPage = 'overview'

  function apiCostCny(totals, settings) {
    return totals.inputTokens * settings.apiPriceCnyPerMInput / 1e6
      + totals.cachedTokens * settings.apiPriceCnyPerMCached / 1e6
      + (totals.outputTokens + (totals.reasoningTokens ?? 0)) * settings.apiPriceCnyPerMOutput / 1e6
  }

  function localCostCny(energyJ, settings) {
    return energyJ / 3.6e6 * settings.priceCnyPerKwh
  }

  // ── chrome ─────────────────────────────────────────────────
  function setPill(id, tone, text) {
    const pill = $(id)
    pill.className = `status-pill ${tone}`
    pill.querySelector('span:last-child').textContent = text
  }

  function renderChrome() {
    const { app, ledger, derived, hardware, settings, alerts, relay } = snapshot
    setPill('#pill-harness', app.harnessReady ? 'ok' : 'warn', `Harness :${app.harnessPort || '—'}`)
    setPill('#pill-ledger', ledger.exists ? 'ok' : 'off', ledger.exists ? `台账 ${fmtInt(ledger.totals.requests)} 条` : '台账 空')
    if (hardware.primary !== null) {
      setPill('#pill-gpu', 'ok', `GPU ${Math.round(hardware.primary.utilPct ?? 0)}%`)
    } else if (hardware.extension !== null) {
      setPill('#pill-gpu', 'warn', `核显 ${Math.round(hardware.extension.utilPct ?? 0)}%`)
    } else {
      setPill('#pill-gpu', 'off', 'GPU 未检测')
    }
    if (relay.enabled !== true) {
      setPill('#pill-relay', 'off', '中转站 关闭')
    } else if (relay.status.state === 'ok') {
      setPill('#pill-relay', 'ok', `中转站 ${fmtInt(relay.totals.requests)} 请求`)
    } else {
      setPill('#pill-relay', 'warn', relay.status.state === 'error' ? '中转站 异常' : '中转站 缓存')
    }

    const alertPill = $('#alert-pill')
    const counts = alerts.counts
    alertPill.textContent = `预警 ${counts.total}`
    alertPill.className = `alert-pill${counts.critical > 0 ? ' critical' : counts.warn > 0 ? ' warn' : ''}`
    const badge = $('#nav-alert-badge')
    badge.hidden = counts.total === 0
    badge.textContent = String(counts.total)

    const saved = derived.savedCny
    const pill = $('#saved-pill')
    pill.textContent = `已省 ¥${fmtCny(saved)}`
    pill.title = `碳排 ${fmtCarbon(ledger.totals.carbonG)} CO₂e · 能耗 ${fmtEnergy(ledger.totals.energyJ)} · 电价 ¥${settings.priceCnyPerKwh}/kWh`

    // sidebar meters — VRAM only when a real (NVIDIA) memory total exists
    const gpuBox = $('#side-gpu')
    const primary = hardware.primary
    if (primary?.memTotalMB) {
      gpuBox.hidden = false
      $('#side-gpu-text').textContent = `${fmtGB(primary.memUsedMB / 1024)} / ${fmtGB(primary.memTotalMB / 1024)}`
      $('#side-gpu-bar').style.width = `${Math.min(100, (primary.memUsedMB / primary.memTotalMB) * 100)}%`
    } else {
      gpuBox.hidden = true
    }
    $('#side-mem-text').textContent = `${fmtGB(hardware.memUsedGB)} / ${fmtGB(hardware.memTotalGB)}`
    $('#side-mem-bar').style.width = `${hardware.memPct}%`
    $('#side-cpu-text').textContent = `${Math.round(hardware.cpuPct)}%`
    $('#side-cpu-bar').style.width = `${hardware.cpuPct}%`
    $('#side-device').textContent = primary !== null
      ? `${primary.name} · ${hardware.device.cores} 核`
      : hardware.extension !== null
        ? `${hardware.extension.name ?? '核显'}（扩展） · ${hardware.device.cores} 核`
        : `${hardware.device.cpuModel} · ${hardware.device.cores} 核`
    $('#side-version').textContent = `v${app.version}${app.runtimeNode ? ` · Node ${app.runtimeNode}` : ''}`
  }

  // ── pages ──────────────────────────────────────────────────
  function renderOverview() {
    const { ledger, derived, hardware, settings, measurement } = snapshot
    const totals = ledger.totals

    $('#overview-sub').textContent = ledger.exists
      ? `监测中 · 每 2 秒刷新 · 最近记录 ${fmtTime(ledger.lastTs)}`
      : '监测中 · 每 2 秒刷新 · 尚无计费步骤'

    // ── 本地路径：能耗来自台账估算；有 NVIDIA 时并行给出实测 ──
    const measuredSession = measurement?.available === true ? measurement.sessionJ : null
    $('#stat-carbon').textContent = `${fmtCarbon(totals.carbonG)} CO₂e`
    $('#stat-carbon-cap').textContent = measuredSession === null
      ? `口径：台账估算（${snapshot.profile?.profileId ?? 'proxy'}）· 等价 ${trees(totals.carbonG)} 棵树年吸碳量`
      : `口径：台账估算 · 本机实测能耗 ${fmtEnergy(measuredSession)}（nvidia-smi 积分）`

    $('#stat-energy').textContent = fmtEnergy(totals.energyJ)
    $('#stat-energy-cap').textContent = measuredSession === null
      ? `${derived.kwh.toFixed(4)} kWh · 电费 ¥${fmtCny(derived.costCny)}`
      : `台账估算 ${fmtEnergy(totals.energyJ)} vs 实测 ${fmtEnergy(measuredSession)} · 电费 ¥${fmtCny(derived.costCny)}`

    // ── 云端路径：只看得见 token，用公开系数估算 ──
    const cloud = derived.cloud
    if (cloud === null) {
      $('#stat-cloud-carbon').textContent = '已关闭'
      $('#stat-cloud-carbon-cap').textContent = '可在设置中开启云端估算'
    } else {
      $('#stat-cloud-carbon').textContent = `${fmtCarbon(cloud.carbonG)} CO₂e`
      const unitText = cloud.model.unit === 'per-output-token'
        ? `${cloud.model.whPerOutputToken} Wh/输出 token × PUE ${cloud.model.pue}`
        : `${cloud.model.whPerRequest} Wh/请求`
      $('#stat-cloud-carbon-cap').textContent =
        `${cloud.model.label} · ${unitText} · 估算能耗 ${fmtEnergy(cloud.energyJ)}`
    }

    $('#stat-saved-cny').textContent = `¥${fmtCny(derived.savedCny)}`
    $('#stat-saved-cny-cap').textContent =
      `API 牌价 ¥${fmtCny(derived.apiCostCny)} − 本地电费 ¥${fmtCny(derived.costCny)}`

    const processed = totals.inputTokens + totals.cachedTokens + totals.outputTokens + totals.reasoningTokens
    $('#stat-tokens').textContent = fmtTokens(processed)
    $('#stat-tokens-cap').textContent =
      `输入 ${fmtTokens(totals.inputTokens)} · 缓存 ${fmtTokens(totals.cachedTokens)} · 输出 ${fmtTokens(totals.outputTokens - totals.reasoningTokens)} · 思考 ${fmtTokens(totals.reasoningTokens)}`

    $('#stat-requests').textContent = fmtInt(totals.requests)
    $('#stat-requests-cap').textContent = `${fmtInt(totals.sessions)} 个会话`

    $('#stat-cache-carbon').textContent = `${fmtCarbon(derived.cacheSavedCarbonG)} CO₂e`
    $('#stat-cache-carbon-cap').textContent =
      `${fmtTokens(totals.cachedTokens)} 个缓存 token 免于重算 prefill`

    const daily = ledger.daily.slice(-30)
    $('#daily-note').textContent = daily.length === 0 ? '暂无数据' : `共 ${daily.length} 天 · 最高 ${fmtCarbon(Math.max(...daily.map(day => day.carbonG)))}`
    $('#daily-chart').replaceChildren(barChart(daily, { valueKey: 'carbonG', labelKey: 'day', height: 160 }))
    renderTurnChart()

    const recent = ledger.recent.slice(0, 12)
    $('#recent-note').textContent = recent.length === 0 ? '暂无数据' : `最近 ${recent.length} 步`
    fillTable('#recent-table', recent.map(row => tableRow([
      { text: fmtTime(row.ts), class: 'mono' },
      { text: shortId(row.sessionId), class: 'mono', title: row.sessionId },
      { text: `${row.turn}.${row.step}`, class: 'num' },
      { text: fmtTokens(row.inputTokens), class: 'num' },
      { text: fmtTokens(row.outputTokens), class: 'num' },
      { text: fmtEnergy(row.energyJ), class: 'num' },
      { text: fmtCarbon(row.carbonG), class: 'num' },
    ])), '还没有计费步骤')

    const primary = hardware.primary
    const rings = []
    if (primary !== null) {
      rings.push(ring({
        label: 'GPU 使用率',
        value: primary.utilPct === null ? '—' : `${Math.round(primary.utilPct)}%`,
        sub: primary.tempC === null ? '' : `${Math.round(primary.tempC)}°C`,
        pct: primary.utilPct ?? 0,
        tone: (primary.utilPct ?? 0) > 90 ? 'hot' : undefined,
      }))
      rings.push(ring({
        label: 'GPU 显存',
        value: primary.memTotalMB ? `${Math.round((primary.memUsedMB / primary.memTotalMB) * 100)}%` : '—',
        sub: primary.memTotalMB ? `${(primary.memUsedMB / 1024).toFixed(1)}G` : '',
        pct: primary.memTotalMB ? (primary.memUsedMB / primary.memTotalMB) * 100 : 0,
      }))
    } else if (hardware.extension !== null) {
      rings.push(ring({
        label: '核显 使用率',
        value: hardware.extension.utilPct === null ? '—' : `${Math.round(hardware.extension.utilPct)}%`,
        sub: '扩展',
        pct: hardware.extension.utilPct ?? 0,
      }))
    }
    rings.push(ring({
      label: '内存',
      value: `${Math.round(hardware.memPct)}%`,
      pct: hardware.memPct,
      tone: hardware.memPct > 90 ? 'hot' : hardware.memPct > 75 ? 'warn' : undefined,
    }))
    rings.push(ring({
      label: 'CPU 使用率',
      value: `${Math.round(hardware.cpuPct)}%`,
      pct: hardware.cpuPct,
      tone: hardware.cpuPct > 90 ? 'hot' : undefined,
    }))
    $('#overview-rings').replaceChildren(...rings)
  }

  function renderSessions() {
    const { ledger, settings } = snapshot
    const rows = ledger.sessions.slice(0, 60).map(session => {
      const api = apiCostCny(session, settings)
      const local = localCostCny(session.energyJ, settings)
      return tableRow([
        { text: shortId(session.id), class: 'mono', title: session.id },
        { text: fmtInt(session.requests), class: 'num' },
        { text: fmtTokens(session.inputTokens), class: 'num' },
        { text: fmtTokens(session.outputTokens), class: 'num' },
        { text: fmtEnergy(session.energyJ), class: 'num' },
        { text: fmtCarbon(session.carbonG), class: 'num' },
        { text: `¥${fmtCny(local)}`, class: 'num' },
        { text: `¥${fmtCny(api - local)}`, class: 'num pos' },
        { text: fmtTime(session.lastTs), class: 'mono' },
      ])
    })
    fillTable('#sessions-table', rows, '还没有会话数据')
  }

  function renderHardware() {
    const { hardware } = snapshot
    const primary = hardware.primary

    // NVIDIA blocks first — the primary telemetry source, one block per GPU.
    const blocks = hardware.nvidia.map(gpu => {
      const block = document.createElement('div')
      block.className = 'gpu-block'
      const title = document.createElement('div')
      title.className = 'gpu-title'
      const name = document.createElement('b')
      name.textContent = gpu.name
      title.append(name)
      if (hardware.nvidia.length > 1) {
        const tag = document.createElement('span')
        tag.className = 'tag'
        tag.textContent = `#${gpu.index}`
        title.append(tag)
      }
      if (gpu.powerW !== null || gpu.tempC !== null) {
        const meta = document.createElement('span')
        meta.textContent = [
          gpu.tempC === null ? null : `${Math.round(gpu.tempC)} °C`,
          gpu.powerW === null ? null : `${Math.round(gpu.powerW)} W${gpu.powerLimitW === null ? '' : ` / ${Math.round(gpu.powerLimitW)} W`}`,
        ].filter(Boolean).join(' · ')
        title.append(meta)
      }
      block.append(title)

      const row = document.createElement('div')
      row.className = 'ring-row'
      row.append(
        ring({
          label: 'GPU 使用率',
          value: gpu.utilPct === null ? '—' : `${Math.round(gpu.utilPct)}%`,
          sub: gpu.tempC === null ? '' : `${Math.round(gpu.tempC)}°C`,
          pct: gpu.utilPct ?? 0,
          tone: (gpu.utilPct ?? 0) > 90 ? 'hot' : undefined,
        }),
        ring({
          label: 'GPU 显存',
          value: gpu.memTotalMB ? `${Math.round((gpu.memUsedMB / gpu.memTotalMB) * 100)}%` : '—',
          sub: gpu.memTotalMB ? `${(gpu.memUsedMB / 1024).toFixed(1)}G` : '',
          pct: gpu.memTotalMB ? (gpu.memUsedMB / gpu.memTotalMB) * 100 : 0,
        }),
      )
      block.append(row)
      return block
    })

    if (blocks.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = '未检测到 NVIDIA GPU（nvidia-smi 不可用）—— 碳排/能耗仍按 green-meter 的 token-profile 估算统计'
      blocks.push(empty)
    }
    $('#hardware-rings').replaceChildren(...blocks)
    $('#gpu-note').textContent = hardware.nvidia.length === 0
      ? 'nvidia-smi 不可用'
      : `nvidia-smi · ${hardware.nvidia.length} 张卡`

    // Extension card: non-NVIDIA adapter utilization only.
    const extension = hardware.extension
    $('#igpu-card').hidden = extension === null
    if (extension !== null) {
      $('#igpu-note').textContent = extension.name ?? '集成显卡'
      $('#igpu-rings').replaceChildren(ring({
        label: '使用率',
        value: extension.utilPct === null ? '—' : `${Math.round(extension.utilPct)}%`,
        pct: extension.utilPct ?? 0,
      }))
    }

    $('#hw-cpu-note').textContent = hardware.device.cpuModel
    $('#hw-mem-note').textContent = `${fmtGB(hardware.memUsedGB)} / ${fmtGB(hardware.memTotalGB)}`
    $('#hw-gpu-note').textContent = primary !== null
      ? [primary.name, primary.powerW === null ? null : `${Math.round(primary.powerW)} W`, primary.tempC === null ? null : `${Math.round(primary.tempC)} °C`]
        .filter(Boolean).join(' · ')
      : extension !== null ? `${extension.name ?? '核显'}（扩展）` : '不可用'
    $('#cpu-spark').replaceChildren(sparkline(hardware.history.cpu, { color: '#2563eb' }))
    $('#mem-spark').replaceChildren(sparkline(hardware.history.mem, { color: '#7c3aed' }))
    $('#gpu-spark').replaceChildren(sparkline(hardware.history.gpu, { color: '#16a34a' }))
    $('#gpu-spark-card').hidden = hardware.history.gpu.length === 0

    const kv = [
      ['CPU', `${hardware.device.cpuModel} · ${hardware.device.cores} 核`],
      ['内存', fmtGB(hardware.device.memTotalGB)],
      ['GPU（主）', primary === null ? '未检测到 NVIDIA GPU' : primary.name],
      ['GPU 监控方式', primary !== null ? 'nvidia-smi（全量遥测）' : extension !== null ? 'Windows GPU 计数器（核显扩展）' : '不可用'],
      ['其它适配器', hardware.adapters.length === 0 ? '—' : hardware.adapters.join('、')],
      ['平台', hardware.device.platform],
      ['主机名', hardware.device.host],
    ]
    const list = $('#device-info')
    list.replaceChildren()
    for (const [key, value] of kv) {
      const dt = document.createElement('dt')
      dt.textContent = key
      const dd = document.createElement('dd')
      dd.textContent = value
      list.append(dt, dd)
    }
  }

  function renderLedger() {
    const { ledger, app } = snapshot
    const info = [
      ['台账路径', app.ledgerPath],
      ['文件大小', ledger.exists ? `${(ledger.bytes / 1024).toFixed(1)} KiB` : '不存在'],
      ['记录数', fmtInt(ledger.totals.requests)],
      ['会话数', fmtInt(ledger.totals.sessions)],
      ['最早 / 最新', `${fmtTime(ledger.firstTs)} → ${fmtTime(ledger.lastTs)}`],
      ['标定档案', ledger.profiles.length === 0 ? '—' : ledger.profiles.join(', ')],
    ]
    const infoList = $('#ledger-info')
    infoList.replaceChildren()
    for (const [key, value] of info) {
      const dt = document.createElement('dt')
      dt.textContent = key
      const dd = document.createElement('dd')
      dd.textContent = value
      infoList.append(dt, dd)
    }
    $('#ledger-note').textContent = `最近 ${Math.min(ledger.recent.length, 200)} 条`
    const measured = snapshot.measurement?.perStep ?? {}
    fillTable('#ledger-table', ledger.recent.slice(0, 200).map(row => tableRow([
      { text: fmtTime(row.ts), class: 'mono' },
      { text: shortId(row.sessionId), class: 'mono', title: row.sessionId },
      { text: `${row.turn}.${row.step}`, class: 'num' },
      { text: fmtTokens(row.inputTokens), class: 'num' },
      { text: fmtTokens(row.cachedTokens), class: 'num' },
      { text: fmtTokens(row.outputTokens), class: 'num' },
      { text: fmtTokens(row.reasoningTokens), class: 'num' },
      { text: fmtEnergy(row.energyJ), class: 'num' },
      { text: fmtCarbon(row.carbonG), class: 'num' },
      { text: measured[`${row.turn}.${row.step}`] === undefined ? '—' : fmtEnergy(measured[`${row.turn}.${row.step}`]), class: 'num' },
      { text: row.profileId, class: 'mono' },
    ])), '台账为空')
  }

  function renderSettings() {
    const { settings, profileKeys, app, reference } = snapshot
    if (!settingsDirty) {
      const select = $('#set-profile')
      if (select.options.length === 0) {
        for (const key of profileKeys) {
          const option = document.createElement('option')
          option.value = key
          option.textContent = key
          select.append(option)
        }
      }
      select.value = settings.profile

      const localPreset = $('#set-local-preset')
      const cloudPreset = $('#set-cloud-preset')
      const cloudModel = $('#set-cloud-model')
      if (localPreset.options.length === 0) {
        for (const entry of reference.catalog.gridFactors) {
          const option = document.createElement('option')
          option.value = entry.id
          option.textContent = `${entry.region} ${entry.label} · ${entry.kgPerKwh}`
          localPreset.append(option)
          cloudPreset.append(option.cloneNode(true))
        }
        for (const select of [localPreset, cloudPreset]) {
          const custom = document.createElement('option')
          custom.value = 'custom'
          custom.textContent = '自定义（用下方数值）'
          select.append(custom)
        }
        for (const entry of reference.catalog.cloudModels) {
          const option = document.createElement('option')
          option.value = entry.id
          option.textContent = entry.label
          cloudModel.append(option)
        }
      }
      localPreset.value = settings.localGridPreset ?? 'cn-2024'
      cloudPreset.value = settings.cloudGridPreset ?? 'us-2023'
      cloudModel.value = settings.cloudModelId ?? 'epoch-2025-output-token'
      $('#set-cloud-pue').value = settings.cloudPue ?? 1.1
      $('#set-cloud-enabled').value = settings.cloudEstimateEnabled === false ? 'false' : 'true'

      $('#set-local-factor').value = settings.carbonFactorKgPerKwh
      $('#set-cloud-factor').value = settings.cloudCarbonFactorKgPerKwh
      $('#set-price').value = settings.priceCnyPerKwh
      $('#set-api-in').value = settings.apiPriceCnyPerMInput
      $('#set-api-cached').value = settings.apiPriceCnyPerMCached
      $('#set-api-out').value = settings.apiPriceCnyPerMOutput
      $('#set-refresh').value = settings.refreshMs
    }
    const paths = [
      ['DSH_HOME', app.dshHome],
      ['台账目录', app.ledgerPath.replace(/[\\/][^\\/]+$/, '')],
      ['日志', app.logPath],
      ['组合补丁', `${app.dshHome}\\cordis.patch.yml`],
    ]
    const list = $('#path-info')
    list.replaceChildren()
    for (const [key, value] of paths) {
      const dt = document.createElement('dt')
      dt.textContent = key
      const dd = document.createElement('dd')
      dd.textContent = value
      list.append(dt, dd)
    }
  }

  // ── alerts ─────────────────────────────────────────────────
  const RULE_FIELDS = [
    ['rule-session-energy', 'sessionEnergyKj'],
    ['rule-session-cost', 'sessionCostCny'],
    ['rule-hourly-cost', 'hourlyCostCny'],
    ['rule-daily-cost', 'dailyCostCny'],
    ['rule-step-z', 'stepOutlierZ'],
    ['rule-thrash', 'contextThrashRatio'],
    ['rule-retry', 'retryLoopSteps'],
  ]

  function renderAlerts() {
    const { alerts, settings } = snapshot
    const rules = settings.alertRules ?? {}

    const enabled = RULE_FIELDS.filter(([, key]) => Number(rules[key] ?? 0) > 0).length
      + (Number(rules.cacheHitFloor ?? 0) > 0 ? 1 : 0)
    $('#alert-cards').replaceChildren(
      statCard('当前预警', String(alerts.counts.total),
        `${alerts.counts.critical} 严重 · ${alerts.counts.warn} 警告 · ${alerts.counts.info} 提示`),
      statCard('历史记录', String(alerts.history.length), '写入 dsh-home/alerts.jsonl'),
      statCard('已启用规则', String(enabled), '阈值为 0 即关闭该规则'),
    )

    const list = $('#alert-list')
    list.className = 'alert-list'
    list.replaceChildren()
    if (alerts.active.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = '当前没有触发中的预警'
      list.append(empty)
    }
    for (const alert of alerts.active.slice(0, 20)) {
      const item = document.createElement('div')
      item.className = `alert-item ${alert.severity}`
      const severity = document.createElement('span')
      severity.className = 'alert-sev'
      severity.textContent = alert.severity === 'critical' ? '严重' : alert.severity === 'warn' ? '警告' : '提示'
      const body = document.createElement('div')
      body.className = 'alert-body'
      const title = document.createElement('div')
      title.className = 'alert-title'
      title.textContent = alert.title
      const detail = document.createElement('div')
      detail.className = 'alert-detail'
      detail.textContent = alert.detail
      const meta = document.createElement('div')
      meta.className = 'alert-meta'
      meta.textContent = `${alert.rule} · ${fmtTime(alert.ts)}`
      body.append(title, detail, meta)
      item.append(severity, body)
      list.append(item)
    }

    if (!settingsDirty) {
      for (const [id, key] of RULE_FIELDS) {
        const input = $(`#${id}`)
        if (input !== null) input.value = Number(rules[key] ?? 0)
      }
      const cacheInput = $('#rule-cache')
      if (cacheInput !== null) cacheInput.value = (Number(rules.cacheHitFloor ?? 0) * 100).toFixed(0)
    }

    $('#alert-history-note').textContent = alerts.history.length === 0 ? '暂无记录' : `最近 ${Math.min(alerts.history.length, 60)} 条`
    fillTable('#alert-history-table', alerts.history.slice(0, 60).map(entry => tableRow([
      { text: fmtTime(entry.ts), class: 'mono' },
      { text: entry.severity === 'critical' ? '严重' : entry.severity === 'warn' ? '警告' : '提示' },
      { text: entry.rule, class: 'mono' },
      entry.detail,
    ])), '还没有预警记录')
  }

  function statCard(label, value, caption, tone) {
    const card = document.createElement('article')
    card.className = 'card stat'
    const labelElement = document.createElement('div')
    labelElement.className = 'stat-label'
    labelElement.textContent = label
    const valueElement = document.createElement('div')
    valueElement.className = 'stat-value'
    valueElement.textContent = value
    if (tone !== undefined) valueElement.style.color = tone
    const captionElement = document.createElement('div')
    captionElement.className = 'stat-caption'
    captionElement.textContent = caption
    card.append(labelElement, valueElement, captionElement)
    return card
  }

  // ── sources (ledger + relay) ───────────────────────────────
  function renderSources() {
    const { relay, settings, cloudReference } = snapshot
    if (!settingsDirty) {
      $('#relay-enabled').value = settings.relayEnabled === true ? 'true' : 'false'
      $('#relay-adapter').value = settings.relayAdapter ?? 'openrouter'
      $('#relay-url').value = settings.relayBaseUrl ?? ''
      $('#relay-key').value = settings.relayApiKey ?? ''
      $('#relay-poll').value = settings.relayPollMs ?? 300000
      $('#usd-cny').value = settings.usdToCny ?? 7.2
      $('#relay-f-date').value = settings.relayFieldDate ?? ''
      $('#relay-f-model').value = settings.relayFieldModel ?? ''
      $('#relay-f-provider').value = settings.relayFieldProvider ?? ''
      $('#relay-f-requests').value = settings.relayFieldRequests ?? ''
      $('#relay-f-in').value = settings.relayFieldInputTokens ?? ''
      $('#relay-f-out').value = settings.relayFieldOutputTokens ?? ''
      $('#relay-f-reasoning').value = settings.relayFieldReasoningTokens ?? ''
      $('#relay-f-cost').value = settings.relayFieldCostUsd ?? ''
    }

    const state = relay.status.state
    const stateText = {
      ok: `已连接 · 最近刷新 ${fmtTime(relay.status.at)}`,
      cached: `使用缓存 · 最近刷新 ${fmtTime(relay.status.at)}`,
      stale: `刷新失败，显示缓存：${relay.status.error ?? ''}`,
      error: `连接失败：${relay.status.error ?? ''}`,
      disabled: '未启用',
      idle: '等待首次刷新',
    }[state] ?? state
    $('#relay-status').textContent = `${stateText}${relay.status.url ? ` · ${relay.status.url}` : ''}`

    const ref = cloudReference.reference
    const usdToCny = Number(settings.usdToCny) || 7.2
    const totals = relay.totals
    const energyJ = totals.requests * ref.whPerRequest * 3600
    const carbonG = totals.requests * ref.gCo2ePerRequest
    $('#relay-stats').replaceChildren(
      statCard('中转站花费', `$${totals.costUsd.toFixed(4)}`, `≈ ¥${fmtCny(totals.costUsd * usdToCny)} · ${fmtInt(totals.requests)} 次请求`),
      statCard('中转站 Token', fmtTokens(totals.inputTokens + totals.outputTokens + totals.reasoningTokens),
        `输入 ${fmtTokens(totals.inputTokens)} · 输出 ${fmtTokens(totals.outputTokens)} · 思考 ${fmtTokens(totals.reasoningTokens)}`),
      statCard('≈ 云端能耗', fmtEnergy(energyJ), `按 ${ref.label} ${ref.whPerRequest} Wh/请求 折算`),
      statCard('≈ 云端碳排', `${fmtCarbon(carbonG)} CO₂e`, `按 ${ref.gCo2ePerRequest} g/请求 折算`, 'var(--green)'),
    )

    $('#relay-model-note').textContent = relay.byModel.length === 0 ? '暂无数据' : `${relay.byModel.length} 个模型`
    fillTable('#relay-model-table', relay.byModel.map(entry => tableRow([
      entry.model,
      entry.provider === '' ? '—' : entry.provider,
      { text: fmtInt(entry.requests), class: 'num' },
      { text: fmtTokens(entry.inputTokens), class: 'num' },
      { text: fmtTokens(entry.outputTokens), class: 'num' },
      { text: fmtTokens(entry.reasoningTokens), class: 'num' },
      { text: `$${entry.costUsd.toFixed(4)}`, class: 'num' },
      { text: fmtEnergy(entry.requests * ref.whPerRequest * 3600), class: 'num' },
      { text: fmtCarbon(entry.requests * ref.gCo2ePerRequest), class: 'num' },
    ])), '还没有中转站数据（配置地址后点「立即刷新」）')

    $('#relay-day-chart').replaceChildren(barChart(
      relay.byDay.slice(-30).map(day => ({ day: day.date, costUsd: day.costUsd })),
      { valueKey: 'costUsd', labelKey: 'day', height: 150 },
    ))
  }

  // ── reference data ─────────────────────────────────────────
  function renderReference() {
    const { reference, calibration, settings } = snapshot
    const catalog = reference.catalog

    const box = $('#calib-box')
    box.replaceChildren()
    if (calibration.running === true) {
      const live = document.createElement('div')
      live.className = 'calib-live'
      live.textContent = calibration.phase === 'baseline'
        ? '正在测量空闲基线（约 5 秒）…'
        : `标定进行中：已累计 ${fmtEnergy(calibration.energyJ)} · ${calibration.tokens.total} token · ${calibration.elapsedS.toFixed(0)} 秒`
      box.append(live)
      const detail = document.createElement('div')
      detail.textContent = [
        `GPU：${(calibration.gpuNames ?? []).join('、') || '—'}`,
        `空闲基线：${calibration.baselineW === null ? '测量中' : `${calibration.baselineW.toFixed(1)} W`}`,
        `当前功耗：${calibration.lastPowerW === null ? '—' : `${calibration.lastPowerW.toFixed(1)} W`}`,
        `J/token：${calibration.jPerToken === null ? '累计中' : calibration.jPerToken.toFixed(3)}`,
        `碳排：${fmtCarbon(calibration.carbonG)}`,
      ].join(' · ')
      box.append(detail)
      $('#calib-toggle').textContent = '停止并保存'
    } else {
      const line = document.createElement('div')
      line.textContent = '未在标定。开始后请正常使用本地模型（DSH 每步的 token 会计入本次标定），结束时自动换算 J/token。'
      box.append(line)
      if (calibration.profiles.length > 0) {
        const best = calibration.profiles[0]
        const summary = document.createElement('div')
        summary.innerHTML = ''
        summary.append(document.createTextNode('最近一次实测：'))
        const strong = document.createElement('b')
        strong.textContent = `${best.label}（${best.modelName}）`
        summary.append(strong, document.createTextNode(
          ` · ${best.jPerToken.toFixed(3)} J/token · ${best.carbonGPerToken.toFixed(5)} g/token · ${fmtEnergy(best.energyJ)} / ${fmtInt(best.tokens.total)} token`,
        ))
        box.append(summary)
      }
    }
    $('#calib-note').textContent = calibration.profiles.length === 0
      ? '尚无实测档案'
      : `${calibration.profiles.length} 条实测档案`

    fillTable('#measured-table', (catalog.measuredProfiles ?? []).map(profile => tableRow([
      profile.label,
      { text: (profile.gpuNames ?? []).join('、') || '—', class: 'mono' },
      { text: `${Math.round(profile.durationS)} s`, class: 'num' },
      { text: fmtEnergy(profile.energyJ), class: 'num' },
      { text: fmtInt(profile.tokens.total), class: 'num' },
      { text: profile.jPerToken.toFixed(3), class: 'num' },
      { text: profile.carbonGPerToken.toFixed(5), class: 'num' },
      { text: fmtTime(profile.endedAt), class: 'mono' },
    ])), '还没有本机实测档案，可在上方开始标定')

    const activeLocal = settings.localGridPreset
    const activeCloud = settings.cloudGridPreset
    fillTable('#grid-table', catalog.gridFactors.map(entry => tableRow([
      `${entry.region} ${entry.label}`,
      entry.id === activeLocal ? '当前：本地' : entry.id === activeCloud ? '当前：云端' : '—',
      { text: entry.kgPerKwh.toFixed(4), class: 'num' },
      { text: String(entry.year), class: 'num' },
      { text: entry.source, title: entry.note ?? '' },
    ])), '—')

    fillTable('#cloud-ref-table', catalog.cloudModels.map(entry => tableRow([
      entry.label,
      entry.unit === 'per-output-token' ? '每输出 token' : '每请求',
      entry.unit === 'per-output-token'
        ? `${entry.whPerOutputToken} Wh/token（PUE 默认 ${entry.defaultPue}）`
        : `${entry.whPerRequest} Wh · ${entry.gCo2ePerRequest} g CO₂e`,
      { text: String(entry.year), class: 'num' },
      { text: entry.source, title: entry.note ?? '' },
    ])), '—')

    fillTable('#lab-table', catalog.localProfiles.map(entry => tableRow([
      entry.label,
      { text: entry.a.toFixed(4), class: 'num' },
      { text: entry.b === 0 ? '—' : entry.b.toFixed(4), class: 'num' },
      { text: entry.c === 0 ? '—' : entry.c.toFixed(4), class: 'num' },
      { text: entry.nRequests === 0 ? '—' : fmtInt(entry.nRequests), class: 'num' },
      { text: entry.r2 === 0 ? '—' : entry.r2.toFixed(4), class: 'num' },
      { text: entry.medianRelErr === 0 ? '—' : `${(entry.medianRelErr * 100).toFixed(1)}%`, class: 'num' },
    ])), '—')
  }

  // ── per-turn (task round) carbon view ──────────────────────
  let turnSelection = 'all'

  function renderTurnChart() {
    const { ledger } = snapshot
    const select = $('#turn-session')
    if (select !== null) {
      const wanted = ['all', ...ledger.sessions.slice(0, 30).map(session => session.id)]
      const current = [...select.options].map(option => option.value).join('|')
      if (current !== wanted.join('|')) {
        select.replaceChildren()
        const all = document.createElement('option')
        all.value = 'all'
        all.textContent = '全部会话（按轮次聚合）'
        select.append(all)
        for (const session of ledger.sessions.slice(0, 30)) {
          const option = document.createElement('option')
          option.value = session.id
          option.textContent = `${shortId(session.id)} · ${fmtCarbon(session.carbonG)} CO₂e`
          select.append(option)
        }
        select.value = turnSelection
      }
    }

    const series = turnSelection === 'all'
      ? (ledger.turnTotals ?? []).map(entry => ({
        label: `T${entry.turn}`,
        carbonG: entry.carbonG,
        energyJ: entry.energyJ,
        steps: entry.steps,
        outputTokens: entry.outputTokens,
        sessions: entry.sessions,
      }))
      : (ledger.sessions.find(session => session.id === turnSelection)?.turns ?? []).map(entry => ({
        label: `T${entry.turn}`,
        carbonG: entry.carbonG,
        energyJ: entry.energyJ,
        steps: entry.steps,
        outputTokens: null,
        sessions: 1,
      }))

    $('#turn-chart').replaceChildren(barChart(series, { valueKey: 'carbonG', labelKey: 'label', height: 170 }))
    const total = series.reduce((sum, entry) => sum + entry.carbonG, 0)
    $('#turn-note').textContent = series.length === 0
      ? '暂无数据'
      : `${series.length} 轮 · 合计 ${fmtCarbon(total)} CO₂e`
    $('#turn-hint').textContent = turnSelection === 'all'
      ? '按轮次聚合：每个 Tn 是所有会话中第 n 轮的碳排之和；轮次越靠后上下文越长，碳排通常越高。'
      : `会话 ${shortId(turnSelection)} 的逐轮碳排（T1→Tn）。`

    const rows = [...series].reverse().slice(0, 30).map(entry => tableRow([
      { text: entry.label, class: 'num' },
      { text: fmtInt(entry.steps), class: 'num' },
      { text: fmtCarbon(entry.carbonG), class: 'num' },
      { text: fmtEnergy(entry.energyJ), class: 'num' },
      { text: entry.outputTokens === null ? '—' : fmtTokens(entry.outputTokens), class: 'num' },
      { text: fmtInt(entry.sessions), class: 'num' },
    ]))
    fillTable('#turn-table', rows, '暂无轮次数据')
  }

  function render() {
    if (snapshot === null) return
    renderChrome()
    if (currentPage === 'overview') renderOverview()
    if (currentPage === 'sessions') renderSessions()
    if (currentPage === 'hardware') renderHardware()
    if (currentPage === 'alerts') renderAlerts()
    if (currentPage === 'sources') renderSources()
    if (currentPage === 'reference') renderReference()
    if (currentPage === 'ledger') renderLedger()
    if (currentPage === 'settings') renderSettings()
  }

  // ── navigation ─────────────────────────────────────────────
  function showPage(page) {
    currentPage = page
    for (const section of $$('.page')) section.hidden = section.dataset.page !== page
    for (const item of $$('.nav-item[data-page]')) item.classList.toggle('active', item.dataset.page === page)
    if (page === 'logs') void loadLog()
    render()
  }

  async function loadLog() {
    const view = $('#log-view')
    try {
      const result = await bridge.getLogTail(300)
      view.textContent = result?.text || '（暂无输出）'
      view.scrollTop = view.scrollHeight
    } catch (error) {
      view.textContent = `读取日志失败：${String(error)}`
    }
  }

  // ── wiring ─────────────────────────────────────────────────
  for (const item of $$('.nav-item[data-page]')) {
    item.addEventListener('click', () => showPage(item.dataset.page))
  }
  $('#open-chat').addEventListener('click', () => { void bridge.openChat() })
  $('#turn-session').addEventListener('change', (event) => {
    turnSelection = event.target.value
    renderTurnChart()
  })
  $('#open-ledger-dir').addEventListener('click', () => { void bridge.openPath('ledger') })
  $('#open-ledger-dir-2').addEventListener('click', () => { void bridge.openPath('ledger') })
  $('#open-log-dir').addEventListener('click', () => { void bridge.openPath('logs') })
  $('#open-home').addEventListener('click', () => { void bridge.openPath('home') })
  $('#refresh-log').addEventListener('click', () => { void loadLog() })
  $('#export-csv').addEventListener('click', async () => {
    const result = await bridge.exportCsv()
    if (result?.ok) await bridge.openPath('ledger')
  })
  for (const input of $$('.form-grid input, .form-grid select')) {
    input.addEventListener('input', () => { settingsDirty = true })
  }
  $('#save-settings').addEventListener('click', async () => {
    const patch = {
      profile: $('#set-profile').value,
      localGridPreset: $('#set-local-preset').value,
      cloudGridPreset: $('#set-cloud-preset').value,
      cloudModelId: $('#set-cloud-model').value,
      cloudPue: Number($('#set-cloud-pue').value) || 1.1,
      cloudEstimateEnabled: $('#set-cloud-enabled').value === 'true',
      carbonFactorKgPerKwh: Number($('#set-local-factor').value),
      cloudCarbonFactorKgPerKwh: Number($('#set-cloud-factor').value),
      priceCnyPerKwh: Number($('#set-price').value),
      apiPriceCnyPerMInput: Number($('#set-api-in').value),
      apiPriceCnyPerMCached: Number($('#set-api-cached').value),
      apiPriceCnyPerMOutput: Number($('#set-api-out').value),
      refreshMs: Number($('#set-refresh').value),
    }
    const saved = await bridge.saveSettings(patch)
    settingsDirty = false
    $('#save-hint').textContent = saved?.ok ? '已保存，对话内仪表盘下次刷新生效' : '保存失败'
    setTimeout(() => { $('#save-hint').textContent = '' }, 4000)
  })

  $('#save-relay').addEventListener('click', async () => {
    const patch = {
      relayEnabled: $('#relay-enabled').value === 'true',
      relayAdapter: $('#relay-adapter').value,
      relayBaseUrl: $('#relay-url').value.trim(),
      relayApiKey: $('#relay-key').value.trim(),
      relayPollMs: Number($('#relay-poll').value) || 300000,
      usdToCny: Number($('#usd-cny').value) || 7.2,
      relayFieldDate: $('#relay-f-date').value.trim(),
      relayFieldModel: $('#relay-f-model').value.trim(),
      relayFieldProvider: $('#relay-f-provider').value.trim(),
      relayFieldRequests: $('#relay-f-requests').value.trim(),
      relayFieldInputTokens: $('#relay-f-in').value.trim(),
      relayFieldOutputTokens: $('#relay-f-out').value.trim(),
      relayFieldReasoningTokens: $('#relay-f-reasoning').value.trim(),
      relayFieldCostUsd: $('#relay-f-cost').value.trim(),
    }
    const saved = await bridge.saveSettings(patch)
    settingsDirty = false
    $('#relay-status').textContent = saved?.ok ? '已保存，正在刷新…' : '保存失败'
    await bridge.relayRefresh()
    await tick()
  })

  $('#relay-refresh').addEventListener('click', async () => {
    $('#relay-status').textContent = '正在刷新…'
    await bridge.relayRefresh()
    await tick()
  })

  $('#save-rules').addEventListener('click', async () => {
    const rules = {}
    for (const [id, key] of RULE_FIELDS) rules[key] = Number($(`#${id}`).value) || 0
    rules.cacheHitFloor = (Number($('#rule-cache').value) || 0) / 100
    const saved = await bridge.saveSettings({ alertRules: rules })
    settingsDirty = false
    $('#rules-hint').textContent = saved?.ok ? '已保存' : '保存失败'
    setTimeout(() => { $('#rules-hint').textContent = '' }, 4000)
    await tick()
  })

  $('#clear-alerts').addEventListener('click', async () => {
    await bridge.clearAlerts()
    await tick()
  })

  $('#calib-toggle').addEventListener('click', async () => {
    if (snapshot?.calibration?.running === true) {
      const result = await bridge.calibrationStop()
      $('#calib-hint').textContent = result?.ok
        ? `已保存：${result.profile.jPerToken.toFixed(3)} J/token`
        : `未保存：${result?.error ?? '未知错误'}`
    } else {
      const result = await bridge.calibrationStart({
        label: $('#calib-label').value,
        modelName: $('#calib-model').value,
      })
      $('#calib-hint').textContent = result?.ok ? '标定已开始，请正常使用本地模型' : `无法开始：${result?.error ?? '未知错误'}`
    }
    setTimeout(() => { $('#calib-hint').textContent = '' }, 6000)
    await tick()
  })

  async function tick() {
    try {
      snapshot = await bridge.getSnapshot()
      window.__measurement = snapshot.measurement
      render()
    } catch (error) {
      console.error('snapshot failed', error)
    }
  }

  void tick()
  setInterval(tick, 2000)
  window.__consoleReady = true
})()
