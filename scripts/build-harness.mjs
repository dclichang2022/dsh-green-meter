/**
 * Assemble the bundled harness runtime: resources/harness/ becomes a
 * self-contained flat npm deployment of the published `@deepseek-ai/dsh`
 * distribution plus the three local plugin tarballs from vendor/. A flat
 * npm layout hoists every transitive dependency, so the DSH_HOME/node_modules
 * junction (created at runtime) resolves the whole plugin composition.
 *
 * Usage: node scripts/build-harness.mjs
 * Env:   NPM_REGISTRY — registry for the install
 *        (default: https://registry.npmmirror.com).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessDir = join(repo, 'resources', 'harness')
const registry = process.env.NPM_REGISTRY ?? 'https://registry.npmmirror.com'
mkdirSync(harnessDir, { recursive: true })

const manifest = {
  name: 'green-dsh-harness',
  version: '0.1.0',
  private: true,
  dependencies: {
    '@deepseek-ai/dsh': '0.1.1-rc.2',
    // Peer-only packages the legacy-peer-deps install does not auto-fetch.
    '@deepseek-ai/cordis-plugin-group': '^1.0.1',
    '@deepseek-ai/dsh-system-prompt': '^0.1.1-rc.2',
    '@deepseek-ai/dsh-green-meter': 'file:../../vendor/deepseek-ai-dsh-green-meter-0.1.0-rc.5.tgz',
    '@deepseek-ai/dsh-client-ui-green-meter': 'file:../../vendor/deepseek-ai-dsh-client-ui-green-meter-0.1.0-rc.5.tgz',
    '@green-dsh/dsh-client-ui-green-dashboard': 'file:../../vendor/green-dsh-dsh-client-ui-green-dashboard-0.1.0.tgz',
  },
}
writeFileSync(join(harnessDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

/** Locate npm-cli.js (the .cmd shim is not spawnable without a shell). */
function npmCli() {
  const candidates = [
    process.env.NPM_CLI,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(process.env.ProgramFiles ?? '', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  for (const candidate of candidates) {
    if (candidate !== undefined && existsSync(candidate)) return candidate
  }
  throw new Error('build-harness: npm-cli.js not found')
}

execFileSync(process.execPath, [
  npmCli(),
  'install',
  '--omit=dev',
  '--no-audit',
  '--no-fund',
  '--prefer-offline',
  '--legacy-peer-deps',
  `--registry=${registry}`,
  '--fetch-retries=3',
], {
  cwd: harnessDir,
  stdio: 'inherit',
  windowsHide: true,
})

// The legacy-peer-deps install does not auto-fetch peer-only packages. Close
// the gap by scanning the installed @deepseek-ai family and re-installing
// until no installed package names a missing scoped peer (bounded rounds).
const nm = join(harnessDir, 'node_modules')
for (let round = 0; round < 4; round += 1) {
  const installed = new Set(readdirSync(join(nm, '@deepseek-ai'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name))
  const missing = new Map()
  for (const name of installed) {
    const manifestPath = join(nm, '@deepseek-ai', name, 'package.json')
    if (!existsSync(manifestPath)) continue
    const pkgManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    for (const [peer, range] of Object.entries(pkgManifest.peerDependencies ?? {})) {
      if (!peer.startsWith('@deepseek-ai/')) continue
      const short = peer.slice('@deepseek-ai/'.length)
      if (!installed.has(short) && !missing.has(peer)) missing.set(peer, range)
    }
  }
  if (missing.size === 0) break
  manifest.dependencies = { ...manifest.dependencies, ...Object.fromEntries(missing) }
  writeFileSync(join(harnessDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  execFileSync(process.execPath, [
    npmCli(),
    'install', '--omit=dev', '--no-audit', '--no-fund', '--prefer-offline',
    '--legacy-peer-deps', `--registry=${registry}`, '--fetch-retries=3',
  ], {
    cwd: harnessDir,
    stdio: 'inherit',
    windowsHide: true,
  })
}

// Patch the boot layer's junction fallback: the desktop shell keeps the DSH
// home INSIDE the harness deployment, so Node's parent-directory walk
// resolves the whole composition without any links. The patch replaces the
// heal step's link creation with an env-gated helper (GREEN_DSH_NO_JUNCTIONS
// skips the junction farm entirely — 190+ slow mklink spawns and the Windows
// symlink privilege both disappear). Idempotent across helper revisions.
const APP_BOOT_LIB = join(nm, '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
let appBoot = readFileSync(APP_BOOT_LIB, 'utf8')
if (!appBoot.includes('GREEN_DSH_NO_JUNCTIONS')) {
  // Strip a previous helper revision (appended after this import line) and
  // restore the original call site so the uniform replacement below applies.
  const oldImport = 'import { spawnSync as __greenSpawnSync } from "node:child_process";'
  const oldIndex = appBoot.indexOf(oldImport)
  if (oldIndex !== -1) appBoot = appBoot.slice(0, oldIndex)
  const oldCall = '__greenJunctionSync(target, link);'
  if (appBoot.includes(oldCall)) {
    appBoot = appBoot.replace(oldCall, 'symlinkSync(target, link, "junction");')
  }

  const CALL_SITE = 'symlinkSync(target, link, "junction");'
  const occurrences = appBoot.split(CALL_SITE).length - 1
  if (occurrences !== 1) {
    throw new Error(`build-harness: expected exactly one junction call site in dsh-app-boot, found ${occurrences}`)
  }
  const helper = `

import { spawnSync as __greenSpawnSync } from "node:child_process";
function __greenJunctionSync(target, link) {
  // The desktop shell keeps the DSH home INSIDE the harness deployment, so
  // Node's parent-directory walk resolves every plugin without any links.
  // Skipping the link farm avoids 190+ slow mklink spawns (and the Windows
  // symlink privilege requirement) entirely.
  if (process.env.GREEN_DSH_NO_JUNCTIONS === "1") return;
  try {
    symlinkSync(target, link, "junction");
    return;
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
  }
  try {
    const result = __greenSpawnSync("cmd", ["/c", "mklink", "/J", link, target], { stdio: "ignore", windowsHide: true });
    if (result.status === 0) return;
  } catch {
    // Fall through: resolution still works through the parent-directory walk
    // (the DSH home lives inside the harness tree), so a missing link is fine.
  }
}
`
  writeFileSync(APP_BOOT_LIB, appBoot.replace(CALL_SITE, '__greenJunctionSync(target, link);') + helper, 'utf8')
  console.log('build-harness: patched dsh-app-boot junction fallback')
}
console.log('build-harness: done')
