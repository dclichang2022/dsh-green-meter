/**
 * Pack the three plugin packages from the DeepSeek Harness checkout into
 * vendor/*.tgz and patch each manifest for standalone npm installation:
 *   - `private: true` removed (publish guard only; local tarballs may carry it,
 *     but stripping keeps npm quiet),
 *   - `workspace:^` peer ranges rewritten to the published dsh family range
 *     (`^0.1.1-rc.2`, cordis `^4.0.1`), and the two green-meter packages
 *     versioned `0.1.1-rc.2` so cross-peer ranges resolve against each other.
 *
 * Usage: node scripts/vendor-plugins.mjs
 * Env:   DSH_CHECKOUT — path to the deepseek-harness checkout
 *        (default: the machine-local checkout used by this project).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = join(repo, 'vendor')
const tmp = join(repo, 'tmp', 'vendor-patch')
const dsh = process.env.DSH_CHECKOUT
  ?? 'C:\\Users\\asus\\Documents\\Qoder\\2026-08-13\\chat-4\\deepseek-harness'

const PACKAGES = [
  {
    dir: join(dsh, 'packages', 'llm', 'green-meter'),
    name: 'deepseek-ai-dsh-green-meter-0.1.0-rc.5',
    version: '0.1.1-rc.2',
  },
  {
    dir: join(dsh, 'packages', 'client', 'ui-green-meter'),
    name: 'deepseek-ai-dsh-client-ui-green-meter-0.1.0-rc.5',
    version: '0.1.1-rc.2',
  },
  {
    dir: join(dsh, 'packages', 'client', 'ui-green-dashboard'),
    name: 'green-dsh-dsh-client-ui-green-dashboard-0.1.0',
    version: null, // keep its own version; nothing peers on it
  },
]

mkdirSync(vendor, { recursive: true })

/** Run npm pack; the .cmd shim is not spawnable without a shell, so fall back
 * to npm-cli.js through node. */
function runNpm(args, options) {
  try {
    return execFileSync('npm', args, options)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    // npm ships next to the node binary in the same install.
    const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    return execFileSync(process.execPath, [cli, ...args], options)
  }
}

for (const pkg of PACKAGES) {
  if (!existsSync(pkg.dir)) {
    throw new Error(`plugin package not found: ${pkg.dir} (set DSH_CHECKOUT to the checkout path)`)
  }
  const tgz = join(vendor, `${pkg.name}.tgz`)
  runNpm(['pack', '--pack-destination', vendor, '--silent'], {
    cwd: pkg.dir,
    stdio: 'inherit',
    windowsHide: true,
  })

  // Patch the manifest inside the tarball.
  const extractDir = join(tmp, pkg.name)
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  execFileSync('tar', ['-xf', tgz, '-C', extractDir], { stdio: 'ignore', windowsHide: true })

  const manifestPath = join(extractDir, 'package', 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  delete manifest.private
  if (pkg.version !== null) manifest.version = pkg.version
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies']) {
    if (!manifest[section]) continue
    for (const key of Object.keys(manifest[section])) {
      if (manifest[section][key] !== 'workspace:^') continue
      manifest[section][key] = key === '@deepseek-ai/cordis' ? '^4.0.1' : '^0.1.1-rc.2'
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  rmSync(tgz)
  execFileSync('tar', ['-czf', tgz, '-C', extractDir, 'package'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  console.log(`vendor: ${pkg.name}.tgz (${manifest.name}@${manifest.version})`)
}
console.log('vendor-plugins: done')
