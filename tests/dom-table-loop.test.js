import { throughPage } from './helpers/through-page.js'
import { bindTestTask } from './helpers/bind-task.js'
/**
 * The six tools driven in order against a real DOM table.
 *
 * The other tests check the tools' failure paths and the page programs in
 * isolation. This one drives the sequence — locate a cell, edit it,
 * save it, re-read it — through the **real tool layer** and the **real shipped
 * page programs**, executing in a real DOM (jsdom) with a real editable table.
 *
 * It runs the whole round trip in one process:
 *
 *   browser_tabs → browser_observe → browser_find → browser_act → (page save)
 *   → browser_observe (re-read)
 *
 * The page's "save" is a DOM event handler on a real button, so a successful
 * re-read proves the value reached the page rather than a local variable.
 *
 * It skips, with a printed reason, when jsdom is unavailable.
 */

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BrowserFlowService } from '../src/index.js'
import { resolveConfig } from '../src/config.js'
import { actProgram, findProgram, identityProgram, observeProgram, waitProgram } from '../src/pagecode.js'

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

const jsdomEntry = resolveDependency('jsdom')

/**
 * Read a package's declared entry point.
 * @param {string} packageDir - package directory.
 * @returns {string} absolute entry file.
 */
function entryOf(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  return join(packageDir, typeof manifest.main === 'string' ? manifest.main : 'index.js')
}

/**
 * Build a fake Host context with one live Agent and a captured route table.
 * @param {object} agent - the live Agent object.
 * @returns {object} fake context and captures.
 */
function host(agent) {
  const routes = new Map()
  const tools = new Map()
  const connection = {
    fetch: {
      register(route) {
        routes.set(`${route.methods.join(',')} ${route.path}`, route)
        return () => routes.delete(`${route.methods.join(',')} ${route.path}`)
      },
    },
  }
  const ctx = {
    agents: { get: id => (id === agent.id ? agent : undefined) },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    inject(deps, callback) {
      const scope = Object.create(ctx)
      for (const dependency of deps) scope[dependency] = ctx.get(dependency)
      return callback(scope)
    },
    get: key => (key === 'connection' ? connection : undefined),
    effect(callback) {
      const disposer = callback()
      ctx.effects.push(disposer)
      return disposer
    },
    logger: { info() {}, warn() {}, error() {} },
    effects: [],
  }
  return { ctx, routes, tools }
}

