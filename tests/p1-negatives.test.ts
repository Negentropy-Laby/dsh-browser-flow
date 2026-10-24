import {expectOk,expectRecord,present,expectSized,expectList} from './helpers/assertions.ts'
import {hostPort} from './helpers/ports.ts'
import { bindTestTask } from './helpers/bind-task.ts'
/**
 * Negative cases for the P1 findings.
 *
 * Each of these is a counterexample the earlier tests could not express: a
 * multi-page panel, a command the panel took but never answered, and a stale
 * element reference after a second observation.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BrowserFlowService } from '../src/index.ts'
import { createControlState } from '../src/state.ts'
import { resolveConfig } from '../src/config.ts'

/**
 * Build the service over a fake Cordis context with a captured route table.
 * @returns {object} harness.
 */
function makeHost() {
  const agents = new Map([['session-1', { id: 'session-1', session: { id: 'session-1' } }]])
  const routes = new Map<string,import('../src/index.ts').FetchRoute>()
  const tools = new Map<string,import('../src/tools.ts').ToolDefinition>()
  const connection = {
    fetch: {
      register(route:import('../src/index.ts').FetchRoute) {
        const key = route.methods.join(',') + ' ' + route.path
        routes.set(key, route)
        return () => routes.delete(key)
      },
    },
  }
  const ctx = {
    effects: [] as (void|(()=>void|Promise<void>))[],
    agents: { get: (id:string) => agents.get(id) },
    tools: { register(definition:import('../src/tools.ts').ToolDefinition) { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    inject(deps:string[], callback:(scope:import('../src/index.ts').HostContext)=>void) {
      if (deps.some((dependency:string) => ctx.get(dependency) === undefined)) return () => {}
      const scope = Object.create(ctx)
      for (const dependency of deps) scope[dependency] = ctx.get(dependency)
      return callback(scope)
    },
    get(key:string) { return key === 'connection' ? connection : undefined },
    effect(callback:()=>void|(()=>void|Promise<void>)) { const disposer = callback(); ctx.effects.push(disposer); return disposer },
    on() { return () => {} },
    logger: { info() {}, warn() {}, error() {} },
  }
  const config = resolveConfig({})
  const service = new BrowserFlowService(hostPort(ctx), config)
  service.start()
  return { ctx, service, config, routes, tools, agents }
}

/**
 * Invoke one registered route with a JSON body.
 * @param {object} route - registered route.
 * @param {unknown} body - JSON body.
 * @returns {Promise<{ status: number, body: unknown }>} status and parsed body.
 */
async function call(route: import('../src/index.ts').FetchRoute, body: unknown) {
  const response = await route.fetch(new Request('http://host.test/', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { protocolVersion: 4, ...body } : body),
  }))
  return { status: response.status, body: await response.json() }
}

describe('R04: several candidate pages stay several entries', () => {
  it('lists two distinct guests as two entries, each with its own lease', async () => {
    const host = makeHost()
    const pages = [
      { lease: 'guest-1', partition: 'part-1', url: 'https://a.test/one', documentToken: 'doc-1', tabId: 'tab-1' },
      { lease: 'guest-2', partition: 'part-1', url: 'https://a.test/two', documentToken: 'doc-2', tabId: 'tab-2' },
    ]
    const hello = await call(present(host.routes.get('POST /api/browser-flow/hello')), {
      kind: 'hello', protocolVersion: 4, connectionGeneration: 1, sessionId: 'session-1',
      panel: { instanceId: 'panel-1', pages },
    })
    assert.equal(hello.status, 200)
    // Authorize only the first; the second must remain a separate, unauthorized entry.
    await bindTestTask(host.service,'session-1',[...new Set(pages.map(page=>new URL(page.url).origin))])
    const authorize = await call(present(host.routes.get('POST /api/browser-flow/authorize')), {
      instanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
      lease: 'guest-1', partition: 'part-1', documentToken: 'doc-1', tabId: 'tab-1',
    })
    assert.equal(authorize.status, 200, JSON.stringify(authorize.body))
    const tabs = await present(host.tools.get('browser_tabs')).execute({}, { agent: host.agents.get('session-1'),signal:new AbortController().signal })
    assert.equal(tabs.ok, true, JSON.stringify(tabs))
    assert.equal(expectSized(expectRecord(tabs.value).pages).length, 2, 'two guests must not collapse into one entry')
    const byLease = new Map(expectList(expectRecord(tabs.value).pages).map((page) => [expectRecord(page).lease, page]))
    assert.equal(expectRecord(byLease.get('guest-1')).authorized, true, 'the authorized guest must show as authorized')
    assert.equal(expectRecord(byLease.get('guest-2')).authorized, false, 'the other guest must stay unauthorized')
    assert.notEqual(expectRecord(byLease.get('guest-1')).tabId, expectRecord(byLease.get('guest-2')).tabId, 'the two entries must be distinguishable')
  })
})

