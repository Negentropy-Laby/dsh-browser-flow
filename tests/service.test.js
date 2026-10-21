import { bindTestTask } from './helpers/bind-task.js'
/**
 * Host service tests: route handling, tool registration, and the model-facing
 * failure paths.
 *
 * The service is exercised against a fake Cordis context that implements only
 * the four things the plugin uses: `tools.register`, `agents.get`, `get(key)`
 * for the authenticated connection, and `effect`/`logger`. That keeps the test
 * honest about the Host surface the plugin actually depends on.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BrowserFlowService, apply, inject, name } from '../src/index.js'
import { resolveConfig } from '../src/config.js'

/** Build a fake Host context with one live Agent and a captured route table. */
function host(options = {}) {
  const agents = new Map()
  const agent = { id: 'session-1', session: { id: 'session-1' } }
  if (options.registerAgent !== false) agents.set('session-1', agent)
  const routes = new Map()
  const tools = new Map()
  const warnings = []
  const connection = options.connection === false
    ? undefined
    : {
      fetch: {
        register(route) {
          routes.set(`${route.methods.join(',')} ${route.path}`, route)
          return () => routes.delete(`${route.methods.join(',')} ${route.path}`)
        },
      },
    }
  const ctx = {
    agents: { get: id => agents.get(id) },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    // Cordis `inject(deps, callback)` runs the callback once every dependency is
    // available, with a context that carries them as properties. The fake
    // resolves immediately when the dependency is present and never when it is
    // absent, which is the behaviour the plugin depends on.
    inject(deps, callback) {
      const missing = deps.filter(dependency => ctx.get(dependency) === undefined)
      if (missing.length > 0) {
        ctx.pendingInjections.push({ deps, callback })
        return () => {}
      }
      const scope = Object.create(ctx)
      for (const dependency of deps) scope[dependency] = ctx.get(dependency)
      return callback(scope)
    },
    get(key) {
      return key === 'connection' ? connection : undefined
    },
    // Cordis semantics: `effect(callback)` invokes the callback now and keeps
    // whatever disposer it returns for fiber teardown.
    effect(callback) {
      const disposer = callback()
      ctx.effects.push(disposer)
      return disposer
    },
    logger: {
      info() {},
      warn(message) { warnings.push(message) },
      error(message) { warnings.push(message) },
    },
    effects: [],
    pendingInjections: [],
  }
  return { ctx, agents, agent, routes, tools, warnings, connection }
}

/** POST a JSON body to one captured route. */
async function call(route, body) {
  const response = await route.fetch(new Request('http://127.0.0.1:62231' + route.path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { protocolVersion: 3, ...body } : body),
  }))
  return { status: response.status, body: await response.json() }
}

/** Build a service with routes registered and one authorized page. */
async function authorized(options = {}) {
  const fake = host(options)
  const config = resolveConfig(options.config)
  const service = new BrowserFlowService(fake.ctx, config)
  service.start()
  const helloRoute = fake.routes.get('POST /api/browser-flow/hello')
  const hello = await call(helloRoute, {
    kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'session-1',
    panel: {
      instanceId: 'panel-1',
      pages: [{ lease: 'guest-1', partition: 'part-1', url: 'https://example.test/a?token=abc', documentToken: 'doc-1', tabId: 'tab-1' }],
    },
  })
  assert.equal(hello.status, 200, 'hello must succeed')
  await bindTestTask(service)
  const authorizeRoute = fake.routes.get('POST /api/browser-flow/authorize')
  const authorized = await call(authorizeRoute, {
    instanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
    lease: 'guest-1', partition: 'part-1', documentToken: 'doc-1', tabId: 'tab-1',
  })
  assert.equal(authorized.status, 200, 'authorize must succeed')
  return { ...fake, service, config, routes: fake.routes, tools: fake.tools }
}

describe('plugin identity', () => {
  it('declares the Host services it requires', () => {
    assert.equal(name, 'browser-flow')
    assert.deepEqual(inject, ['tools', 'agents'])
  })

  it('registers exactly the six tools', async () => {
    const { tools } = await authorized()
    assert.deepEqual([...tools.keys()].sort(), [
      'browser_act', 'browser_find', 'browser_observe', 'browser_release', 'browser_tabs', 'browser_wait',
    ])
  })

  it('registers the panel routes', async () => {
    const { routes } = await authorized()
    for (const path of ['hello', 'poll', 'result', 'invalidate', 'authorize', 'revoke']) {
      assert.ok(routes.has(`POST /api/browser-flow/${path}`), `missing POST ${path}`)
    }
    assert.ok(routes.has('GET /api/browser-flow/status'))
  })

  it('defers the panel channel until the connection service exists', () => {
    // In the real Host composition the connection service mounts after this
    // plugin, so registration must be deferred rather than dropped. A context
    // with no connection keeps the six tools and leaves the channel pending.
    const fake = host({ connection: false })
    const service = new BrowserFlowService(fake.ctx, resolveConfig({}))
    service.start()
    assert.equal(fake.tools.size, 6)
    assert.equal(fake.routes.size, 0)
    assert.equal(fake.ctx.pendingInjections.length, 2)
    assert.deepEqual(fake.ctx.pendingInjections.map(row=>row.deps), [['connection'],['subprocess']])
  })
})

