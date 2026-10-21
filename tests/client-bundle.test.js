/**
 * Client bundle tests.
 *
 * The bundle is the artifact the browser actually loads, so these tests read
 * `lib/client.js` as data and assert the loader contract the Harness enforces:
 * one registration under the package name, a factory that returns an object
 * plugin, only platform-table `require`s, and no module-level side effects.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkBundle } from '../scripts/build-client.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')

describe('passive observer build exception',()=>{
  it('permits XHR only in the fixed observer module and preserves the credential ban',()=>{
    assert.ok(checkBundle(bundle).every(check=>check.ok))
    assert.equal(checkBundle(bundle+'\nXMLHttpRequest.prototype.send\n').find(check=>check.name.startsWith('XHR references')).ok,false)
    const injected=bundle.replace('// ---- src/import-page.js ----','// ---- src/import-page.js ----\ndocument.cookie\n')
    assert.equal(checkBundle(injected).find(check=>check.name==='page programs never read credentials or storage').ok,false)
  })
})

/** Evaluate the bundle in a fake loader and return the captured handoff. */
function loadBundle() {
  const handoffs = new Map()
  const sandbox = { window: { __ModuleLoader__: { load: handoff => handoffs.set(handoff.id, handoff) } } }
  // The bundle references `window` and `document` only inside the factory; a
  // plain function scope is enough to register it without a DOM.
  const evaluate = new Function('window', `${bundle}\nreturn window.__ModuleLoader__`)
  evaluate(sandbox.window)
  return handoffs
}

