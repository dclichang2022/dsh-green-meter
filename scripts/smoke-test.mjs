/**
 * Headless smoke test for the bundled harness: boots `dsh web` with an
 * isolated DSH_HOME (composition patch + node_modules junction), then probes
 * the web root and the three plugin client bundles. No GUI involved.
 *
 * Usage: node scripts/smoke-test.mjs
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessNodeModules = join(repo, 'resources', 'harness', 'node_modules')
const bin = join(harnessNodeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const home = join(repo, 'tmp', 'smoke-home')
const PATCH = `- insert:
    - id: green-meter
      name: '@deepseek-ai/dsh-green-meter'
      config:
        profile: proxy
        carbonFactorKgPerKwh: 0.5777
    - id: ui-green-meter
      name: '@deepseek-ai/dsh-client-ui-green-meter'
    - id: ui-green-dashboard
      name: '@green-dsh/dsh-client-ui-green-dashboard'
      config:
        cloudCarbonFactorKgPerKwh: 0.4
        apiPriceCnyPerMInput: 2.0
        apiPriceCnyPerMCached: 0.5
        apiPriceCnyPerMOutput: 8.0
        refreshMs: 5000
`

if (!existsSync(bin)) throw new Error('harness not built: run scripts/build-harness.mjs first')

rmSync(home, { recursive: true, force: true })
mkdirSync(join(home, 'green-meter'), { recursive: true })
writeFileSync(join(home, 'cordis.patch.yml'), PATCH, 'utf8')
// Junction DSH_HOME/node_modules → harness node_modules (profile-dir resolution).
const link = join(home, 'node_modules')
execFileSync('cmd', ['/c', 'mklink', '/J', link, harnessNodeModules], { stdio: 'ignore', windowsHide: true })

const port = await new Promise((resolvePort, reject) => {
  const s = createServer()
  s.on('error', reject)
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port
    s.close(() => resolvePort(p))
  })
})

const child = spawn(process.execPath, [bin, 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
  cwd: join(repo, 'tmp'),
  env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let out = ''
child.stdout.on('data', chunk => { out += chunk })
child.stderr.on('data', chunk => { out += chunk })

async function probe(path) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(8000) })
    const body = await res.text()
    return { status: res.status, bytes: body.length, head: body.slice(0, 90).replace(/\n/g, ' ') }
  } catch (error) {
    return { error: String(error) }
  }
}

const deadline = Date.now() + 150_000
let ready = false
while (Date.now() < deadline && !ready) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) })
    ready = res.ok
  } catch { /* not up yet */ }
  if (!ready) await new Promise(r => setTimeout(r, 1000))
}
if (!ready) {
  console.log('HARNESS DID NOT BECOME READY')
  console.log(out.slice(-2000))
  child.kill()
  process.exit(1)
}
console.log('HARNESS READY')
console.log('GET /                      →', JSON.stringify(await probe('/')))
console.log('GET /plugins/@green-dsh/dsh-client-ui-green-dashboard/client.js →', JSON.stringify(await probe('/plugins/@green-dsh/dsh-client-ui-green-dashboard/client.js')))
console.log('GET /plugins/@deepseek-ai/dsh-client-ui-green-meter/client.js    →', JSON.stringify(await probe('/plugins/@deepseek-ai/dsh-client-ui-green-meter/client.js')))
console.log('GET /plugins/@deepseek-ai/dsh-green-meter/client.js             →', JSON.stringify(await probe('/plugins/@deepseek-ai/dsh-green-meter/client.js')))
await new Promise(r => setTimeout(r, 1500))
console.log('--- last 1500 chars of harness log ---')
console.log(out.slice(-1500))
child.kill()
process.exit(0)