describe('tool authorization paths', () => {
  it('refuses every page tool before a page is authorized', async () => {
    const fake = host()
    const service = new BrowserFlowService(fake.ctx, resolveConfig({}))
    service.start()
    const caller = { agent: fake.agent }
    for (const toolName of ['browser_observe', 'browser_find', 'browser_act', 'browser_wait']) {
      const tool = fake.tools.get(toolName)
      const args = toolName === 'browser_find'
        ? { by: 'text', value: 'x' }
        : toolName === 'browser_act'
          ? { documentToken: 'doc-1', elementRef: 'el-1', action: 'click' }
          : toolName === 'browser_wait'
            ? { documentToken: 'doc-1', elementRef: 'el-1', condition: 'present', timeoutMs: 10 }
            : {}
      const outcome = await tool.execute(args, { ...caller, signal: new AbortController().signal })
      assert.equal(outcome.ok, false, `${toolName} must refuse without authorization`)
      assert.equal(outcome.error.code, 'task_not_bound', toolName)
    }
  })

  it('refuses a tool call outside an Agent turn', async () => {
    const fake = host()
    const service = new BrowserFlowService(fake.ctx, resolveConfig({}))
    service.start()
    const outcome = await fake.tools.get('browser_observe').execute({}, { signal: new AbortController().signal })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'no_live_agent')
  })

  it('refuses an Agent object that is not the registered one for its Session', async () => {
    const fake = host()
    const service = new BrowserFlowService(fake.ctx, resolveConfig({}))
    service.start()
    const impostor = { id: 'session-1' }
    await bindTestTask(service)
    const outcome = await fake.tools.get('browser_tabs').execute({}, { agent: impostor, signal: new AbortController().signal })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'agent_mismatch')
  })

  it('refuses authorization when the Session has no live Agent', async () => {
    const fake = host({ registerAgent: false })
    const service = new BrowserFlowService(fake.ctx, resolveConfig({}))
    service.start()
    const helloRoute = fake.routes.get('POST /api/browser-flow/hello')
    await call(helloRoute, {
      kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'session-1',
      panel: { instanceId: 'panel-1', pages: [{ lease: 'guest-1', partition: 'part-1', url: 'https://example.test/', documentToken: 'doc-1' }] },
    })
    const authorizeRoute = fake.routes.get('POST /api/browser-flow/authorize')
    const answer = await call(authorizeRoute, {
      instanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
      lease: 'guest-1', partition: 'part-1', documentToken: 'doc-1',
    })
    assert.equal(answer.status, 409)
    assert.equal(answer.body.error.code, 'no_live_agent')
  })
})

describe('browser_tabs', () => {
  it('lists the authorized page with a redacted address', async () => {
    const { tools, agent } = await authorized()
    const outcome = await tools.get('browser_tabs').execute({}, { agent, signal: new AbortController().signal })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.value.pages.length, 1)
    assert.equal(outcome.value.pages[0].authorized, true)
    assert.equal(outcome.value.pages[0].url.includes('abc'), false, 'sensitive query value must be redacted')
    assert.equal(outcome.value.authorization, 'explicit')
  })

  it('reports a missing panel rather than inventing a page list', async () => {
    const fake = host()
    const service = new BrowserFlowService(fake.ctx, resolveConfig({}))
    service.start()
    await bindTestTask(service)
    const outcome = await fake.tools.get('browser_tabs').execute({}, { agent: fake.agent, signal: new AbortController().signal })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'page_unavailable')
  })
})

