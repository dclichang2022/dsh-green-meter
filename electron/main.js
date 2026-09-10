/**
 * Green DSH Desktop — Electron shell over the bundled DeepSeek Harness
 * runtime. The main process:
 *   1. locks a single instance,
 *   2. ensures the app-private DSH home + plugin composition patch,
 *   3. starts `dsh web` on a free loopback port (via the bundled Node),
 *   4. opens the monitoring console as the primary window (the FreeToken-style
 *      control surface) and the harness chat window on demand,
 *   5. serves ledger aggregates and live hardware samples to the console, and
 *      the cross-session totals to the in-chat dashboard plugin,
 *   6. supervises the harness lifecycle.
 */
'use strict'

const { app, BrowserWindow, Menu, Notification, ipcMain, shell, dialog } = require('electron')
const { spawn, execFile } = require('node:child_process')
const { createServer } = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const { ensureDshHome, ledgerPath } = require('./dsh-home.js')
const { readGlobalTotals } = require('./ledger.js')
const {
  PROFILE_KEYS,
  createHardwareSampler,
  derive,
  loadProfile,
  loadSettings,
  probeNvidia,
  probeWindowsGpu,
  readLedger,
  saveSettings,
  writePatch,
} = require('./console-data.js')
const alertsEngine = require('./alerts.js')
const { createCalibration } = require('./calibration.js')
const { createPowerMeter } = require('./power-meter.js')
const referenceData = require('./reference-data.js')
const { createRelayConnector } = require('./relay.js')

/** Real filesystem path of a packaged path (asar-unpacked harness resources). */
function unpackedPath(p) {
  return p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)
}

