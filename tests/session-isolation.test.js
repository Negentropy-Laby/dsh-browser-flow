import { bindTestTask } from './helpers/bind-task.js'
/**
 * One Session must not see another Session's pages.
 *
 * `browser_tabs` offers only the candidates this Session could be
 * authorized for and never another Session's page content. The state machine has
 * a unit test for the lease lookup; this exercises the tool and the routes, which
 * is where a missing filter would actually leak.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BrowserFlowService } from '../src/index.js'
import { resolveConfig } from '../src/config.js'

/**
 * Build the service over a fake Cordis context with two live Agents.
 * @returns {object} harness.
 */
function makeHost() {
  const agents = new Map([
    ['session-1', { id: 'session-1', session: { id: 'session-1' } }],
    ['session-2', { id: 'session-2', session: { id: 'session-2' } }],
  ])
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
 * Invoke one registered route with a JSON body.
 * @param {object} route - registered route.
 * @param {unknown} body - JSON body.
 * @returns {Promise<any>} parsed response body.
 */
async function call(route, body) {
  const response = await route.fetch(new Request('http://host.test/', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { protocolVersion: 3, ...body } : body),
  }))
  return response.json()
}

describe('Session isolation at the tool and route level', () => {
  it('lists only the calling Session\'s candidates', async () => {
    const host = makeHost()
    const helloFor = async (instanceId, sessionId, lease) => {
      const answer = await call(host.routes.get('POST /api/browser-flow/hello'), {
        kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId,
        panel: {
          instanceId,
          pages: [{ lease, partition: 'part-1', url: 'https://a.test/' + lease, documentToken: 'doc-' + lease, tabId: 'tab-' + lease }],
        },
      })
      assert.equal(answer.ok, true, JSON.stringify(answer))
    }
    await helloFor('panel-1', 'session-1', 'one')
    await helloFor('panel-2', 'session-2', 'two')

    await bindTestTask(host.service,'session-1',['https://a.test'])
    await bindTestTask(host.service,'session-2',['https://a.test'])
    const first = await host.tools.get('browser_tabs').execute({}, { agent: host.agents.get('session-1') })
    assert.equal(first.ok, true, JSON.stringify(first))
    assert.equal(first.value.pages.length, 1, 'the other Session\'s page must not appear')
    assert.equal(first.value.pages[0].lease, 'one')

    const second = await host.tools.get('browser_tabs').execute({}, { agent: host.agents.get('session-2') })
    assert.equal(second.value.pages.length, 1)
    assert.equal(second.value.pages[0].lease, 'two')
  })

  it('refuses to authorize a page the other Session reported', async () => {
    const host = makeHost()
    await call(host.routes.get('POST /api/browser-flow/hello'), {
      kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'session-2',
      panel: {
        instanceId: 'panel-2',
        pages: [{ lease: 'theirs', partition: 'part-1', url: 'https://a.test/theirs', documentToken: 'doc-theirs', tabId: 'tab-theirs' }],
      },
    })
    // Session 1 has no live panel, so it cannot grant anything either.
    const refused = await call(host.routes.get('POST /api/browser-flow/authorize'), {
      instanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
      lease: 'theirs', partition: 'part-1', documentToken: 'doc-theirs', tabId: 'tab-theirs',
    })
    assert.notEqual(refused.ok, true, 'a Session cannot authorize a page it never reported')
  })
})