describe('browser_observe and browser_find', () => {
  it('dispatches an observe command with the configured budgets and settles it', async () => {
    const { tools, agent, routes } = await authorized({ config: { observeMaxChars: 500, observeMaxNodes: 20 } })
    const pending = tools.get('browser_observe').execute({}, { agent, signal: new AbortController().signal })
    // The panel takes the command, as the real bundle does on its next poll.
    const pollRoute = routes.get('POST /api/browser-flow/poll')
    const polled = await call(pollRoute, {
      instanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
      pages: [{ lease: 'guest-1', partition: 'part-1', url: 'https://example.test/a?token=abc', documentToken: 'doc-1', tabId: 'tab-1' }],
    })
    assert.equal(polled.status, 200)
    const command = polled.body.value.commands[0]
    assert.equal(command.op.kind, 'observe')
    assert.equal(command.op.maxChars, 500)
    assert.equal(command.op.maxNodes, 20)
    const resultRoute = routes.get('POST /api/browser-flow/result')
    const settled = await call(resultRoute, {
      kind: 'result', task:command.task, instanceId: 'panel-1', id: command.id, leaseId: command.leaseId, connectionGeneration: 1,
      epoch: command.epoch, sequence: command.sequence, outcome: 'ok',
      payload: { documentToken: 'doc-1', url: 'https://example.test/a?token=abc', nodes: [] },
    })
    assert.equal(settled.status, 200)
    const outcome = await pending
    assert.equal(outcome.ok, true)
    assert.equal(outcome.value.url.includes('abc'), false, 'the service must redact before the model sees it')
  })

  it('reports ambiguous_match instead of choosing the first match', async () => {
    const { tools, agent, routes } = await authorized()
    const pending = tools.get('browser_find').execute({ by: 'text', value: 'Save' }, { agent, signal: new AbortController().signal })
    const polled = await call(routes.get('POST /api/browser-flow/poll'), {
      instanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
      pages: [{ lease: 'guest-1', partition: 'part-1', url: 'https://example.test/a', documentToken: 'doc-1', tabId: 'tab-1' }],
    })
    const command = polled.body.value.commands[0]
    await call(routes.get('POST /api/browser-flow/result'), {
      kind: 'result', task:command.task, instanceId: 'panel-1', id: command.id, leaseId: command.leaseId, connectionGeneration: 1,
      epoch: command.epoch, sequence: command.sequence, outcome: 'ok',
      payload: {
        documentToken: 'doc-1',
        matches: [
          { elementRef: 'el-1', tag: 'button', label: 'Save', text: 'Save' },
          { elementRef: 'el-2', tag: 'button', label: 'Save', text: 'Save' },
        ],
      },
    })
    const outcome = await pending
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'ambiguous_match')
    assert.equal(outcome.error.details.matches.length, 2)
  })

  it('reports not_found when nothing matches', async () => {
    const { tools, agent, routes } = await authorized()
    const pending = tools.get('browser_find').execute({ by: 'role', value: 'dialog' }, { agent, signal: new AbortController().signal })
    const polled = await call(routes.get('POST /api/browser-flow/poll'), {
      instanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
      pages: [{ lease: 'guest-1', partition: 'part-1', url: 'https://example.test/a', documentToken: 'doc-1', tabId: 'tab-1' }],
    })
    const command = polled.body.value.commands[0]
    await call(routes.get('POST /api/browser-flow/result'), {
      kind: 'result', task:command.task, instanceId: 'panel-1', id: command.id, leaseId: command.leaseId, connectionGeneration: 1,
      epoch: command.epoch, sequence: command.sequence, outcome: 'ok',
      payload: { documentToken: 'doc-1', matches: [] },
    })
    const outcome = await pending
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'not_found')
  })

  it('refuses malformed model arguments before dispatch', async () => {
    const { tools, agent } = await authorized()
    const signal = new AbortController().signal
    for (const [name, args, code] of [
      ['browser_find', { by: 'css', value: '*' }, 'invalid_request'],
      ['browser_find', { by: 'attr', value: 'x' }, 'invalid_request'],
      ['browser_act', { documentToken: 'd', elementRef: 'e', action: 'type' }, 'invalid_request'],
      ['browser_act', { documentToken: 'd', elementRef: 'e', action: 'check' }, 'invalid_request'],
      ['browser_wait', { documentToken: 'd', elementRef: 'e', condition: 'text', timeoutMs: 10 }, 'invalid_request'],
      ['browser_wait', { documentToken: 'd', elementRef: 'e', condition: 'present', timeoutMs: 999_999 }, 'invalid_request'],
    ]) {
      const outcome = await tools.get(name).execute(args, { agent, signal })
      assert.equal(outcome.ok, false, `${name} ${JSON.stringify(args)} must be refused`)
      assert.equal(outcome.error.code, code, `${name} ${JSON.stringify(args)}`)
    }
  })
})