const HARNESS_ROOT = unpackedPath(path.join(__dirname, '..', 'resources', 'harness'))
const HARNESS_BIN = path.join(HARNESS_ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
// The harness prefers the bundled real Node runtime: Electron's embedded Node
// (ELECTRON_RUN_AS_NODE) breaks koffi-driven native features (the win32 folder
// dialog crashes V8 in readUtf16) and junction creation. Fall back to it only
// in a dev checkout without the bundled runtime.
const HARNESS_NODE = unpackedPath(path.join(__dirname, '..', 'resources', 'runtime', 'node.exe'))
const HARNESS_NODE_PRESENT = fs.existsSync(HARNESS_NODE)
/** Bundled Node's version, read once at boot for the console's sidebar. */
let bundledNodeVersion = null
if (HARNESS_NODE_PRESENT) {
  void execFile(HARNESS_NODE, ['--version'], { timeout: 5000, windowsHide: true }, (error, stdout) => {
    if (error === null) bundledNodeVersion = String(stdout).trim().replace(/^v/, '')
  })
}

// The DSH home lives inside the harness deployment (portable layout) when
// that directory is writable; per-machine installs (C:\Program Files) fall
// back to a per-user home under the Electron userData directory, linked to
// the bundled harness via a node_modules junction (see dsh-home.js).
let resolvedHome = null
let resolvedHomeInTree = true
function resolveHome() {
  if (resolvedHome === null) {
    const base = process.env.GREEN_DSH_USER_DATA !== undefined && process.env.GREEN_DSH_USER_DATA !== ''
      ? process.env.GREEN_DSH_USER_DATA
      : app.getPath('userData')
    const resolved = ensureDshHome(HARNESS_ROOT, base)
    resolvedHome = resolved.home
    resolvedHomeInTree = resolved.inTree
  }
  return resolvedHome
}
const dshHome = () => resolveHome()
const logFile = () => path.join(userData, 'logs', 'dsh.log')

let harness = null
let consoleWindow = null
let chatWindow = null
let quitting = false
let userData = ''
let harnessPort = 0
let harnessReady = false
let chatUrl = ''
let startedAt = new Date().toISOString()
let ledgerCache = { key: '', value: null }
let profileCache = { key: '', value: null }

const sampler = createHardwareSampler()
const powerMeter = createPowerMeter()
const getSettings = () => loadSettings(dshHome())
const relay = createRelayConnector({
  dshHome: dshHome(),
  getSettings,
  onUpdate: () => { ledgerCache = { key: '', value: null } },
})
const calibration = createCalibration({
  dshHome: dshHome(),
  getSettings,
  getLedger: () => ledgerSnapshot(),
})

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

async function waitReady(url, timeoutMs = 420_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (res.ok) return true
    } catch {
      // Not up yet.
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return false
}

async function startHarness() {
  const home = dshHome()
  // The composition patch is generated from the console settings, so a saved
  // baseline immediately drives both the host plugin and the in-chat widget.
  writePatch(home, loadSettings(home))
  const port = await freePort()
  const workspace = path.join(home, 'workspace')
  const logs = path.join(userData, 'logs')
  fs.mkdirSync(workspace, { recursive: true })
  fs.mkdirSync(logs, { recursive: true })
  const logStream = fs.createWriteStream(logFile(), { flags: 'a' })

  const harnessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
  }
  // In-tree home: the parent-directory walk resolves every plugin with no
  // links at all, which saves ~3 minutes of junction-farm mklink spawns and
  // the Windows symlink privilege entirely. Out-of-tree (per-machine) home:
  // let dsh-app-boot maintain its profiles/node_modules fallback instead.
  if (resolvedHomeInTree) harnessEnv.GREEN_DSH_NO_JUNCTIONS = '1'
  if (!HARNESS_NODE_PRESENT) harnessEnv.ELECTRON_RUN_AS_NODE = '1'
  const runner = HARNESS_NODE_PRESENT ? HARNESS_NODE : process.execPath

  harness = spawn(runner, [
    HARNESS_BIN, 'web',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--no-open',
  ], {
    cwd: workspace,
    env: harnessEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  harness.stdout.pipe(logStream)
  harness.stderr.pipe(logStream)
  harness.on('exit', (code) => {
    harness = null
    harnessReady = false
    if (!quitting) {
      const parent = consoleWindow ?? chatWindow
      void dialog.showMessageBox(parent ?? undefined, {
        type: 'error',
        title: 'Green DSH Desktop',
        message: 'DeepSeek Harness 进程已退出',
        detail: `退出码 ${code}。日志见 ${logFile()}`,
      })
    }
  })

  harnessPort = port
  chatUrl = `http://127.0.0.1:${port}/`
  harnessReady = await waitReady(chatUrl)
  return { ready: harnessReady, url: chatUrl }
}

function createConsoleWindow() {
  consoleWindow = new BrowserWindow({
    width: shotsDir === '' ? 1240 : 1280,
    height: shotsDir === '' ? 840 : 860,
    minWidth: 1000,
    minHeight: 640,
    title: 'Green DSH Desktop · 能耗碳排控制台',
    backgroundColor: '#f4f6fa',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'console-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  consoleWindow.loadFile(path.join(__dirname, '..', 'console', 'index.html'))
  consoleWindow.once('ready-to-show', () => { consoleWindow.show() })
  consoleWindow.on('closed', () => { consoleWindow = null })
  consoleWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })
}

function createChatWindow() {
  if (chatWindow !== null) {
    if (chatWindow.isMinimized()) chatWindow.restore()
    chatWindow.focus()
    return
  }
  chatWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 620,
    title: 'Green DSH Desktop',
    backgroundColor: '#0d1318',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  chatWindow.loadURL(chatUrl)
  chatWindow.once('ready-to-show', () => { chatWindow.show() })
  chatWindow.webContents.once('did-finish-load', () => {
    if (chatPending !== null) {
      const done = chatPending
      chatPending = null
      done()
    }
  })
  chatWindow.on('closed', () => { chatWindow = null })
  chatWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })
}

function stopHarness() {
  if (harness !== null) harness.kill()
}

