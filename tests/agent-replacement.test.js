import { bindTestTask } from './helpers/bind-task.js'
/**
 * "Nothing was authorized" and "authorized for another Agent instance" are
 * different failures.
 *
 * The plan requires re-authorization when the Agent is disposed or recreated.
 * Telling the model that no page is authorized in that case sends it looking for
 * a grant that already exists; the right answer names the real cause.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BrowserFlowService } from '../src/index.js'
import { resolveConfig } from '../src/config.js'

const PAGE = {
  lease: 'guest-1', partition: 'part-1', url: 'https://a.test/x',
  documentToken: 'doc-1', tabId: 'tab-1',
}

/**
 * Build the service over a fake Cordis context whose Agent registry the test owns.
 * @param {Map<string, object>} agents - live Agent registry.
 * @returns {object} harness.
 */
function makeHost(agents) {
  const routes = new Map()
  const tools = new Map()
  const connection = {
    fetch: {
      register(route) {
        const key = route.methods.join(',') + ' ' + route.path
        routes.set(key, route)
        return () => routes.delete(key)
      },
    },
  }
  const ctx = {
    effects: [],
    agents: { get: id => agents.get(id) },
    tools: { register(definition) { tools.set(definition.name, definition); return () => {} } },
    inject(deps, callback) {
      if (deps.some(dependency => ctx.get(dependency) === undefined)) return () => {}
      const scope = Object.create(ctx)
      for (const dependency of deps) scope[dependency] = ctx.get(dependency)
      return callback(scope)
    },
    get(key) { return key === 'connection' ? connection : undefined },
    effect(callback) { const disposer = callback(); ctx.effects.push(disposer); return disposer },
    on() { return () => {} },
    logger: { info() {}, warn() {}, error() {} },
  }
  const service = new BrowserFlowService(ctx, resolveConfig({}))
  service.start()
  return { routes, tools, agents, service }
}

/**
 * Register the panel and authorize the page for whoever is live now.
 * @param {object} host - harness.
 * @returns {Promise<void>} resolves once authorized.
 */
async function authorize(host) {
  await bindTestTask(host.service,'session-1',[new URL(PAGE.url).origin])
  const post = async (route, body) => {
    const response = await host.routes.get('POST /api/browser-flow/' + route).fetch(new Request('http://host.test/', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { protocolVersion: 3, ...body } : body),
    }))
    return response.json()
  }
  const hello = await post('hello', {
    kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'session-1',
    panel: { instanceId: 'panel-1', pages: [PAGE] },
  })
  assert.equal(hello.ok, true, JSON.stringify(hello))
  const granted = await post('authorize', {
    instanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
    lease: PAGE.lease, partition: PAGE.partition, documentToken: PAGE.documentToken, tabId: PAGE.tabId,
  })
  assert.equal(granted.ok, true, JSON.stringify(granted))
}

describe('the refusal names the real cause', () => {
  it('says nothing is authorized when nothing was', async () => {
    const agents = new Map([['session-1', { id: 'session-1', session: { id: 'session-1' } }]])
    const host = makeHost(agents)
    const tool = host.tools.get('browser_observe')
    const outcome = await tool.execute({}, { agent: agents.get('session-1') })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'task_not_bound')
  })

  it('says the grant belongs to another Agent instance when it does', async () => {
    const first = { id: 'session-1', session: { id: 'session-1' } }
    const agents = new Map([['session-1', first]])
    const host = makeHost(agents)
    await authorize(host)

    // The Session's Agent is recreated. The plan requires re-authorization; the
    // refusal must say so instead of denying that any grant exists.
    const second = { id: 'session-1', session: { id: 'session-1' } }
    agents.set('session-1', second)
    const outcome = await host.tools.get('browser_observe').execute({}, { agent: second })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'agent_replaced', `unexpected refusal: ${JSON.stringify(outcome.error)}`)
    assert.match(outcome.error.message, /different Agent instance/)
  })

  it('serves the tools again once the page is authorized for the new instance', async () => {
    const first = { id: 'session-1', session: { id: 'session-1' } }
    const agents = new Map([['session-1', first]])
    const host = makeHost(agents)
    await authorize(host)
    const second = { id: 'session-1', session: { id: 'session-1' } }
    agents.set('session-1', second)
    // The user authorizes again from the panel.
    await authorize(host)
    // The tool now resolves a lease; it will wait for the panel to answer, so
    // assert on the lease rather than on the settled call.
    const resolved = host.service.resolveCaller({ agent: second })
    assert.equal(resolved.ok, true)
    const lease = host.service.leaseOf(resolved.value)
    assert.equal(lease.ok, true, 'the new instance must hold control after re-authorization')
  })
})