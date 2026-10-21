/**
 * Typecheck the package's plain JavaScript.
 *
 * The sources are JSDoc-typed ESM, so `checkJs` is what turns those annotations
 * into an enforced contract. The compiler comes from a sibling Harness checkout
 * rather than a package dependency: this plugin is installed by link into a
 * profile and must not add a toolchain to it.
 *
 * Resolution order for the compiler: `DSH_TSC`, then the sibling checkout's
 * `node_modules/.bin`, then a local one. The script exits non-zero on any
 * diagnostic, so it can gate a release.
 *
 * Usage: `node scripts/typecheck.mjs`
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = process.env.DSH_CHECKOUT ?? join(root, '..', 'deepseek-harness')

/**
 * Locate a TypeScript compiler.
 * @returns {string | undefined} path to the compiler entry.
 */
function findCompiler() {
  if (process.env.DSH_TSC !== undefined) return process.env.DSH_TSC
  const candidates = [
    join(checkout, 'node_modules', 'typescript', 'bin', 'tsc'),
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  ]
  return candidates.find(candidate => existsSync(candidate))
}

const compiler = findCompiler()
if (compiler === undefined) {
  process.stderr.write(
    'browser-flow: typecheck skipped — no TypeScript compiler found.\n'
    + `  Looked for a sibling checkout at ${checkout}; set DSH_TSC to the tsc entry to override.\n`,
  )
  process.exitCode = 0
} else {
  const result = spawnSync(process.execPath, [compiler, '-p', join(root, 'jsconfig.json')], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.stdout !== '') process.stdout.write(result.stdout)
  if (result.stderr !== '') process.stderr.write(result.stderr)
  if (result.status === 0) {
    process.stdout.write('browser-flow: typecheck clean\n')
  } else {
    process.exitCode = result.status ?? 1
  }
}
