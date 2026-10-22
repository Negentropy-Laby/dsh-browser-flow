import {expectRecord,present,expectSized} from './helpers/assertions.ts'
import {hostPort} from './helpers/ports.ts'
import { bindTestTask } from './helpers/bind-task.ts'
/**
 * Negative acceptance through the real Host routes.
 *
 * The review's central point was that `tests/state.test.ts` calls the state
 * machine directly with well-formed arguments, so it can never catch an adapter
 * that passes the wrong ones. These tests go through `POST /api/browser-flow/*`
 * exactly as the panel does.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BrowserFlowService } from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'

/**
 * Build the service over a fake Cordis context whose `connection.fetch.register`
 * records routes, and whose agent registry holds one live Agent.
 * @param {object} [options] - harness options.
 * @returns {object} harness.
 */
function makeHost(options: {config?:Record<string,unknown>} = {}) {
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
    // Cordis inject() hands the callback a scope carrying each dependency as a
    // property; the service reads scope.connection, not scope.get().
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
  const config = resolveConfig(options.config ?? {})
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
  const request = new Request('http://host.test/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { protocolVersion: 3, ...body } : body),
  })
  const response = await route.fetch(request)
  return { status: response.status, body: await response.json() }
}

/** The live Agent the tools resolve their caller through. */
const LIVE_AGENT = { id: 'session-1', session: { id: 'session-1' } }

/** The page the fake panel reports. */
const PAGE = { lease: 'guest-1', partition: 'part-1', url: 'https://a.test/x', documentToken: 'doc-a', tabId: 'tab-1' }

/**
 * Register a panel and authorize the page.
 * @param {object} host - harness.
 * @returns {Promise<object>} the authorization body.
 */
async function authorized(host: ReturnType<typeof makeHost>) {
  await bindTestTask(host.service,'session-1',[new URL(PAGE.url).origin])
  const hello = await call(present(host.routes.get('POST /api/browser-flow/hello')), {
    kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'session-1',
    panel: { instanceId: 'panel-1', pages: [PAGE] },
  })
  assert.equal(hello.status, 200)
  const authorize = await call(present(host.routes.get('POST /api/browser-flow/authorize')), {
    instanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
    lease: PAGE.lease, partition: PAGE.partition, documentToken: PAGE.documentToken, tabId: PAGE.tabId,
  })
  assert.equal(authorize.status, 200, JSON.stringify(authorize.body))
  return authorize.body.value
}

describe('R01: the invalidate route actually retires an authorization', () => {
  it('accepts the documented four-field body and retires the lease', async () => {
    const host = makeHost()
    const lease = await authorized(host)
    const answer = await call(present(host.routes.get('POST /api/browser-flow/invalidate')), {
      instanceId: 'panel-1', connectionGeneration: 1, lease: PAGE.lease, event: 'cross_origin_navigation',
    })
    assert.equal(answer.status, 200, `invalidate was refused: ${JSON.stringify(answer.body)}`)
    assert.equal(answer.body.ok, true)
    assert.equal(answer.body.value.affected.length, 1, 'the lease must be affected')
    assert.notEqual(answer.body.value.affected[0].state, 'active', 'the lease must leave the active state')
    assert.equal(answer.body.value.affected[0].controlLeaseId, lease.controlLeaseId)
  })

  it('refuses a tool call under a retired lease after a cross-origin navigation', async () => {
    const host = makeHost()
    await authorized(host)
    await call(present(host.routes.get('POST /api/browser-flow/invalidate')), {
      instanceId: 'panel-1', connectionGeneration: 1, lease: PAGE.lease, event: 'cross_origin_navigation',
    })
    const observe = host.tools.get('browser_observe')
    const outcome = await present(observe).execute({}, { agent: host.agents.get('session-1'),signal:new AbortController().signal })
    assert.equal(outcome.ok, false, 'a retired lease must not serve a tool call')
    assert.ok(
      ['not_authorized', 'revoked', 'stale_observation'].includes(outcome.error.code),
      `unexpected refusal: ${JSON.stringify(outcome.error)}`,
    )
  })

  it('keeps the page listed after invalidation, so it stays usable', async () => {
    const host = makeHost()
    await authorized(host)
    await call(present(host.routes.get('POST /api/browser-flow/invalidate')), {
      instanceId: 'panel-1', connectionGeneration: 1, lease: PAGE.lease, event: 'page_destroyed',
    })
    const tabs = host.tools.get('browser_tabs')
    const listed = await present(tabs).execute({}, { agent: host.agents.get('session-1'),signal:new AbortController().signal })
    assert.equal(listed.ok, true)
    assert.equal(expectSized(expectRecord(listed.value).pages).length, 1)
  })

  it('refuses an invalidation from a stale connection generation', async () => {
    const host = makeHost()
    await authorized(host)
    const answer = await call(present(host.routes.get('POST /api/browser-flow/invalidate')), {
      instanceId: 'panel-1', connectionGeneration: 2, lease: PAGE.lease, event: 'cross_origin_navigation',
    })
    assert.notEqual(answer.status, 200, 'a stale generation must not invalidate anything')
    assert.equal(answer.body.error.code, 'connection_stale')
  })
})

describe('R01/§6.3: the invalidate route carries the document the panel now shows', () => {
  it('adopts the reported document when the Host keeps the grant', async () => {
    const host = makeHost()
    await authorized(host)
    const invalidated = await call(present(host.routes.get('POST /api/browser-flow/invalidate')), {
      instanceId: 'panel-1', connectionGeneration: 1, lease: PAGE.lease,
      event: 'same_origin_navigation', documentToken: 'doc-b',
    })
    assert.equal(invalidated.status, 200, JSON.stringify(invalidated.body))
    assert.equal(invalidated.body.value.affected[0].state, 'active', 'a same-origin reload keeps control')

    // The lease must now know the new document, or every later result would look
    // like it came from someone else's page.
    const resolved = host.service.resolveCaller({ agent: host.agents.get('session-1'),signal:new AbortController().signal })
    assert.equal(resolved.ok, true)
    const lease = host.service.state.leaseFor(
      present(host.agents.get('session-1')), resolved.value.agentInstanceToken, 'session-1',
    )
    assert.notEqual(lease, undefined)
    assert.equal(present(lease).documentToken, 'doc-b', 'the retained lease follows the document on screen')
  })

  it('refuses a non-string document token instead of guessing', async () => {
    const host = makeHost()
    await authorized(host)
    const refused = await call(present(host.routes.get('POST /api/browser-flow/invalidate')), {
      instanceId: 'panel-1', connectionGeneration: 1, lease: PAGE.lease,
      event: 'same_origin_navigation', documentToken: 42,
    })
    assert.equal(refused.status, 400, 'a malformed token is a protocol violation, not a silent default')
    assert.equal(refused.body.error.code, 'protocol_violation')
  })
})