describe('browser_release and revocation', () => {
  it('detaches control and keeps the page', async () => {
    const { tools, agent } = await authorized()
    const outcome = await tools.get('browser_release').execute({}, { agent, signal: new AbortController().signal })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.value.pageRetained, true)
    const afterwards = await tools.get('browser_observe').execute({}, { agent, signal: new AbortController().signal })
    assert.equal(afterwards.ok, false)
    assert.equal(afterwards.error.code, 'not_authorized')
  })

  it('refuses a second release', async () => {
    const { tools, agent } = await authorized()
    const signal = new AbortController().signal
    await tools.get('browser_release').execute({}, { agent, signal })
    const again = await tools.get('browser_release').execute({}, { agent, signal })
    assert.equal(again.ok, false)
    assert.equal(again.error.code, 'not_authorized')
  })

  it('stops new actions after a user revocation over the route', async () => {
    const { tools, agent, routes } = await authorized()
    const revoked = await call(routes.get('POST /api/browser-flow/revoke'), {
      instanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
    })
    assert.equal(revoked.status, 200)
    const outcome = await tools.get('browser_observe').execute({}, { agent, signal: new AbortController().signal })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'not_authorized')
  })
})

describe('protocol refusals on the routes', () => {
  it('refuses a hello with a mismatched protocol version', async () => {
    const fake = host()
    const service = new BrowserFlowService(fake.ctx, resolveConfig({}))
    service.start()
    const answer = await call(fake.routes.get('POST /api/browser-flow/hello'), {
      kind: 'hello', protocolVersion: 99, connectionGeneration: 1, sessionId: 'session-1',
      panel: { instanceId: 'panel-1', pages: [] },
    })
    assert.equal(answer.status, 400)
    assert.equal(answer.body.error.code, 'protocol_violation')
  })

  it('refuses a result for an unknown lease', async () => {
    const { routes,service } = await authorized()
    const answer = await call(routes.get('POST /api/browser-flow/result'), {
      kind: 'result', task:service.tasks.current('session-1').run, instanceId: 'panel-1', id: 'cmd-unknown', leaseId: 'lease-unknown', connectionGeneration: 1,
      epoch: 0, sequence: 0, outcome: 'ok', payload: {},
    })
    assert.equal(answer.status, 409)
    assert.equal(answer.body.error.code, 'stale_observation')
  })

  it('refuses a poll from a lower generation and retires leases on a higher one', async () => {
    const { routes, tools, agent } = await authorized()
    const stale = await call(routes.get('POST /api/browser-flow/poll'), {
      instanceId: 'panel-1', connectionGeneration: 0, sessionId: 'session-1', pages: [],
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error.code, 'connection_stale')

    // A newer generation of the same panel instance replaces the old connection
    // and therefore retires its leases: nothing transfers automatically.
    const newer = await call(routes.get('POST /api/browser-flow/poll'), {
      instanceId: 'panel-1', connectionGeneration: 2, sessionId: 'session-1', pages: [],
    })
    assert.equal(newer.status, 200)
    const outcome = await tools.get('browser_observe').execute({}, { agent, signal: new AbortController().signal })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'not_authorized')
  })

  it('refuses a malformed JSON body without throwing', async () => {
    const { routes } = await authorized()
    const response = await routes.get('POST /api/browser-flow/hello').fetch(new Request('http://127.0.0.1/api/browser-flow/hello', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    }))
    assert.equal(response.status, 400)
  })

  it('reports liveAgent and pages on the status route', async () => {
    const { routes } = await authorized()
    const response = await routes.get('GET /api/browser-flow/status').fetch(
      new Request('http://127.0.0.1/api/browser-flow/status?instanceId=panel-1&connectionGeneration=1&sessionId=session-1'),
    )
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.value.liveAgent, true)
    assert.equal(body.value.pages.length, 1)
  })
})

describe('plugin apply', () => {
  it('validates config at load and registers tools through ctx.effect cleanup', async () => {
    const fake = host()
    await apply(fake.ctx, { observeMaxChars: 900 })
    assert.equal(fake.tools.size, 6)
    assert.equal(fake.ctx.effects.length, 1)
    await fake.ctx.effects[0]()
    assert.equal(fake.tools.size, 0, 'cleanup must unregister every tool')
  })

  it('fails the load on an invalid config value', async () => {
    const fake = host()
    await assert.rejects(apply(fake.ctx, { observeMaxChars: 1 }), /observeMaxChars/)
    await assert.rejects(apply(fake.ctx, { waitMaxMs: 999_999 }), /waitMaxMs/)
    await assert.rejects(apply(fake.ctx, { unknownField: 1 }), /unknown config field/)
  })
})
