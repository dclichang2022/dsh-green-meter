/**
 * DSH home bootstrap. The preferred layout keeps the app-private home INSIDE
 * the harness deployment directory (`resources/harness/dsh-home`) so Node's
 * module resolution walks up from the profile directory
 * (`<home>/profiles/web`) and lands in `resources/harness/node_modules` with
 * no symlinks or junctions involved — deliberately avoiding Windows
 * link-creation privileges, which Electron's bundled Node cannot always
 * obtain.
 *
 * Per-machine installs land in `C:\Program Files`, which a normal user
 * cannot write to, so the in-tree home is unusable there (every run would
 * die with `EPERM ... mkdir ...\dsh-home\green-meter`). When the install
 * directory is not writable, the home moves to a per-user base and a
 * `node_modules` junction re-attaches it to the bundled harness — the same
 * resolution the CLI smoke test (`scripts/smoke-test.mjs`) uses; the
 * harness's own `profiles/node_modules` fallback covers the rest.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

/** App-private DSH home inside the unpacked harness deployment directory. */
function dshHomePath(harnessRoot) {
  return path.join(harnessRoot, 'dsh-home')
}

/** Green-meter ledger location (green-meter's default `dir` under DSH_HOME). */
function ledgerPath(home) {
  return path.join(home, 'green-meter', 'ledger.jsonl')
}

/** True when a file can be created (and removed) inside `dir`. */
function isWritable(dir) {
  const probe = path.join(dir, `.write-probe-${process.pid}-${Date.now()}`)
  try {
    fs.writeFileSync(probe, '')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/** Ensure `link` is a junction to the absolute `target` (needs no privilege). */
function ensureJunction(link, target) {
  if (fs.existsSync(link)) return
  try {
    fs.symlinkSync(target, link, 'junction')
    return
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES' && error.code !== 'EEXIST') throw error
  }
  const result = spawnSync('cmd', ['/c', 'mklink', '/J', link, target], {
    stdio: 'ignore',
    windowsHide: true,
  })
  if (result.status !== 0 && !fs.existsSync(link)) {
    throw new Error(`Green DSH: cannot create junction "${link}" -> "${target}"`)
  }
}

/**
 * Resolve the DSH home. The in-tree (portable) location is always tried
 * first; only when it cannot be created or written to — per-machine
 * installs under `C:\Program Files` — does the home fall back to
 * `<fallbackBase>/dsh-home` with a `node_modules` junction back to the
 * bundled harness.
 *
 * @param {string} harnessRoot unpacked harness deployment directory.
 * @param {string} fallbackBase per-user base directory for the fallback home
 *   (the Electron userData directory).
 * @returns {{ home: string, inTree: boolean }}
 */
function ensureDshHome(harnessRoot, fallbackBase) {
  const inTree = dshHomePath(harnessRoot)
  try {
    fs.mkdirSync(path.join(inTree, 'green-meter'), { recursive: true })
    if (isWritable(inTree)) return { home: inTree, inTree: true }
  } catch {
    // Not creatable (e.g. read-only Program Files) - use the user base.
  }
  const home = path.join(fallbackBase, 'dsh-home')
  fs.mkdirSync(path.join(home, 'green-meter'), { recursive: true })
  ensureJunction(path.join(home, 'node_modules'), path.join(harnessRoot, 'node_modules'))
  return { home, inTree: false }
}

module.exports = { ensureDshHome, dshHomePath, ledgerPath }
