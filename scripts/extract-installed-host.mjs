/**
 * Extract the installed Host packages needed for the loadability proof.
 *
 * Reads `resources/app.asar` directly (no asar tool required) and copies only
 * the transitive closure of the two entry packages the proof imports, so the
 * evidence stays small while remaining byte-identical to the installed build.
 *
 * Usage: `node scripts/extract-installed-host.mjs <app.asar path> [output dir]`
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Default extraction directory. */
const defaultOut = join(root, '.evidence', 'installed-host')

/** Packages the proof imports directly; their dependencies are followed. */
const ENTRIES = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools']

/**
 * Read one asar archive into a path → bytes map plus its root header.
 * @param {string} archive - asar file path.
 * @returns {{ files: Map<string, Buffer>, read: (path: string) => Buffer | undefined, header: object }} archive view.
 */
export function openAsar(archive) {
  const bytes = readFileSync(archive)
  const headerSize = bytes.readUInt32LE(12)
  const header = JSON.parse(bytes.subarray(16, 16 + headerSize).toString('utf8'))
  const dataStart = 8 + bytes.readUInt32LE(4)
  const files = new Map()
  const walk = (node, prefix) => {
    if (node.files !== undefined) {
      for (const [name, child] of Object.entries(node.files)) walk(child, `${prefix}/${name}`)
      return
    }
    files.set(prefix, bytes.subarray(dataStart + Number(node.offset), dataStart + Number(node.offset) + node.size))
  }
  walk(header, '')
  return { files, header, read: path => files.get(path) }
}

/**
 * Read one package manifest from the archive.
 * @param {ReturnType<typeof openAsar>} archive - archive view.
 * @param {string} packageName - npm package name.
 * @returns {object | undefined} manifest, or undefined when the package is absent.
 */
function manifestOf(archive, packageName) {
  const bytes = archive.read(`/dsh/node_modules/${packageName}/package.json`)
  return bytes === undefined ? undefined : JSON.parse(bytes.toString('utf8'))
}

/**
 * Collect the transitive dependency closure of the entry packages.
 * @param {ReturnType<typeof openAsar>} archive - archive view.
 * @returns {{ packages: string[], missing: string[] }} resolved packages and unresolved names.
 */
export function closure(archive) {
  const seen = new Set()
  const missing = new Set()
  const queue = [...ENTRIES]
  while (queue.length > 0) {
    const name = queue.shift()
    if (seen.has(name)) continue
    const manifest = manifestOf(archive, name)
    if (manifest === undefined) { missing.add(name); continue }
    seen.add(name)
    const dependencies = {
      ...manifest.dependencies ?? {},
      ...manifest.peerDependencies ?? {},
      ...manifest.optionalDependencies ?? {},
    }
    for (const dependency of Object.keys(dependencies)) {
      if (dependency.startsWith('@deepseek-ai/') || dependency === 'cosmokit' || dependency === 'schemastery') {
        queue.push(dependency.startsWith('@deepseek-ai/') ? dependency : `@deepseek-ai/${dependency}`)
      }
    }
  }
  return { packages: [...seen].sort(), missing: [...missing].sort() }
}

/**
 * Write the closure's files under `<out>/node_modules`.
 * @param {ReturnType<typeof openAsar>} archive - archive view.
 * @param {string[]} packages - package names to extract.
 * @param {string} out - extraction directory.
 * @returns {number} number of files written.
 */
export function extract(archive, packages, out) {
  let written = 0
  for (const packageName of packages) {
    const prefix = `/dsh/node_modules/${packageName}/`
    for (const [path, bytes] of archive.files) {
      if (!path.startsWith(prefix)) continue
      const target = join(out, 'node_modules', ...path.slice('/dsh/node_modules/'.length).split('/'))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, bytes)
      written++
    }
  }
  return written
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const archivePath = process.argv[2] ?? process.env.DSH_BF_APP_ASAR
  if (!archivePath) throw new Error('Provide an app.asar path as the first argument or DSH_BF_APP_ASAR; no installation path is assumed.')
  const archive = openAsar(archivePath)
  const out = process.argv[3] ?? defaultOut
  const { packages, missing } = closure(archive)
  const written = extract(archive, packages, out)
  // Record the application identity the extraction came from, so the proof
  // names the exact installed build rather than a directory path.
  const app = JSON.parse(archive.read('/package.json').toString('utf8'))
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'desktop-app-manifest.json'), `${JSON.stringify({
    name: app.name,
    version: app.version,
    dshBuildCommit: app.dshBuildCommit,
    dshBuildDirty: app.dshBuildDirty,
    dshDesktopAppId: app.dshDesktopAppId,
    dshDesktopUpdateChannel: app.dshDesktopUpdateChannel,
    source: 'resources/app.asar package.json',
    electronVersion: existsSync(join(dirname(dirname(archivePath)), 'version'))
      ? readFileSync(join(dirname(dirname(archivePath)), 'version'), 'utf8').trim() : null,
    packages,
  }, undefined, 2)}\n`)
  process.stdout.write(`installed-host: ${String(packages.length)} packages, ${String(written)} files -> ${out}\n`)
  if (missing.length > 0) process.stdout.write(`installed-host: unresolved optional packages: ${missing.join(', ')}\n`)
  void posix
}
