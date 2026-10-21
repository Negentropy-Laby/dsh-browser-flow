import {present,expectRecord} from './helpers/assertions.ts'
import type {BundleRegistration} from './helpers/client-ports.ts'
/**
 * Real client-runtime test: load the built bundle into a jsdom realm and drive
 * its registration path end to end.
 *
 * The other client tests assert the bundle as data and the panel component in
 * isolation. This one closes the remaining client-side gap: it executes
 * `lib/client.js` as a browser program inside a real DOM, with only the frozen
 * platform module table available to it, then applies the resulting plugin into
 * a slot registry and renders the panel with real React.
 *
 * It skips, with a printed reason, when the local checkout has no built client
 * packages, or when React, React DOM, or jsdom cannot be resolved.
 */

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = process.env.DSH_CHECKOUT ?? join(root, '..', 'deepseek-harness')

/**
 * Resolve one dependency the way pnpm lays it out: a hoisted `node_modules`
 * entry when present, otherwise the first matching store directory.
 * @param {string} name - package name.
 * @returns {string | undefined} absolute package directory.
 */
function resolveDependency(name: string) : string | undefined {
  const direct = join(checkout, 'node_modules', name)
  if (existsSync(direct)) return direct
  const store = join(checkout, 'node_modules', '.pnpm')
  if (!existsSync(store)) return undefined
  const prefix = `${name.replace('/', '+')}@`
  for (const entry of readdirSync(store)) {
    if (!entry.startsWith(prefix)) continue
    const candidate = join(store, entry, 'node_modules', name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Read a package's declared entry point from its manifest.
 * @param {string} packageDir - package directory.
 * @returns {string} absolute entry file.
 */
function entryOf(packageDir: string) : string {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const main = typeof manifest.main === 'string' ? manifest.main : 'index.js'
  return join(packageDir, main)
}

const modulesClient = join(checkout, 'packages', 'client', 'modules', 'lib', 'client.js')
const slotsLib = join(checkout, 'packages', 'client', 'ui-slots', 'lib', 'index.js')
const reactEntry = resolveDependency('react')
const reactDomEntry = resolveDependency('react-dom')
const jsdomEntry = resolveDependency('jsdom')

const missing = []
if (!existsSync(modulesClient)) missing.push('packages/client/modules/lib/client.js')
if (!existsSync(slotsLib)) missing.push('packages/client/ui-slots/lib/index.js')
if (reactEntry === undefined) missing.push('react')
if (reactDomEntry === undefined) missing.push('react-dom')
if (jsdomEntry === undefined) missing.push('jsdom')
const ready = missing.length === 0

describe('client bundle in a real DOM', { skip: ready ? false : `missing built client packages or DOM deps: ${missing.join(', ')}` }, () => {
  it('registers through the loader, applies into a slot registry, and renders the panel', async () => {
    const { JSDOM } = await import(pathToFileURL(entryOf(present(jsdomEntry))).href)
    const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'http://127.0.0.1:1/',
      pretendToBeVisual: true,
    })
    const window = dom.window

    // The panel polls on a timer; keep the realm's clock inert so the test
    // decides when work happens, and so nothing outlives the assertions.
    window.setInterval = () => 0
    window.clearInterval = () => {}

    /** Every module the bundle asked for, in order. */
    const requested:string[] = []
    const factories = new Map<string,BundleRegistration['factory']>()
    // The real loader receives one `load({ id, factory })` call per bundle.
    window.__ModuleLoader__ = {
      load(registration:BundleRegistration) {
        factories.set(registration.id, registration.factory)
      },
    }

    // React DOM reads `window`/`document` from the global scope at call time,
    // so the realm must be installed before the bundle renders. Save and restore
    // the host globals so this test cannot affect another.
    const saved = {
      window: globalThis.window,
      document: globalThis.document,
      navigator: globalThis.navigator,
    }
    globalThis.window = window
    globalThis.document = window.document
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })

    try {
      const react = await import(pathToFileURL(entryOf(present(reactEntry))).href)
      // The platform table carries `react-dom` and `react-dom/client` as distinct
      // specifiers; resolve each from its own subpath so React does not warn.
      const reactDomClient = await import(pathToFileURL(join(present(reactDomEntry), 'client.js')).href)
      const reactDomMain = await import(pathToFileURL(entryOf(present(reactDomEntry))).href)
      const React = react.default ?? react
      const platform:Record<string,unknown> = {
        react: React,
        'react-dom': reactDomMain.default ?? reactDomMain,
        'react-dom/client': reactDomClient,
      }

      // Execute the bundle exactly as a browser would: as a program in the page
      // realm, with `require` limited to the frozen platform table.
      const requireFromPlatform = (specifier:string) => {
        requested.push(specifier)
        if (!Object.hasOwn(platform, specifier)) {
          throw new Error(`the bundle required a non-platform module: ${specifier}`)
        }
        return platform[specifier]
      }
      new window.Function('require', bundle)(requireFromPlatform)

      assert.equal(factories.size, 1, 'the bundle must register exactly one module')
      const [id, factory] = [...factories.entries()][0]
      assert.equal(id, '@negentropy/dsh-browser-flow')

      const plugin = factory(requireFromPlatform)
      assert.equal(typeof plugin.apply, 'function')
      // The array is a jsdom-realm Array, so copy it before a strict comparison.
      assert.deepEqual([...plugin.inject], ['slots', 'locale', 'sidebarRightTabs'])

      // Real slot registry semantics: `register` returns a disposer and the slot
      // keeps contributions keyed by owner.
      const slotsModule = await import(pathToFileURL(slotsLib).href)
      assert.equal(typeof slotsModule, 'object')

      const effects:(void|(()=>void|Promise<void>))[] = []
      const tabTypes:import('../src/client.ts').TabDefinition[] = []
      const localeTables = new Map()
      const contributions = new Map<string,{options:import('../src/client.ts').SlotSpec;component:(props:{sessionId:string})=>unknown}[]>()
      const ctx:import('../src/client.ts').ClientContext = {
        locale: {
          register(namespace:string, copy) {
            localeTables.set(namespace, copy)
            return () => localeTables.delete(namespace)
          },
          bind: (namespace:string) => (key:string) => {
            const table = localeTables.get(namespace)
            return table?.zh?.[key] ?? `${namespace}.${key}`
          },
        },
        sidebarRightTabs: {
          register(definition:import('../src/client.ts').TabDefinition) {
            tabTypes.push(definition)
            return () => {}
          },
        },
        slots: {
          inject(name:string, callback:()=>unknown) { return callback() },
          register(options, component) {
            const list = contributions.get(options.name) ?? []
            list.push({ options, component })
            contributions.set(options.name, list)
            return () => {}
          },
        },
        effect(callback:()=>void|(()=>void|Promise<void>)) {
          const disposer = callback()
          effects.push(disposer)
          return disposer
        },
      }

      plugin.apply(ctx)

      // Locale: one namespace with matching key sets.
      assert.equal(localeTables.size, 1)
      const copy = localeTables.get('browserFlow')
      assert.notEqual(copy, undefined)
      assert.deepEqual(Object.keys(copy.zh).sort(), Object.keys(copy.en).sort())

      // Tab type: keyed by the package name, keepMounted, titled via locale.
      assert.equal(tabTypes.length, 1)
      assert.equal(tabTypes[0].id, '@negentropy/dsh-browser-flow')
      assert.equal(tabTypes[0].kind, 'browser-flow')
      assert.equal(tabTypes[0].keepMounted, true)
      assert.equal(tabTypes[0].title(), copy.zh.title)

      // Body and title seats, both keyed by the package name.
      const body = contributions.get('sidebar.right.pane.tab') ?? []
      const title = contributions.get('sidebar.right.pane.tab.title') ?? []
      assert.equal(body.length, 1)
      assert.equal(title.length, 1)
      assert.equal(body[0].options.key, '@negentropy/dsh-browser-flow')
      assert.equal(title[0].options.key, '@negentropy/dsh-browser-flow')
      assert.equal(body[0].options.locale, 'browserFlow')

      // The panel renders into the real document through real React.
      const container = window.document.getElementById('root')
      const reactRoot = reactDomClient.createRoot(container)
      reactRoot.render(React.createElement(body[0].component, { sessionId: 'session-1' }))
      await new Promise(resolve => setTimeout(resolve, 50))

      const section = container.querySelector('[data-browser-flow-panel]')
      assert.notEqual(section, null, 'the panel must render its root section')
      assert.notEqual(section.querySelector('[role="status"]'), null,
        'the panel must state the host limitation')
      assert.equal(section.querySelectorAll('[data-browser-flow-action="authorize"]').length, 0,
        'no authorize control may be offered where page programs cannot run')
      assert.notEqual(section.querySelector('[data-browser-flow-action="revoke"]'), null,
        'revoke must stay reachable so a stale authorization can be cleared')
      reactRoot.unmount()

      // Only platform modules were ever required, and every registration was an effect.
      for (const specifier of requested) {
        assert.ok(Object.hasOwn(platform, specifier), `unexpected require: ${specifier}`)
      }
      assert.equal(effects.length, 2)
      for (const disposer of effects) assert.equal(typeof disposer, 'function')
    } finally {
      globalThis.window = saved.window
      globalThis.document = saved.document
      Object.defineProperty(globalThis, 'navigator', { value: saved.navigator, configurable: true })
      window.close()
    }
  })
})
