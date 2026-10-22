import { resolveDependency, entryOf, host, call, pump } from './helpers/dom-host.ts'
import {fixtureProgram} from './helpers/fixture-program.ts'
import {expectRecord,present,expectSized,expectList,expectString} from './helpers/assertions.ts'
import {hostPort} from './helpers/ports.ts'
import { throughPage } from './helpers/through-page.ts'
import { bindTestTask } from './helpers/bind-task.ts'
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
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BrowserFlowService } from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'
import { identityProgram, waitProgram } from '../src/pagecode.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = process.env.DSH_CHECKOUT ?? join(root, '..', 'deepseek-harness')

const jsdomEntry = resolveDependency(checkout, 'jsdom')

/** Build the wait program for one operation. */
function waitProgramOf(op:import('../src/page/types.ts').PageWaitInput) {
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
<!-- browser-flow fixture script -->
</body></html>`

describe('six-tool DOM table closed loop', { skip: jsdomEntry === undefined ? 'jsdom is unavailable' : false }, () => {
  it('locates a cell, edits it, saves, and re-reads the saved value', async () => {
    const { JSDOM } = await import(pathToFileURL(entryOf(present(jsdomEntry))).href)
    const dom = new JSDOM(tableHtml.replace('<!-- browser-flow fixture script -->',`<script>${fixtureProgram('installTableLoop')}</script>`), { url: 'https://sample.test/inventory', runScripts: 'dangerously' })
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
      const service = new BrowserFlowService(hostPort(fake.ctx), resolveConfig({}))
      service.start()

      // The panel announces the page it can see and gets authorization.
      const identity = new window.Function(`return (${identityProgram()})`)()
      assert.equal(identity.ok, true, 'the identity program must run in the page')
      const pages = [{
        lease: 'guest-1', partition: 'part-1',
        url: identity.value.url, documentToken: identity.value.documentToken, tabId: 'tab-1',
      }]
      const hello = await call(present(fake.routes.get('POST /api/browser-flow/hello')), {
        kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: agent.id,
        panel: { instanceId: 'panel-1', pages },
      })
      assert.equal(hello.status, 200)
      await bindTestTask(service,agent.id,[new URL(pages[0].url).origin])
      const authorized = await call(present(fake.routes.get('POST /api/browser-flow/authorize')), {
        instanceId: 'panel-1', connectionGeneration: 1, sessionId: agent.id,
        lease: 'guest-1', partition: 'part-1',
        documentToken: identity.value.documentToken, tabId: 'tab-1',
      })
      assert.equal(authorized.status, 200, `authorize failed: ${JSON.stringify(authorized.body)}`)

      /** Invoke one tool and pump the channel until it answers. */
      const invoke = async (toolName:string, args:Record<string,unknown>) => {
        const tool = fake.tools.get(toolName)
      return throughPage(service,()=>present(tool).execute(args,{agent,signal:new AbortController().signal}),()=>pump({routes:fake.routes,window,pages,sessionId:agent.id}))
      }

      // 1. browser_tabs lists the authorized page without leaking the token.
      const tabs = await present(fake.tools.get('browser_tabs')).execute({}, { agent, signal: new AbortController().signal })
      assert.equal(tabs.ok, true)
      assert.equal(expectSized(expectRecord(tabs.value).pages).length, 1)
      assert.equal(expectRecord(expectList(expectRecord(tabs.value).pages)[0]).authorized, true)

      // 2. browser_observe reads the table and yields element references.
      const observed = await invoke('browser_observe', {})
      assert.equal(expectRecord(observed).ok, true, `observe failed: ${JSON.stringify(expectRecord(observed).error)}`)
      assert.ok(expectString(expectRecord(expectRecord(observed).value).text).includes('Bolts'), 'the observation must contain the table text')
      // The cell value is structured, not prose: inputs carry a `value` field.
      const quantityNode = expectList(expectRecord(expectRecord(observed).value).nodes).find((node) => expectRecord(node).label === 'q-bolts' || expectRecord(node).value === '10')
      assert.notEqual(quantityNode, undefined, `the observation must describe the quantity input, saw: ${JSON.stringify(expectList(expectRecord(expectRecord(observed).value).nodes).slice(0, 5))}`)
      assert.equal(expectRecord(quantityNode).value, '10', 'the observation must report the current cell value')

      // 3. browser_find locates the quantity input for Bolts. A single match is
      // returned directly; several matches would be ambiguous_match instead.
      const found = await invoke('browser_find', { by: 'attr', name: 'id', value: 'q-bolts' })
      assert.equal(expectRecord(found).ok, true, `find failed: ${JSON.stringify(expectRecord(found).error)}`)
      const target = expectRecord(expectRecord(found).value).match
      assert.equal(typeof expectRecord(target).elementRef, 'string')
      assert.equal(expectString(expectRecord(target).elementRef).startsWith('el-'), true)

      // 4. browser_act replaces the value in that cell.
      const acted = await invoke('browser_act', {
        documentToken: expectRecord(expectRecord(found).value).documentToken,
        elementRef: expectRecord(target).elementRef,
        action: 'type',
        value: '42',
      })
      assert.equal(expectRecord(acted).ok, true, `act failed: ${JSON.stringify(expectRecord(acted).error)}`)
      assert.equal(window.document.getElementById('q-bolts').value, '42',
        'the page must hold the new value after the action')

      // 5. Save: the page's own button runs its real handler.
      const saveTarget = await invoke('browser_find', { by: 'attr', name: 'id', value: 'save' })
      assert.equal(expectRecord(saveTarget).ok, true, `save find failed: ${JSON.stringify(expectRecord(saveTarget).error)}`)
      const saved2 = await invoke('browser_act', {
        documentToken: expectRecord(expectRecord(saveTarget).value).documentToken,
        elementRef: expectRecord(expectRecord(expectRecord(saveTarget).value).match).elementRef,
        action: 'click',
      })
      assert.equal(expectRecord(saved2).ok, true, `save click failed: ${JSON.stringify(expectRecord(saved2).error)}`)
      assert.equal(window.document.getElementById('status').textContent, 'saved:42,20',
        'the page handler must observe the edited value')

      // 6. Re-read: the saved state is visible through a fresh observation.
      const reread = await invoke('browser_observe', {})
      assert.equal(expectRecord(reread).ok, true, `re-read failed: ${JSON.stringify(expectRecord(reread).error)}`)
      assert.ok(expectString(expectRecord(expectRecord(reread).value).text).includes('saved:42,20'),
        `the re-read must show the saved state, saw: ${expectString(expectRecord(expectRecord(reread).value).text).slice(0, 300)}`)

      // 7. Release detaches control but leaves the page intact and usable.
      const released = await present(fake.tools.get('browser_release')).execute({}, { agent, signal: new AbortController().signal })
      assert.equal(released.ok, true)
      assert.equal(window.document.getElementById('q-bolts').value, '42', 'release must not touch the page')
      assert.equal(window.document.getElementById('status').textContent, 'saved:42,20')
      // The page still works for the user after release.
      window.document.getElementById('save').click()
      assert.equal(window.document.getElementById('status').textContent, 'saved:42,20')

      // A tool after release is refused.
      const afterRelease = await present(fake.tools.get('browser_observe')).execute({}, { agent, signal: new AbortController().signal })
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