describe('a command the panel took but never answered is settled', () => {
  it('reports unknown_outcome once the command budget passes', async () => {
    const clock = { t: 1000 }
    const state = createControlState({ now: () => clock.t })
    const limits = resolveConfig({ commandBudgetMs: 500, waitMaxMs: 500 })
    const page = { lease: 'guest-1', partition: 'part-1', url: 'https://a.test/x', documentToken: 'doc-1', tabId: 'tab-1' }
    const agent = { id: 'session-1' }
    state.registerConnection({
      kind: 'hello', protocolVersion: 4, connectionGeneration: 1, sessionId: 'session-1',
      panel: { instanceId: 'panel-1', pages: [page] },
    })
    state.authorize({
      connectionInstanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
      agentInstanceToken: 'token-1', agent,
      lease: page.lease, partition: page.partition, documentToken: page.documentToken, tabId: page.tabId,
    })
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    const pending = state.run(present(lease), { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const taken = state.takeCommands('panel-1', 1, limits)
    assert.equal(expectOk(taken).commands.length, 1, 'the command must be delivered first')
    // The panel never answers. Waiting past the budget must settle it rather than
    // leave the page busy forever.
    clock.t += 700
    const next = state.takeCommands('panel-1', 1, limits)
    assert.equal(next.ok, true)
    const outcome = await pending
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'unknown_outcome', 'a dispatched command with no reply is an unknown outcome')
  })

  it('keeps the page usable again after the stalled command is settled', async () => {
    const clock = { t: 1000 }
    const state = createControlState({ now: () => clock.t })
    const limits = resolveConfig({ commandBudgetMs: 500, waitMaxMs: 500 })
    const page = { lease: 'guest-1', partition: 'part-1', url: 'https://a.test/x', documentToken: 'doc-1', tabId: 'tab-1' }
    const agent = { id: 'session-1' }
    state.registerConnection({
      kind: 'hello', protocolVersion: 4, connectionGeneration: 1, sessionId: 'session-1',
      panel: { instanceId: 'panel-1', pages: [page] },
    })
    state.authorize({
      connectionInstanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
      agentInstanceToken: 'token-1', agent,
      lease: page.lease, partition: page.partition, documentToken: page.documentToken, tabId: page.tabId,
    })
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    const first = state.run(present(lease), { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    state.takeCommands('panel-1', 1, limits)
    clock.t += 700
    state.takeCommands('panel-1', 1, limits)
    await first
    // The slot must be free, so a fresh command is dispatched rather than queued.
    const refreshed = state.leaseFor(agent, 'token-1', 'session-1')
    const second = state.run(present(refreshed), { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const taken = state.takeCommands('panel-1', 1, limits)
    assert.equal(expectOk(taken).commands.length, 1, 'the page must not stay occupied by a stalled command')
    state.revoke({ controlLeaseId: 'lease-1' }, 'test cleanup')
    await second
  })
})