/** Application menu: reopen either window after one has been closed. */
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '窗口',
      submenu: [
        {
          label: '打开控制台',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => {
            if (consoleWindow !== null) {
              consoleWindow.show()
              consoleWindow.focus()
            } else {
              createConsoleWindow()
            }
          },
        },
        { label: '打开对话', accelerator: 'CmdOrCtrl+Shift+D', click: () => { createChatWindow() } },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ]))
}

/** Ledger aggregation cached on file identity so the 2 s console poll is cheap. */
function ledgerSnapshot() {
  const file = ledgerPath(dshHome())
  let stat = null
  try {
    stat = fs.statSync(file)
  } catch {
    stat = null
  }
  const key = stat === null ? 'missing' : `${stat.mtimeMs}:${stat.size}`
  if (ledgerCache.key === key && ledgerCache.value !== null) return ledgerCache.value
  const value = readLedger(file)
  ledgerCache = { key, value }
  return value
}

async function profileFor(settings) {
  if (profileCache.key === settings.profile && profileCache.value !== null) return profileCache.value
  const value = await loadProfile(HARNESS_ROOT, settings.profile)
  profileCache = { key: settings.profile, value }
  return value
}

async function consoleSnapshot() {
  const settings = loadSettings(dshHome())
  const profile = await profileFor(settings)
  const ledger = ledgerSnapshot()
  const derived = derive(ledger.totals, settings, profile)
  const relaySnapshot = relay.snapshot()
  const alertState = alertsEngine.evaluate({ ...ledger, relay: relaySnapshot }, settings)
  const fired = alertsEngine.persistNew(dshHome(), alertState.alerts, alertState.rules.cooldownMs)
  // Critical alerts also surface as desktop notifications (rate-limited by the
  // alert cooldown, since `fired` only carries newly logged entries).
  if (fired.some(alert => alert.severity === 'critical') && Notification.isSupported()) {
    const critical = fired.find(alert => alert.severity === 'critical')
    new Notification({
      title: `Green DSH 预警：${critical.title}`,
      body: critical.detail,
    }).show()
  }
  return {
    app: {
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
      harnessPort,
      harnessReady,
      runtimeNode: bundledNodeVersion,
      dshHome: dshHome(),
      ledgerPath: ledgerPath(dshHome()),
      logPath: logFile(),
      startedAt,
    },
    settings,
    profileKeys: PROFILE_KEYS,
    profile,
    ledger,
    derived,
    hardware: sampler.snapshot(),
    measurement: powerMeter.status(ledger),
    relay: relaySnapshot,
    reference: {
      catalog: referenceData.referenceCatalog(dshHome()),
      localGrid: referenceData.resolveGridFactor(settings, 'local'),
      cloudGrid: referenceData.resolveGridFactor(settings, 'cloud'),
    },
    alerts: {
      counts: alertState.counts,
      active: alertState.alerts.slice(0, 40),
      fired: fired.length,
      history: alertsEngine.history(dshHome(), 60),
    },
    calibration: calibration.status(),
  }
}

function exportCsv() {
  const ledger = ledgerSnapshot()
  const rows = [
    'ts_wall,session_id,turn,step,input_tokens,cached_read_tokens,output_tokens,reasoning_tokens,energy_j,carbon_g,profile_id,confidence',
    ...ledger.recent.map(row => [
      row.ts ?? '', row.sessionId, row.turn, row.step, row.inputTokens, row.cachedTokens,
      row.outputTokens, row.reasoningTokens, row.energyJ, row.carbonG, row.profileId, row.confidence,
    ].join(',')),
  ]
  const target = path.join(path.dirname(ledgerPath(dshHome())), `green-meter-export-${Date.now()}.csv`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, rows.join('\n') + '\n', 'utf8')
  return target
}