describe('client bundle registration', () => {
  it('registers exactly once, under the package name', () => {
    const handoffs = loadBundle()
    assert.deepEqual([...handoffs.keys()], [manifest.name])
  })

  it('returns an object plugin with inject and apply', () => {
    const handoffs = loadBundle()
    const plugin = handoffs.get(manifest.name).factory(specifier => {
      if (specifier === 'react') return { createElement: () => ({}) }
      throw new Error(`unexpected require ${specifier}`)
    })
    assert.equal(typeof plugin.apply, 'function')
    assert.ok(Array.isArray(plugin.inject))
    assert.deepEqual([...plugin.inject].sort(), ['locale', 'sidebarRightTabs', 'slots'])
  })

  it('requires only specifiers the frozen platform table answers', () => {
    const platform = new Set([
      'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
      'zod', '@tanstack/react-virtual',
      '@deepseek-ai/dsh-client-store',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-dockkit',
    ])
    const requires = [...bundle.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map(match => match[1])
    assert.ok(requires.length > 0)
    for (const specifier of requires) assert.ok(platform.has(specifier), `non-platform require: ${specifier}`)
  })

  it('performs no module-level DOM or network access', () => {
    const factoryStart = bundle.indexOf('factory(require)')
    const head = bundle.slice(0, factoryStart)
    assert.equal(/document\.|fetch\(|localStorage|sessionStorage/.test(head), false)
  })

  it('registers a guide entry, without which the tab never appears', () => {
    // The right sidebar seeds its default page from tabs.guide(); a type that
    // omits \guide\ stays off the guide page and is invisible in the UI.
    assert.ok(bundle.includes('guide:'), 'the tab definition must carry guide entries')
    assert.ok(bundle.includes('guideDescription'), 'the guide entry needs localized copy')
  })

  it('registers its UI through ctx.effect and ctx.slots.inject', () => {
    assert.ok((bundle.match(/ctx\.effect\(/g) ?? []).length >= 2)
    assert.ok((bundle.match(/ctx\.slots\.inject\(/g) ?? []).length >= 2)
    assert.ok(bundle.includes("'sidebar.right.pane.tab'"))
    assert.ok(bundle.includes("'sidebar.right.pane.tab.title'"))
    assert.ok(bundle.includes('ctx.sidebarRightTabs.register'))
  })

  it('carries no authorization bypass: the panel never sends an agent identity', () => {
    // The Host resolves the live Agent itself; the wire must not accept one.
    assert.equal(/agentInstanceToken|agentId:\s*sessionId/.test(bundle), false)
  })

  it('declares the desktop-only limitation instead of pretending to work in Web', () => {
    assert.ok(bundle.includes('dshDesktop'))
    assert.ok(bundle.includes('unsupportedHost'))
  })

  it('never creates a webview guest, because the main process only attaches approved leases', () => {
    // apps/desktop/src/browser-guests.ts installs `will-attach-webview` and calls
    // event.preventDefault() unless the guest's src is `about:blank#<lease>` with
    // a lease the main process issued to this window. A plugin-created guest is
    // therefore destroyed on attach. The panel must only *query* the guest the
    // shipped Browser already mounted.
    assert.equal(/createElement\(\s*['"]webview['"]/.test(bundle), false,
      'the panel must not create a webview element')
    assert.equal(bundle.includes('browser.acquire'), false,
      'the panel must not reserve a guest of its own')
    assert.equal(bundle.includes('appendChild'), false,
      'the panel must not attach a guest to the document')
    // It finds the existing one through the shipped marker.
    assert.ok(bundle.includes('querySelectorAll'))
    assert.ok(bundle.includes('webview[data-sidebar-browser-frame="webview"]'))
  })

  it('inlines the panel, page programs and client helpers it was built from', () => {
    // The build resolves the real import graph, so a missing module is a
    // missing function rather than a silent runtime miss.
    for (const marker of ['createPanel', 'identityProgram()', 'observeProgram(', 'findProgram(', 'actProgram(input)',
      'waitProgram(', 'WEBVIEW_SELECTOR', 'classifyResult', 'hostSupportsPageControl']) {
      assert.ok(bundle.includes(marker), `bundle must inline ${marker}`)
    }
    assert.equal(/^import\s|^export\s/m.test(bundle), false, 'no module syntax may survive')
  })

  it('applies against a realistic client context and registers its four contributions', () => {
    // This is the only path that executes `src/client.js`: the bundle's own
    // `apply`. It asserts the exact registrations the Harness slot system
    // requires, using a fake context with the same shape the shipped client
    // services expose.
    const handoffs = loadBundle()
    const React = { createElement: () => ({}) }
    const plugin = handoffs.get(manifest.name).factory(specifier => {
      if (specifier === 'react') return React
      throw new Error(`unexpected require ${specifier}`)
    })
    const effects = []
    const localeRegistrations = []
    const tabTypes = []
    const slotRegistrations = []
    const injections = []
    const ctx = {
      locale: {
        register: (namespace, copy) => { localeRegistrations.push({ namespace, copy }); return () => {} },
        bind: namespace => key => `${namespace}.${key}`,
      },
      sidebarRightTabs: {
        register: definition => { tabTypes.push(definition); return () => {} },
      },
      slots: {
        inject: (name, callback) => { injections.push(name); return callback() },
        register: (options, component) => { slotRegistrations.push({ options, component }); return () => {} },
      },
      effect: callback => {
        const disposer = callback()
        effects.push(disposer)
        return disposer
      },
    }
    plugin.apply(ctx)

    // Locale: one namespace, both languages, matching key sets.
    assert.equal(localeRegistrations.length, 1)
    assert.equal(localeRegistrations[0].namespace, 'browserFlow')
    assert.deepEqual(Object.keys(localeRegistrations[0].copy.zh).sort(), Object.keys(localeRegistrations[0].copy.en).sort())

    // Tab type: keyed by the package name, keepMounted, with a title.
    assert.equal(tabTypes.length, 1)
    assert.equal(tabTypes[0].id, manifest.name)
    assert.equal(tabTypes[0].kind, 'browser-flow')
    assert.equal(tabTypes[0].keepMounted, true)
    assert.equal(typeof tabTypes[0].title, 'function')

    // Body and title seats, both keyed by the same id.
    assert.deepEqual(injections.sort(), ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
    assert.equal(slotRegistrations.length, 2)
    for (const registration of slotRegistrations) {
      assert.equal(registration.options.key, manifest.name)
      assert.equal(typeof registration.component, 'function')
    }

    // Everything is an effect, so unloading removes the UI.
    assert.equal(effects.length, 2)
    for (const disposer of effects) assert.equal(typeof disposer, 'function')
  })
})

describe('package manifest and profile patch', () => {
  it('declares the bundle patch and the web client platform', () => {
    assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
    assert.deepEqual(manifest.bundleDependencies,['@deepseek-ai/dsh-atomic-write'])
    assert.equal(manifest.dsh.client.platform, 'web')
    assert.equal(manifest.exports['./client'], './lib/client.js')
  })

  it('inserts a bare package-name row with validated config', () => {
    assert.ok(patch.includes('name: "@negentropy/dsh-browser-flow"'))
    assert.ok(patch.includes('id: browser-flow'))
    for (const field of ['commandBudgetMs', 'observeMaxChars', 'observeMaxNodes', 'findMaxMatches', 'waitMaxMs', 'queueLimit', 'pollWaitMs', 'connectionIdleMs']) {
      assert.ok(patch.includes(`${field}:`), `patch must set ${field}`)
    }
  })

  it('ships every file the Host and Client entry points need', () => {
    for (const file of ['lib/client.js', 'src/index.js', 'cordis.patch.yml']) {
      assert.ok(manifest.files.some(entry => file.startsWith(entry)), `${file} must be published`)
    }
  })
})
