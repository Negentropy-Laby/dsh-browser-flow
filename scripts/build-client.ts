/**
 * Build `lib/client.js`: the lazy-CJS bundle the Harness browser loads.
 *
 * The bundle must be a self-contained factory that calls
 * `window.__ModuleLoader__.load({ id, factory })` exactly once, requires only
 * the frozen platform module table, and runs no module-level side effect.
 *
 * The sources are ordinary ES modules so the tests import them directly. This
 * build resolves their local import graph, concatenates the modules in
 * dependency order inside one factory scope, and strips the module syntax. It
 * deliberately supports only the import forms this package uses: a bare
 * `import { a, b } from './local.ts'` and a bare `import './local.js'`. Anything
 * else fails the build rather than producing a silently broken bundle.
 *
 * Usage: `node --import tsx/esm scripts/build-client.ts`
 */

import { Script } from 'node:vm'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

interface ModuleSource { file: string; source: string }

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(root, '.cache', 'client-js')
/** Bundle entry, relative to `src/`. */
const ENTRY = 'client.js'
/** Module that exports the plugin's `apply`. */
const ENTRY_EXPORT = 'registerPanel'

/** Platform module table: the only specifiers a bundle may `require`. */
const PLATFORM_MODULES = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  'zod', '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** A local import: `import { a, b } from './x.ts'` or `import './x.js'`. */
const LOCAL_IMPORT = /^import\s+(?:\{([^}]*)\}\s+from\s+)?(['"])(\.[^'"]+|#browser-flow\/page-programs)\2\s*;?\s*$/gm
/** Literal packaged JSON is embedded, never fetched by the Client. */
const LOCAL_JSON_IMPORT = /^import\s+(\w+)\s+from\s+'(\.[^']+\.json)'\s+with\s*\{\s*type:\s*'json'\s*\}\s*;?\s*$/gm

/**
 * Strip block and line comments from one module body.
 *
 * Only used for static checks, never for the emitted bundle, so a comment
 * containing an apostrophe cannot corrupt the output.
 * @param {string} source - module text.
 * @returns {string} text without comments.
 */
export function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

/**
 * Read one module and return its body with local imports resolved.
 * @param {string} file - module path relative to `src/`, using `/`.
 * @param {Set<string>} seen - modules already emitted.
 * @param {string[]} order - emitted module order.
 * @returns {void}
 */
function collect(file: string, seen: Set<string>, order: ModuleSource[]) {
  const normalized = posix.normalize(file)
  if (seen.has(normalized)) return
  seen.add(normalized)
  if (file === '#browser-flow/page-programs') {
    const source = readFileSync(join(root, 'lib', 'page-programs.js'), 'utf8')
    const parsed = ts.createSourceFile('page-programs.js', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
    for (const statement of parsed.statements) {
      if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) throw new Error('Unexpected generated page module')
      const name = statement.declarationList.declarations[0].name.getText(parsed)
      order.push({ file: name === 'PASSIVE_IMPORT_SOURCE' ? 'generated/passive-import' : 'generated/' + name, source: statement.getText(parsed) })
    }
    return
  }
  const absolute = join(sourceRoot, ...normalized.split('/'))
  const source = readFileSync(absolute, 'utf8')
  const dependencies = []
  for (const match of source.matchAll(LOCAL_IMPORT)) {
    const specifier = match[3]
    const target = specifier === '#browser-flow/page-programs' ? specifier : posix.normalize(posix.join(posix.dirname(normalized), specifier))
    dependencies.push(target)
  }
  for (const dependency of dependencies) collect(dependency, seen, order)
  order.push({ file: normalized, source })
}

/**
 * Remove module syntax from one module body.
 * @param {object} module - `{ file, source }`.
 * @returns {string} body without imports/exports.
 */
export function stripModuleSyntax({ file, source }: ModuleSource) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  const literals: { start: number; end: number }[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) literals.push({ start: node.getStart(parsed), end: node.end })
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  let body = source.replace(/[\t ]+$/gm, (spaces: string, offset: number) => literals.some(range => offset >= range.start && offset < range.end) ? spaces : '')
  body = body.replace(LOCAL_JSON_IMPORT, (_match, name, specifier) => {
    const path=join(sourceRoot,posix.dirname(file),specifier)
    return `const ${name} = ${JSON.stringify(JSON.parse(readFileSync(path,'utf8')))}\n`
  })
  body = body.replace(LOCAL_IMPORT, '')
  body = body.replace(/^export\s+default\s+[^;\n]+;?$/gm, '')
  body = body.replace(/^export\s+\{[^}]*\}\s*(?:from\s+'[^']+')?\s*;?$/gm, '')
  body = body.replace(/^export\s+(const|let|var|function|class|async\s+function)\s/gm, '$1 ')
  const leftover = body.match(/^export\s+/m)
  if (leftover !== null) throw new Error(`${file}: unsupported export form near "${leftover[0]}"`)
  const leftoverImport = body.match(/^import\s+/m)
  if (leftoverImport !== null) throw new Error(`${file}: unsupported import form near "${leftoverImport[0]}"`)
  const original=file.startsWith('generated/')?file:file.replace(/\.js$/,'.ts')
  if(!file.startsWith('generated/')&&!existsSync(join(root,'src',original)))throw new Error('Client module has no TypeScript source: '+file)
  return `// ---- ${file.startsWith('generated/') ? file : 'src/'+original} ----\n${body.trim()}\n`
}

