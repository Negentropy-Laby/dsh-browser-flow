import { TASK, TASK_VIEW } from './helpers/task-scope.js'
/**
 * The panel's full round trip in a real DOM.
 *
 * `client-runtime.test.js` stops at rendering. This continues through the part
 * the review found broken: authorize a page, receive a dispatched command on a
 * poll, execute it against the guest, and report the result. The bundle, React,
 * the DOM, the slot registry and the wire payloads are all real; only the page
 * programs and the Host's HTTP answers are supplied by the test.
 *
 * Nothing here replaces Desktop acceptance — it proves the client half does what
 * the protocol says, which is what a human-driven run cannot localise when it
 * fails.
 */

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = process.env.DSH_CHECKOUT ?? join(root, '..', 'deepseek-harness')

/**
 * Resolve one dependency the way pnpm lays it out.
 * @param {string} name - package name.
 * @returns {string | undefined} absolute package directory.
 */
function resolveDependency(name) {
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
 * Read a package's declared entry point.
 * @param {string} packageDir - package directory.
 * @returns {string} absolute entry file.
 */
function entryOf(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  return join(packageDir, typeof manifest.main === 'string' ? manifest.main : 'index.js')
}

const reactEntry = resolveDependency('react')
const reactDomEntry = resolveDependency('react-dom')
const jsdomEntry = resolveDependency('jsdom')
const missing = []
if (reactEntry === undefined) missing.push('react')
if (reactDomEntry === undefined) missing.push('react-dom')
if (jsdomEntry === undefined) missing.push('jsdom')
const ready = missing.length === 0

describe('panel round trip in a real DOM', { skip: ready ? false : `missing DOM deps: ${missing.join(', ')}` }, () => {
  it('authorizes a page and runs the command the Host dispatches', async () => {
    const { JSDOM } = await import(pathToFileURL(entryOf(jsdomEntry)).href)
    const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

    const dom = new JSDOM(`<!doctype html><html><body>
      <div data-sidebar-right-session="session-1">
        <div data-sidebar-right-tab="tab-1">
          <webview name="guest-1" partition="persist:one" data-sidebar-browser-frame="webview"></webview>
        </div>
      </div>
      <div id="root"></div>
    </body></html>`, { url: 'http://127.0.0.1:1/', pretendToBeVisual: true })
    const window = dom.window

    // The panel drives itself from a timer; the test decides when a tick runs.
    const ticks = []

    /** Every page program the panel asked the guest to run. */
    const executed = []
    const guest = window.document.querySelector('webview')
    /** What the guest currently shows; a navigation replaces this whole object. */
    let document_ = { url: 'https://a.test/sheet', documentToken: 'doc-1' }
    // One answer satisfies both the identity read and the observation payload.
    guest.executeJavaScript = async program => {
      executed.push(program)
      return {
        ok: true,
        value: {
          url: document_.url, title: 'Sample sheet', documentToken: document_.documentToken,
          readyState: 'complete', nodes: [], text: '', truncated: false,
        },
      }
    }


    /** Answers the panel receives, and the requests it made. */
    const sent = []
    let pendingCommands = []
    let invalidateFails = false
    window.fetch = async (route, init) => {
      const body = JSON.parse(init.body)
      sent.push({ route, body })
      if (route === '/api/browser-flow/poll') {
        const answer = {
          ok: true,
          value: { protocolVersion: 3, task:TASK_VIEW, commands: pendingCommands, dropped: [], agent: { id: 'session-1', instance: 'a1b2c3d4' } },
        }
        pendingCommands = []
        return { json: async () => answer }
      }
      if (route === '/api/browser-flow/authorize') {
        return {
          json: async () => ({
            ok: true,
            value: {task:TASK,origins:['https://a.test'],controlLeaseId: 'lease-1', epoch: 0, documentToken: 'doc-1',
              sessionId: 'session-1', tabId: 'tab-1', nextSequence: 0,
            },
          }),
        }
      }
      if (route === '/api/browser-flow/invalidate') {
        if (invalidateFails) throw new Error('the channel is gone')
        const event = body.event
        const keep = event === 'same_origin_navigation' || event === 'document_replaced'
        return {
          json: async () => ({
            ok: true,
            value: { affected: [keep
              ? { controlLeaseId: 'lease-1', state: 'active', epoch: 1 }
              : { controlLeaseId: 'lease-1', state: 'revoked', epoch: 1 }] },
          }),
        }
      }
      if (route === '/api/browser-flow/result') return { json: async () => ({ ok: true, value: {} }) }
      return { json: async () => ({ ok: false, error: { code: 'internal', message: 'unexpected route ' + route } }) }
    }

    // jsdom does not create a separate V8 realm: `window.Function` is the host
    // `Function`, so the bundle's free variables resolve against this global
    // object. The carrier and fetch therefore belong here, not on `window`.
    const saved = {
      window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator,
      dshDesktop: globalThis.dshDesktop, fetch: globalThis.fetch,
      setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    }
    globalThis.window = window
    globalThis.document = window.document
    globalThis.dshDesktop = { protocolVersion: 1, browser: {} }
    globalThis.fetch = window.fetch
    globalThis.setInterval = callback => { ticks.push(callback); return ticks.length }
    globalThis.clearInterval = () => {}
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })

    let reactRoot
    try {
      const react = await import(pathToFileURL(entryOf(reactEntry)).href)
      const reactDomClient = await import(pathToFileURL(join(reactDomEntry, 'client.js')).href)
      const reactDomMain = await import(pathToFileURL(entryOf(reactDomEntry)).href)
      const React = react.default ?? react

      const factories = new Map()
      window.__ModuleLoader__ = { load(registration) { factories.set(registration.id, registration.factory) } }
      const platform = {
        react: React,
        'react-dom': reactDomMain.default ?? reactDomMain,
        'react-dom/client': reactDomClient,
      }
      const requireFromPlatform = specifier => {
        if (!Object.hasOwn(platform, specifier)) throw new Error(`non-platform module: ${specifier}`)
        return platform[specifier]
      }
      new window.Function('require', bundle)(requireFromPlatform)
      const [, factory] = [...factories.entries()][0]
      const plugin = factory(requireFromPlatform)

      const contributions = new Map()
      const localeTables = new Map()
      const ctx = {
        locale: {
          register(namespace, copy) { localeTables.set(namespace, copy); return () => {} },
          bind: namespace => key => localeTables.get(namespace)?.en?.[key] ?? key,
        },
        sidebarRightTabs: { register() { return () => {} } },
        slots: {
          inject(_name, callback) { return callback() },
          register(options, component) {
            contributions.set(options.name, component)
            return () => {}
          },
        },
        effect(callback) { return callback() },
      }
      plugin.apply(ctx)

      const Panel = contributions.get('sidebar.right.pane.tab')
      const container = window.document.getElementById('root')
      reactRoot = reactDomClient.createRoot(container)
      reactRoot.render(React.createElement(Panel, { sessionId: 'session-1' }))

      /** Let React commit and the async tick settle. */
      const settle = async () => {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      }
      await settle()

      // The page discovery ran and the panel offered the page.
      // The user must be able to see which Session and Agent instance the grant
      // attaches to before granting it (§6.1).
      const target = container.querySelector('[data-browser-flow-target]')
      assert.notEqual(target, null, 'the panel must name the authorization target')
      assert.equal(target.textContent.includes('session-1'), true, `the Session must be shown: ${target.textContent}`)
      assert.equal(target.textContent.includes('a1b2c3d4'), true, `the Agent instance must be shown: ${target.textContent}`)

      const authorizeButton = () => container.querySelector('[data-browser-flow-action="authorize"]')
      assert.notEqual(authorizeButton(), null, 'the discovered page must be offered for authorization; DOM: ' + container.innerHTML.slice(0, 800))
      assert.equal(sent.filter(entry => entry.route === '/api/browser-flow/poll').length > 0, true, 'the panel must poll')

      authorizeButton().click()
      await settle()
      const authorizeRequest = sent.find(entry => entry.route === '/api/browser-flow/authorize')
      assert.notEqual(authorizeRequest, undefined, 'authorization must be requested')
      assert.equal(authorizeRequest.body.instanceId.length > 0, true)
      assert.equal(authorizeRequest.body.documentToken, 'doc-1')

      // The identity program the panel runs to discover and to re-check the
      // document. Every tick starts with it, so it is not a command acting on
      // the page.
      const identitySource = executed[0]
      assert.equal(typeof identitySource, 'string', 'the panel must have read the identity while discovering')

      // The Host dispatches one observation. The panel must execute it and answer.
      executed.length = 0
      pendingCommands = [{
        id: 'cmd-1', protocolVersion:3,task:TASK, leaseId: 'lease-1', connectionGeneration: 1,
        epoch: 0, sequence: 0, budgetMs: 10000, deadlineAt: 0,
        op: { kind: 'observe', maxChars: 1000, maxNodes: 50 },
      }]
      for (const tick of [...ticks]) await tick()
      await settle()

      assert.equal(executed.length >= 2, true, 'the panel must read the identity and then run the operation; executed=' + String(executed.length) + ' routes=' + sent.map(entry => entry.route).join(',') + ' results=' + JSON.stringify(sent.filter(entry => entry.route.endsWith('/result')).map(entry => entry.body)))
      const resultRequest = sent.find(entry => entry.route === '/api/browser-flow/result')
      assert.notEqual(resultRequest, undefined, 'the panel must report the result')
      assert.equal(resultRequest.body.kind, 'result')
      assert.equal(resultRequest.body.id, 'cmd-1')
      assert.equal(resultRequest.body.leaseId, 'lease-1')
      assert.equal(resultRequest.body.epoch, 0)
      assert.equal(resultRequest.body.sequence, 0)
      assert.equal(resultRequest.body.outcome, 'ok')
      assert.equal(resultRequest.body.instanceId, authorizeRequest.body.instanceId,
        'the result must name the panel instance that produced it')

      // A command for another lease must never be executed by this panel.
      executed.length = 0
      pendingCommands = [{
        id: 'cmd-2', protocolVersion:3,task:TASK, leaseId: 'lease-9', connectionGeneration: 1,
        epoch: 0, sequence: 1, budgetMs: 10000, deadlineAt: 0,
        op: { kind: 'observe', maxChars: 1000, maxNodes: 50 },
      }]
      for (const tick of [...ticks]) await tick()
      await settle()
      const stolen = sent.find(entry => entry.route === '/api/browser-flow/result' && entry.body.id === 'cmd-2')
      assert.notEqual(stolen, undefined, 'the panel answers even a command it refuses')
      assert.equal(stolen.body.outcome, 'failed')
      assert.equal(stolen.body.error.code, 'not_authorized', 'a command for another authorization is refused')
      const ranAnOperation = executed.filter(program => program !== identitySource)
      assert.equal(ranAnOperation.length, 0, 'a refused command must never run a page operation')
      // §6.1: replacing the guest element ends the grant even though the name is
      // reused. The panel binds the element instance, so a same-named newcomer
      // must not inherit the authorization.
      const replacement = window.document.createElement('webview')
      replacement.setAttribute('name', 'guest-1')
      replacement.setAttribute('partition', 'persist:one')
      replacement.setAttribute('data-sidebar-browser-frame', 'webview')
      replacement.executeJavaScript = guest.executeJavaScript
      guest.parentNode.replaceChild(replacement, guest)
      for (const tick of [...ticks]) await tick()
      await settle()
      const replaced = sent.filter(entry => entry.route === '/api/browser-flow/invalidate' && entry.body.event === 'page_replaced')
      assert.equal(replaced.length, 1, 'a replaced guest must be reported as page_replaced')

      // Authorize the new element so the navigation checks below run against a
      // live grant.
      const reauthorize = container.querySelector('[data-browser-flow-action="authorize"]')
      assert.notEqual(reauthorize, null, 'the replacement must be offered for authorization')
      reauthorize.click()
      await settle()
      // §6.3: a same-origin reload keeps the grant. The panel must report the
      // change, follow the Host's "keep" verdict, and keep working under the new
      // epoch instead of demanding a fresh authorization.
      document_ = { url: 'https://a.test/sheet?v=2', documentToken: 'doc-2' }
      for (const tick of [...ticks]) await tick()
      await settle()
      const reported = sent.filter(entry => entry.route === '/api/browser-flow/invalidate' && entry.body.event === 'same_origin_navigation')
      assert.equal(reported.length, 1, 'the panel must report the document change as same-origin')
      assert.equal(container.querySelector('[data-browser-flow-action="revoke"]') !== null, true, 'the panel still offers control')

      pendingCommands = [{
        id: 'cmd-3', protocolVersion:3,task:TASK, leaseId: 'lease-1', connectionGeneration: 1,
        // The re-authorization restarted the panel's sequence counter, and the
        // same-origin invalidation advanced the epoch it must present.
        epoch: 1, sequence: 0, budgetMs: 10000, deadlineAt: 0,
        op: { kind: 'observe', maxChars: 1000, maxNodes: 50 },
      }]
      for (const tick of [...ticks]) await tick()
      await settle()
      const afterReload = sent.find(entry => entry.route === '/api/browser-flow/result' && entry.body.id === 'cmd-3')
      assert.notEqual(afterReload, undefined, 'a command under the new epoch must be answered')
      assert.equal(afterReload.body.outcome, 'ok', 'the retained grant still works after a same-origin reload')

      // §6.3: if the panel cannot reach the Host to report the change, it cannot
      // prove control survived, so it must stop using it rather than assume.
      invalidateFails = true
      document_ = { url: 'https://a.test/sheet?v=3', documentToken: 'doc-4' }
      for (const tick of [...ticks]) await tick()
      await settle()
      pendingCommands = [{
        id: 'cmd-4', protocolVersion:3,task:TASK, leaseId: 'lease-1', connectionGeneration: 1,
        epoch: 1, sequence: 0, budgetMs: 10000, deadlineAt: 0,
        op: { kind: 'observe', maxChars: 1000, maxNodes: 50 },
      }]
      for (const tick of [...ticks]) await tick()
      await settle()
      const afterFailure = sent.find(entry => entry.route === '/api/browser-flow/result' && entry.body.id === 'cmd-4')
      assert.notEqual(afterFailure, undefined, 'the panel still answers the command')
      assert.equal(afterFailure.body.outcome, 'failed')
      assert.equal(afterFailure.body.error.code, 'not_authorized',
        'a panel that cannot report the change must stop using the grant')
      invalidateFails = false
      container.querySelector('[data-browser-flow-action="authorize"]').click()
      await settle()
      // §6.3: a cross-origin navigation ends it.
      document_ = { url: 'https://b.test/other', documentToken: 'doc-3' }
      for (const tick of [...ticks]) await tick()
      await settle()
      const navEvents = sent
        .filter(entry => entry.route === '/api/browser-flow/invalidate' && entry.body.event.endsWith('navigation'))
        .map(entry => entry.body.event)
      // Two same-origin changes were reported (the second attempt could not be
      // delivered), then the cross-origin one.
      assert.deepEqual(navEvents, ['same_origin_navigation', 'same_origin_navigation', 'cross_origin_navigation'])    } finally {
      if (reactRoot !== undefined) reactRoot.unmount()
      globalThis.window = saved.window
      globalThis.document = saved.document
      globalThis.dshDesktop = saved.dshDesktop
      globalThis.fetch = saved.fetch
      globalThis.setInterval = saved.setInterval
      globalThis.clearInterval = saved.clearInterval
      Object.defineProperty(globalThis, 'navigator', { value: saved.navigator, configurable: true })
      window.close()
    }
  })
})