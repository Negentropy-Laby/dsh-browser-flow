/**
 * The panel must show which Session and which live Agent instance a grant
 * attaches to.
 *
 * Without it the user authorizes an unnamed future caller. The Host reports a
 * short digest of the plugin-minted instance token: enough to tell two instances
 * apart, useless for addressing one, and different whenever the Agent object is
 * recreated and requires re-authorization.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BrowserFlowService } from '../src/index.js'
import { resolveConfig } from '../src/config.ts'

/**
 * Build the service over a fake Cordis context.
 * @param {Map<string, object>} agents - the live Agent registry.
 * @returns {object} harness.
 */
function makeHost(agents) {
  const routes = new Map()
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
    tools: { register() { return () => {} } },
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
  return { routes, ctx, agents }
}

/**
 * Poll once and return the parsed answer.
 * @param {object} host - harness.
 * @param {string} [sessionId] - Session to poll for.
 * @returns {Promise<any>} the parsed response body.
 */
async function poll(host, sessionId = 'session-1') {
  const route = host.routes.get('POST /api/browser-flow/poll')
  const response = await route.fetch(new Request('http://host.test/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      protocolVersion: 3,
      instanceId: 'panel-1', connectionGeneration: 1, sessionId, pages: [],
    }),
  }))
  return response.json()
}

describe('the panel is told which Agent instance it is granting to', () => {
  it('reports the Session id and a short instance digest', async () => {
    const agents = new Map([['session-1', { id: 'session-1', session: { id: 'session-1' } }]])
    const host = makeHost(agents)
    const answer = await poll(host)
    assert.equal(answer.ok, true, JSON.stringify(answer))
    assert.notEqual(answer.value.agent, null, 'a live Agent must be reported')
    assert.equal(answer.value.agent.id, 'session-1')
    assert.match(answer.value.agent.instance, /^[0-9a-f]{8}$/, 'the instance summary is a short digest')
  })

  it('reports no Agent when the Session has none', async () => {
    const host = makeHost(new Map())
    const answer = await poll(host)
    assert.equal(answer.ok, true)
    assert.equal(answer.value.agent, null, 'an absent Agent must be reported as absent, not guessed')
  })

  it('changes the digest when the Agent object is recreated', async () => {
    const agents = new Map([['session-1', { id: 'session-1', session: { id: 'session-1' } }]])
    const host = makeHost(agents)
    const first = await poll(host)
    // A replacement Agent object requires explicit re-authorization.
    agents.set('session-1', { id: 'session-1', session: { id: 'session-1' } })
    const second = await poll(host)
    assert.notEqual(first.value.agent.instance, second.value.agent.instance,
      'a recreated Agent must be visibly a different instance')
  })

  it('keeps the digest stable while the same Agent object lives', async () => {
    const agents = new Map([['session-1', { id: 'session-1', session: { id: 'session-1' } }]])
    const host = makeHost(agents)
    const first = await poll(host)
    const second = await poll(host)
    assert.equal(first.value.agent.instance, second.value.agent.instance,
      'the same instance must keep one identity across polls')
  })

  it('never sends the instance token itself', async () => {
    const agents = new Map([['session-1', { id: 'session-1', session: { id: 'session-1' } }]])
    const host = makeHost(agents)
    const answer = await poll(host)
    const serialized = JSON.stringify(answer)
    assert.equal(serialized.includes('token'), false, 'the wire form carries a digest, not the token')
  })
})