/** POST one JSON body to a captured route. */
async function call(route, body) {
  const response = await route.fetch(new Request(`http://127.0.0.1:62231${route.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { protocolVersion: 3, ...body } : body),
  }))
  return { status: response.status, body: await response.json() }
}

/**
 * Answer every command the panel would poll for by executing the fixed page
 * program in the jsdom realm. This stands in for the panel's command loop, so
 * the tools talk to the real page through the real protocol.
 * @param {object} input - wiring.
 * @returns {Promise<void>}
 */
async function pump({ routes, window, pages, sessionId }) {
  const pollRoute = routes.get('POST /api/browser-flow/poll')
  const resultRoute = routes.get('POST /api/browser-flow/result')
  const poll = await call(pollRoute, {
    instanceId: 'panel-1', connectionGeneration: 1, sessionId, pages,
  })
  assert.equal(poll.status, 200, `poll failed: ${JSON.stringify(poll.body)}`)
  for (const command of poll.body.value.commands) {
    const result = await executeInPage({ window, op: command.op })
    await call(resultRoute, {
      kind: 'result',task:command.task, instanceId: 'panel-1', id: command.id, leaseId: command.leaseId,
      connectionGeneration: command.connectionGeneration,
      epoch: command.epoch, sequence: command.sequence, ...result,
    })
  }
}

/**
 * Run one operation's fixed program in the page realm.
 * @param {object} input - wiring.
 * @returns {Promise<object>} classified outcome.
 */
async function executeInPage({ window, op }) {
  let source
  if (op.kind === 'observe') source = observeProgram(op.maxChars, op.maxNodes)
  else if (op.kind === 'find') source = findProgram(op.query, op.limit)
  else if (op.kind === 'act') {
    source = actProgram({
      documentToken: op.target.documentToken,
      elementRef: op.target.elementRef,
      action: op.action,
      ...(op.value === undefined ? {} : { value: op.value }),
      ...(op.checked === undefined ? {} : { checked: op.checked }),
    })
  } else if (op.kind === 'wait') {
    source = waitProgram({
      condition: op.condition,
      target: op.target,
      timeoutMs: op.timeoutMs,
      ...(op.text === undefined ? {} : { text: op.text }),
    })
  } else {
    return { outcome: 'failed', error: { code: 'unsupported', message: `unsupported op ${op.kind}` } }
  }
  // The page programs run inside the jsdom realm, exactly as executeJavaScript
  // would run them in the guest.
  const value = new window.Function(`return (${source})`)()
  if (value === null || value === undefined) {
    return { outcome: 'unknown_outcome', error: { code: 'unknown_outcome', message: 'no result' } }
  }
  if (value.ok !== true) {
    return {
      outcome: 'failed',
      error: {
        code: typeof value.error?.code === 'string' ? value.error.code : 'internal',
        message: typeof value.error?.message === 'string' ? value.error.message : 'page failure',
      },
    }
  }
  return { outcome: 'ok', payload: value.value }
}

/** Build the wait program for one operation. */
function waitProgramOf(op) {
  return waitProgram({
    condition: op.condition,
    target: op.target,
    timeoutMs: op.timeoutMs,
    ...(op.text === undefined ? {} : { text: op.text }),
  })
}

const tableHtml = `<!doctype html><html><body>
<h1>Inventory</h1>
<table id="inv">
  <thead><tr><th>Item</th><th>Qty</th><th>Note</th></tr></thead>
  <tbody>
    <tr><td>Bolts</td><td><input id="q-bolts" value="10"></td><td>box</td></tr>
    <tr><td>Nuts</td><td><input id="q-nuts" value="20"></td><td>bag</td></tr>
  </tbody>
</table>
<button id="save">Save</button>
<p id="status">unsaved</p>
<script>
  document.getElementById('save').addEventListener('click', () => {
    const values = [...document.querySelectorAll('#inv input')].map(input => input.value)
    document.getElementById('status').textContent = 'saved:' + values.join(',')
  })
</script>
</body></html>`

describe('six-tool DOM table closed loop', { skip: jsdomEntry === undefined ? 'jsdom is unavailable' : false }, () => {
  it('locates a cell, edits it, saves, and re-reads the saved value', async () => {
    const { JSDOM } = await import(pathToFileURL(entryOf(jsdomEntry)).href)
    const dom = new JSDOM(tableHtml, { url: 'https://sample.test/inventory', runScripts: 'dangerously' })
    const window = dom.window
    // jsdom has no layout engine, so `getBoundingClientRect` reports a zero-size
    // box and the shipped visibility check would reject every element. Supply a
    // layout box for elements the page does not hide, which is what a real
    // renderer would report for this markup.
    window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const hidden = this.closest('[hidden]') !== null
      const width = hidden ? 0 : 100
      const height = hidden ? 0 : 20
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }
    }
    // The page programs reach the page's document through the global scope, so
    // install the realm's globals for the duration of the test.
    const saved = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle }
    globalThis.document = window.document
    globalThis.window = window
    globalThis.getComputedStyle = window.getComputedStyle.bind(window)

    try {
      const agent = { id: 'session-1', session: { id: 'session-1' } }
      const fake = host(agent)
      const service = new BrowserFlowService(fake.ctx, resolveConfig({}))
      service.start()

      // The panel announces the page it can see and gets authorization.
      const identity = new window.Function(`return (${identityProgram()})`)()
      assert.equal(identity.ok, true, 'the identity program must run in the page')
      const pages = [{
        lease: 'guest-1', partition: 'part-1',
        url: identity.value.url, documentToken: identity.value.documentToken, tabId: 'tab-1',
      }]
      const hello = await call(fake.routes.get('POST /api/browser-flow/hello'), {
        kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: agent.id,
        panel: { instanceId: 'panel-1', pages },
      })
      assert.equal(hello.status, 200)
      await bindTestTask(service,agent.id,[new URL(pages[0].url).origin])
      const authorized = await call(fake.routes.get('POST /api/browser-flow/authorize'), {
        instanceId: 'panel-1', connectionGeneration: 1, sessionId: agent.id,
        lease: 'guest-1', partition: 'part-1',
        documentToken: identity.value.documentToken, tabId: 'tab-1',
      })
      assert.equal(authorized.status, 200, `authorize failed: ${JSON.stringify(authorized.body)}`)

      /** Invoke one tool and pump the channel until it answers. */
      const invoke = async (toolName, args) => {
        const tool = fake.tools.get(toolName)
      return throughPage(service,()=>tool.execute(args,{agent,signal:new AbortController().signal}),()=>pump({routes:fake.routes,window,pages,sessionId:agent.id}))
      }

      // 1. browser_tabs lists the authorized page without leaking the token.
      const tabs = await fake.tools.get('browser_tabs').execute({}, { agent, signal: new AbortController().signal })
      assert.equal(tabs.ok, true)
      assert.equal(tabs.value.pages.length, 1)
      assert.equal(tabs.value.pages[0].authorized, true)

      // 2. browser_observe reads the table and yields element references.
      const observed = await invoke('browser_observe', {})
      assert.equal(observed.ok, true, `observe failed: ${JSON.stringify(observed.error)}`)
      assert.ok(observed.value.text.includes('Bolts'), 'the observation must contain the table text')
      // The cell value is structured, not prose: inputs carry a `value` field.
      const quantityNode = observed.value.nodes.find(node => node.label === 'q-bolts' || node.value === '10')
      assert.notEqual(quantityNode, undefined, `the observation must describe the quantity input, saw: ${JSON.stringify(observed.value.nodes.slice(0, 5))}`)
      assert.equal(quantityNode.value, '10', 'the observation must report the current cell value')

      // 3. browser_find locates the quantity input for Bolts. A single match is
      // returned directly; several matches would be ambiguous_match instead.
      const found = await invoke('browser_find', { by: 'attr', name: 'id', value: 'q-bolts' })
      assert.equal(found.ok, true, `find failed: ${JSON.stringify(found.error)}`)
      const target = found.value.match
      assert.equal(typeof target.elementRef, 'string')
      assert.equal(target.elementRef.startsWith('el-'), true)

      // 4. browser_act replaces the value in that cell.
      const acted = await invoke('browser_act', {
        documentToken: found.value.documentToken,
        elementRef: target.elementRef,
        action: 'type',
        value: '42',
      })
      assert.equal(acted.ok, true, `act failed: ${JSON.stringify(acted.error)}`)
      assert.equal(window.document.getElementById('q-bolts').value, '42',
        'the page must hold the new value after the action')

      // 5. Save: the page's own button runs its real handler.
      const saveTarget = await invoke('browser_find', { by: 'attr', name: 'id', value: 'save' })
      assert.equal(saveTarget.ok, true, `save find failed: ${JSON.stringify(saveTarget.error)}`)
      const saved2 = await invoke('browser_act', {
        documentToken: saveTarget.value.documentToken,
        elementRef: saveTarget.value.match.elementRef,
        action: 'click',
      })
      assert.equal(saved2.ok, true, `save click failed: ${JSON.stringify(saved2.error)}`)
      assert.equal(window.document.getElementById('status').textContent, 'saved:42,20',
        'the page handler must observe the edited value')

      // 6. Re-read: the saved state is visible through a fresh observation.
      const reread = await invoke('browser_observe', {})
      assert.equal(reread.ok, true, `re-read failed: ${JSON.stringify(reread.error)}`)
      assert.ok(reread.value.text.includes('saved:42,20'),
        `the re-read must show the saved state, saw: ${reread.value.text.slice(0, 300)}`)

      // 7. Release detaches control but leaves the page intact and usable.
      const released = await fake.tools.get('browser_release').execute({}, { agent, signal: new AbortController().signal })
      assert.equal(released.ok, true)
      assert.equal(window.document.getElementById('q-bolts').value, '42', 'release must not touch the page')
      assert.equal(window.document.getElementById('status').textContent, 'saved:42,20')
      // The page still works for the user after release.
      window.document.getElementById('save').click()
      assert.equal(window.document.getElementById('status').textContent, 'saved:42,20')

      // A tool after release is refused.
      const afterRelease = await fake.tools.get('browser_observe').execute({}, { agent, signal: new AbortController().signal })
      assert.equal(afterRelease.ok, false)
      assert.equal(afterRelease.error.code, 'not_authorized')
    } finally {
      globalThis.document = saved.document
      globalThis.window = saved.window
      globalThis.getComputedStyle = saved.getComputedStyle
      window.close()
    }
  })
})