// Smoke-test mode: isolated userData (logs) + auto-quit after the page loads.
// Must precede requestSingleInstanceLock: the lock is keyed on userData.
if (process.env.GREEN_DSH_USER_DATA !== undefined && process.env.GREEN_DSH_USER_DATA !== '') {
  app.setPath('userData', process.env.GREEN_DSH_USER_DATA)
}
const smoke = process.env.GREEN_DSH_SMOKE === '1'
// Screenshot mode (README shots): walk the console pages and capture each,
// then capture the chat window with the in-chat dashboard card expanded.
const shotsDir = process.env.GREEN_DSH_SHOTS ?? ''
let chatPending = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const target = consoleWindow ?? chatWindow
    if (target !== null) {
      if (target.isMinimized()) target.restore()
      target.focus()
    }
  })

  // in-chat dashboard bridge
  ipcMain.handle('green-desktop:get-global-totals', () => readGlobalTotals(ledgerPath(dshHome())))
  ipcMain.handle('green-desktop:open-ledger-dir', () => shell.openPath(path.dirname(ledgerPath(dshHome()))))

  // console surface
  ipcMain.handle('console:snapshot', () => consoleSnapshot())
  ipcMain.handle('console:log-tail', (event, lines) => {
    const count = Number.isFinite(lines) ? Math.max(1, Math.min(5000, lines)) : 300
    try {
      const text = fs.readFileSync(logFile(), 'utf8')
      return { text: text.split('\n').slice(-count).join('\n') }
    } catch {
      return { text: '' }
    }
  })
  ipcMain.handle('console:open-path', (event, which) => {
    const targets = {
      home: dshHome(),
      ledger: path.dirname(ledgerPath(dshHome())),
      logs: path.dirname(logFile()),
    }
    const target = targets[String(which)]
    return target === undefined ? '' : shell.openPath(target)
  })
  ipcMain.handle('console:save-settings', (event, patch) => {
    try {
      const saved = saveSettings(dshHome(), patch ?? {})
      profileCache = { key: '', value: null }
      return { ok: true, settings: saved }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  ipcMain.handle('console:open-chat', () => { createChatWindow(); return true })
  ipcMain.handle('console:debug-probes', async () => ({
    nvidia: await probeNvidia(),
    windows: await probeWindowsGpu(),
    sampler: sampler.snapshot(),
  }))
  ipcMain.handle('console:relay-refresh', async () => relay.refresh())
  ipcMain.handle('console:calibration-start', (event, payload) => calibration.start(payload ?? {}))
  ipcMain.handle('console:calibration-stop', () => calibration.stop())
  ipcMain.handle('console:alerts-clear', () => {
    alertsEngine.clearHistory(dshHome())
    return { ok: true }
  })
  ipcMain.handle('console:export-csv', () => {
    try {
      return { ok: true, path: exportCsv() }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  app.on('before-quit', () => { quitting = true })
  app.on('will-quit', () => { sampler.stop(); powerMeter.stop(); relay.stop(); stopHarness() })
  app.on('window-all-closed', () => { app.quit() })

  app.whenReady().then(async () => {
    userData = app.getPath('userData')
    startedAt = new Date().toISOString()
    sampler.start()
    powerMeter.start()
    relay.start()
    const { ready, url } = await startHarness()
    if (!ready) {
      void dialog.showErrorBox(
        'Green DSH Desktop',
        'DeepSeek Harness 启动超时。请查看日志目录并重试。',
      )
      app.quit()
      return
    }
    chatUrl = url
    buildMenu()
    // Let the first GPU probe land so the console's first paint already shows
    // hardware telemetry instead of a momentary "未检测".
    await sampler.ready()
    createConsoleWindow()

    // First run: no credentials yet — surface the chat window so onboarding
    // (API key) is discoverable without hunting for it.
    const credentials = path.join(dshHome(), '.credentials.yaml')
    if (!smoke && shotsDir === '' && !fs.existsSync(credentials)) {
      setTimeout(() => { if (!quitting) createChatWindow() }, 1200)
    }

    if (smoke || shotsDir !== '') {
      consoleWindow.webContents.on('console-message', (details) => {
        const level = typeof details === 'object' ? details.level : 'info'
        const message = typeof details === 'object' ? details.message : String(details)
        if (level === 'error' || level === 'warning') console.log(`[smoke][console:${level}] ${message}`)
      })
      consoleWindow.webContents.once('did-finish-load', async () => {
        if (shotsDir !== '') {
          try {
            fs.mkdirSync(shotsDir, { recursive: true })
            const pages = ['overview', 'sessions', 'hardware', 'alerts', 'sources', 'reference', 'ledger']
            for (const page of pages) {
              await consoleWindow.webContents.executeJavaScript(
                `document.querySelector('.nav-item[data-page="${page}"]').click()`,
              )
              await new Promise(resolve => setTimeout(resolve, 1700))
              const image = await consoleWindow.webContents.capturePage()
              fs.writeFileSync(path.join(shotsDir, `console-${page}.png`), image.toPNG())
              console.log(`[shots] console-${page}.png ${image.getSize().width}x${image.getSize().height}`)
            }
            await new Promise(resolve => { chatPending = resolve; createChatWindow() })
            await new Promise(resolve => setTimeout(resolve, 4000))
            try {
              await chatWindow.webContents.executeJavaScript(
                "document.querySelector('[data-green-dashboard=\"pill\"]')?.click()",
              )
            } catch (error) {
              console.log(`[shots] pill click failed: ${String(error)}`)
            }
            await new Promise(resolve => setTimeout(resolve, 1100))
            const chatImage = await chatWindow.webContents.capturePage()
            fs.writeFileSync(path.join(shotsDir, 'chat-dashboard.png'), chatImage.toPNG())
            console.log(`[shots] chat-dashboard.png ${chatImage.getSize().width}x${chatImage.getSize().height}`)
          } catch (error) {
            console.log(`[shots] failed: ${String(error)}`)
          }
          app.quit()
          return
        }
        // Let a couple of 2 s polls settle so the DOM reflects live values.
        await new Promise(resolve => setTimeout(resolve, 3500))
        const state = await consoleWindow.webContents.executeJavaScript(`(() => {
          const text = selector => {
            const node = document.querySelector(selector)
            return node === null ? null : node.textContent.trim()
          }
          const overview = {
            ready: window.__consoleReady === true,
            carbon: text('#stat-carbon'),
            carbonCap: text('#stat-carbon-cap'),
            energy: text('#stat-energy'),
            energyCap: text('#stat-energy-cap'),
            cloudCarbon: text('#stat-cloud-carbon'),
            cloudCarbonCap: text('#stat-cloud-carbon-cap'),
            savedCny: text('#stat-saved-cny'),
            tokens: text('#stat-tokens'),
            requests: text('#stat-requests'),
            cacheCarbon: text('#stat-cache-carbon'),
            pill: text('#saved-pill'),
            harnessPill: text('#pill-harness span:last-child'),
            gpuPill: text('#pill-gpu span:last-child'),
            rings: document.querySelectorAll('#overview-rings .ring').length,
            sideDevice: text('#side-device'),
            dailyBars: document.querySelectorAll('#daily-chart rect').length,
            turnBars: document.querySelectorAll('#turn-chart rect').length,
            turnRows: document.querySelectorAll('#turn-table tbody tr').length,
            turnNote: text('#turn-note'),
            recentRows: document.querySelectorAll('#recent-table tbody tr').length,
          }
          document.querySelector('.nav-item[data-page="hardware"]').click()
          const hardware = {
            gpuBlocks: document.querySelectorAll('.gpu-block').length,
            gpuNote: text('#gpu-note'),
            igpuHidden: document.querySelector('#igpu-card').hidden,
            igpuNote: text('#igpu-note'),
            igpuRings: document.querySelectorAll('#igpu-rings .ring').length,
            deviceRows: document.querySelectorAll('#device-info dt').length,
          }
          document.querySelector('.nav-item[data-page="sessions"]').click()
          const sessions = { rows: document.querySelectorAll('#sessions-table tbody tr').length }
          document.querySelector('.nav-item[data-page="ledger"]').click()
          const ledgerPage = {
            rows: document.querySelectorAll('#ledger-table tbody tr').length,
            measuredCells: [...document.querySelectorAll('#ledger-table tbody tr')]
              .map(row => row.children[9]?.textContent).filter(value => value && value !== '—').length,
          }
          document.querySelector('.nav-item[data-page="settings"]').click()
          const settingsPage = {
            profile: document.querySelector('#set-profile').value,
            localFactor: document.querySelector('#set-local-factor').value,
            options: document.querySelectorAll('#set-profile option').length,
            localPresets: document.querySelectorAll('#set-local-preset option').length,
            cloudModels: document.querySelectorAll('#set-cloud-model option').length,
            cloudModelValue: document.querySelector('#set-cloud-model').value,
            cloudPue: document.querySelector('#set-cloud-pue').value,
          }
          document.querySelector('.nav-item[data-page="alerts"]').click()
          const alertsPage = {
            cards: document.querySelectorAll('#alert-cards .card').length,
            items: document.querySelectorAll('#alert-list .alert-item').length,
            historyRows: document.querySelectorAll('#alert-history-table tbody tr').length,
          }
          document.querySelector('.nav-item[data-page="sources"]').click()
          const sourcesPage = {
            stats: document.querySelectorAll('#relay-stats .card').length,
            status: (document.querySelector('#relay-status').textContent || '').slice(0, 60),
            modelRows: document.querySelectorAll('#relay-model-table tbody tr').length,
          }
          document.querySelector('.nav-item[data-page="reference"]').click()
          const referencePage = {
            gridRows: document.querySelectorAll('#grid-table tbody tr').length,
            cloudRows: document.querySelectorAll('#cloud-ref-table tbody tr').length,
            labRows: document.querySelectorAll('#lab-table tbody tr').length,
            measuredRows: document.querySelectorAll('#measured-table tbody tr').length,
            calibBox: (document.querySelector('#calib-box').textContent || '').slice(0, 80),
          }
          const measurement = {
            available: window.__measurement?.available,
            samples: window.__measurement?.samples,
            baselineW: window.__measurement?.baselineW,
            currentW: window.__measurement?.currentW,
            sessionJ: window.__measurement?.sessionJ,
            perStepKeys: Object.keys(window.__measurement?.perStep ?? {}).length,
          }
          return JSON.stringify({ overview, hardware, sessions, ledgerPage, settingsPage, alertsPage, sourcesPage, referencePage, measurement })
        })()`).catch(error => `{"error":"${String(error)}"}`)
        const probes = await consoleWindow.webContents.executeJavaScript(
          'window.greenConsole.debugProbes().then(value => JSON.stringify({ nvidia: value.nvidia, windows: value.windows, extension: value.sampler.extension, adapters: value.sampler.adapters }))',
        ).catch(error => `{"probeError":"${String(error)}"}`)
        console.log(`[smoke] console window loaded ${state}`)
        console.log(`[smoke] probes ${probes}`)
        // The console must be able to raise the harness chat window.
        await consoleWindow.webContents.executeJavaScript('window.greenConsole.openChat()')
        await new Promise(resolve => setTimeout(resolve, 5000))
        const windows = BrowserWindow.getAllWindows().map(window => ({
          url: window.webContents.getURL(),
          title: window.getTitle(),
        }))
        console.log(`[smoke] windows ${JSON.stringify(windows)}`)
        setTimeout(() => { app.quit() }, 800)
      })
      consoleWindow.webContents.once('did-fail-load', (event, code, description) => {
        console.log(`[smoke] console FAILED to load: ${code} ${description}`)
        app.quit()
      })
    }

    app.on('activate', () => {
      if (consoleWindow === null) createConsoleWindow()
    })
  }).catch((error) => {
    void dialog.showErrorBox('Green DSH Desktop', `启动失败：${error?.message ?? error}`)
    app.quit()
  })
}