/**
 * Assemble the bundle from the resolved module graph.
 * @returns {string} bundle text.
 */
export function composeBundle() {
  const seen = new Set<string>()
  const order: ModuleSource[] = []
  collect(ENTRY, seen, order)
  const bodies = order.map(stripModuleSyntax).join('\n')
  return `window.__ModuleLoader__.load({
  id: '@negentropy/dsh-browser-flow',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const react = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const panelCss = ${JSON.stringify(readFileSync(join(root,'src','panel.css'),'utf8'))}
${bodies}
    Object.assign(exports, {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply: function (ctx) { ${ENTRY_EXPORT}(ctx, react, primitives, panelCss) },
    })
    return module.exports
  },
})
`
}

/**
 * Static contract checks the shipped bundle must satisfy.
 * @param {string} bundle - bundle text.
 * @returns {{ name: string, ok: boolean, detail?: string }[]} check results.
 */
export function checkBundle(bundle: string) {
  const bare = stripComments(bundle)
  const requires = [...bundle.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map(match => match[1])
  const foreign = requires.filter(specifier => !PLATFORM_MODULES.has(specifier))
  const registrationCount = (bare.match(/__ModuleLoader__\.load\(/g) ?? []).length
  return [
    { name: 'registers once through __ModuleLoader__.load', ok: registrationCount === 1 },
    { name: 'id equals the package name', ok: bare.includes("id: '@negentropy/dsh-browser-flow'") },
    { name: 'factory returns an object plugin', ok: /inject:\s*\[/.test(bare) && /apply:\s*function/.test(bare) },
    { name: 'requires only the platform module table', ok: foreign.length === 0, detail: foreign.join(', ') },
    { name: 'no module-level network or DOM write', ok: !/^fetch\(|^document\./m.test(bare) },
    { name: 'page programs inlined', ok: bare.includes('identityProgram()') && bare.includes('actProgram(input)') },
    { name: 'client helpers inlined', ok: bare.includes('WEBVIEW_SELECTOR') && bare.includes('classifyResult') },
    { name: 'no module syntax left in the factory', ok: !/^export\s|^import\s/m.test(bare) },
    {
      // The shipped Browser owns the guest; the plugin only queries it. Both
      // halves matter: acquiring a guest is refused by the main process, and
      // releasing one would close a page the user is working in.
      name: 'never acquires or releases the guest',
      // Neither identifier may appear at all: optional chaining (`browser?.release?.()`)
      // would slip past a property-shaped pattern, and the panel needs neither.
      ok: !/\b(acquire|release)\b/.test(bare),
    },
    {
      name: 'never creates a webview element',
      ok: !/createElement\(\s*['"]webview['"]/.test(bare),
    },
    {
      // The README promises the panel never reads cookies, storage or tokens. A
      // page program that touched them would ship silently otherwise.
      name: 'page programs never read credentials or storage',
      ok: !/document\.cookie|localStorage|sessionStorage|indexedDB/.test(bare),
    },
    {
      name: 'XHR references confined to the fixed passive import program',
      ok: !/XMLHttpRequest/.test(bundle.replace(/\/\/ ---- generated\/passive-import ----[\s\S]*?(?=\/\/ ---- |    Object\.assign\(exports,)/, '')),
    },
    { name: 'registers through ctx.effect and ctx.slots.inject', ok: (bare.match(/ctx\.effect\(/g) ?? []).length >= 2 && (bare.match(/ctx\.slots\.inject\(/g) ?? []).length >= 2 },
  ]
}

/**
 * Build the bundle and write it to `lib/client.js`.
 * @returns {{ bundle: string, checks: object[] }} built text and check results.
 */
export function build() {
  const compiled = spawnSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'tsconfig.client.emit.json')], { cwd: root, stdio: 'inherit' })
  if (compiled.status !== 0) throw new Error('Client compilation failed')
  const bundle = composeBundle()
  const checks = checkBundle(bundle)
  const failed = checks.filter(check => !check.ok)
  if (failed.length > 0) {
    throw new Error(`client bundle contract failed:\n${failed.map(check => `  - ${check.name}${check.detail === undefined ? '' : ` (${check.detail})`}`).join('\n')}`)
  }
  mkdirSync(join(root, 'lib'), { recursive: true })
  new Script(bundle, {filename:'browser-flow-client.js'})
  writeFileSync(join(root, 'lib', 'client.js'), bundle)
  return { bundle, checks }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { checks } = build()
  process.stdout.write(`browser-flow: lib/client.js written; ${String(checks.length)} contract checks passed\n`)
  void relative
}
