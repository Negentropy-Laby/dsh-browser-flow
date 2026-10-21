import { tmpdir } from 'node:os'
/**
 * Host loadability against explicitly selected build artifacts.
 *
 * The unit tests exercise the plugin against a hand-written fake context. This
 * test proves the other half: the plugin is a *loadable Cordis plugin* whose
 * tool registrations are accepted by the real Host tool registry, and whose
 * panel channel answers real Request/Response traffic.
 *
 * It boots the real `@deepseek-ai/cordis` Context and the real
 * `@deepseek-ai/dsh-tools` `ToolRuntime` from this checkout's built `lib/`
 * artifacts, then loads `src/index.js` exactly as the Loader would. The
 * checkout is located by `DSH_CHECKOUT` (default: the sibling
 * `deepseek-harness` directory); when its build artifacts are absent the test
 * skips with an explicit reason instead of silently passing.
 */

import assert from 'node:assert/strict'
import { existsSync, rmSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it, after } from 'node:test'
import { pathToFileURL } from 'node:url'
import { apply, inject, name } from '../src/index.js'
import { listDefinitions, definitionSkills } from '../src/task-definitions.js'
import { syntheticDefinition } from './helpers/task-definition.js'

/** Checkout used for the real Host artifacts. */
const checkout = process.env.DSH_CHECKOUT ?? resolve(process.cwd(), '..', 'deepseek-harness')

/** Artifacts the proof needs. */
const artifacts = {
  cordis: join(checkout, 'vendor', 'cordis', 'lib', 'index.js'),
  tools: join(checkout, 'packages', 'core', 'tools', 'lib', 'index.js'),
  skills: join(checkout, 'packages', 'skill', 'skill', 'lib', 'index.js'),
}

const available = Object.fromEntries(Object.entries(artifacts).map(([key, path]) => [key, existsSync(path)]))
const ready = Object.values(available).every(Boolean)

/**
 * Import one built artifact by file URL.
 * @param {string} path - absolute path.
 * @returns {Promise<object>} module namespace.
 */
async function importArtifact(path) {
  return import(pathToFileURL(path).href)
}

/**
 * Mount the real tool registry on a fresh Cordis context.
 *
 * `ToolRuntime` injects `systemPrompt`, so the proof supplies that service
 * before the registry activates, exactly as the real Host composition does.
 * @param {object} root - Cordis root context.
 * @param {Function} ToolsService - the real `ToolRuntime` class.
 * @returns {Promise<void>} after the registry is available as `root.tools`.
 */
async function mountTools(root, ToolsService) {
  root.provide('systemPrompt', {
    tools: () => () => {},
    section: () => () => {},
  })
  await root.plugin(ToolsService)
  assert.notEqual(root.tools, undefined, 'the tools service must be available')
}

/**
 * Build a real Host context with the tools registry, an agents registry, and
 * (optionally) the authenticated connection service, then load this plugin.
 * @param {object} input - mount inputs.
 * @param {object} input.Context - real Cordis Context class.
 * @param {Function} input.ToolsService - real `ToolRuntime` class.
 * @param {Function} [input.SkillsService] - optional real skill registry.
 * @param {object} [input.agent] - live Agent to register.
 * @param {boolean} [input.connection] - whether to provide the panel channel.
 * @returns {Promise<{ root: object, routes: Map<string, object> }>} mounted host.
 */
async function mountHost({ Context, ToolsService, SkillsService, agent, connection = false, localTasksDir }) {
  const root = new Context()
  const taskHome=mkdtempSync(join(tmpdir(),'bf-real-host-'))
  root.provide('profileContext',{name:'test',home:taskHome})
  after(async()=>{await root.fiber.dispose();rmSync(taskHome,{recursive:true,force:true})})
  await mountTools(root, ToolsService)
  const agents = new Map(agent === undefined ? [] : [[agent.id, agent]])
  root.provide('agents', { get: id => agents.get(id) })
  if (SkillsService !== undefined) await root.plugin(SkillsService)
  const routes = new Map()
  if (connection) {
    root.provide('connection', {
      fetch: {
        register(route) {
          routes.set(`${route.methods.join(',')} ${route.path}`, route)
          return () => routes.delete(`${route.methods.join(',')} ${route.path}`)
        },
      },
    })
  }
  const plugin = root.plugin({ inject, apply: (ctx, config) => apply(ctx, {...config, localTasksDir:localTasksDir ?? join(taskHome,'tasks')}) })
  await plugin
  return { root, routes, plugin }
}

describe('Host loadability', { skip: ready ? false : `missing Host build artifacts in ${checkout}: ${JSON.stringify(available)}` }, () => {
  it('loads as a Cordis plugin and registers the six tools on the real registry', async () => {
    const { Context } = await importArtifact(artifacts.cordis)
    const toolsModule = await importArtifact(artifacts.tools)
    const ToolsService = toolsModule.default ?? toolsModule.ToolRuntime
    assert.equal(typeof ToolsService, 'function', 'the tools artifact must export its service class')

    const agent = { id: 'session-loadability', session: { id: 'session-loadability' } }
    const { root } = await mountHost({ Context, ToolsService, agent })
    const registered = root.tools.schemas().map(schema => schema.name).filter(toolName => toolName.startsWith('browser_'))
    assert.deepEqual(registered.sort(), [
      'browser_act', 'browser_find', 'browser_observe', 'browser_release', 'browser_tabs', 'browser_wait',
    ])
    // The real registry accepts the definitions: every schema projects.
    for (const schema of root.tools.schemas()) assert.equal(typeof schema.description, 'string')
    const tools = root.tools
    await root.fiber.dispose()
    // Cordis withdrawals are effects: after teardown the registrations are gone.
    assert.equal(tools.schemas().filter(schema => schema.name.startsWith('browser_')).length, 0)
  })

  it('exposes the declared name and inject list the Loader entry expects', () => {
    assert.equal(name, 'browser-flow')
    assert.deepEqual(inject, ['tools', 'agents'])
  })

  for (const late of [false, true]) {
    it(`registers user-only navigation on a ${late ? 'late' : 'present'} real skill service and withdraws it`, async () => {
      const { Context } = await importArtifact(artifacts.cordis)
      const toolsModule = await importArtifact(artifacts.tools)
      const skillsModule = await importArtifact(artifacts.skills)
      const SkillsService = skillsModule.default ?? skillsModule.SkillRegistry
      const fixture=syntheticDefinition()
      const { root, plugin } = await mountHost({
        localTasksDir:fixture.root,
        Context, ToolsService: toolsModule.default ?? toolsModule.ToolRuntime,
        ...(late ? {} : { SkillsService }),
      })
      try {
        assert.equal(root.tools.schemas().filter(tool => tool.name.startsWith('browser_')).length, 6)
        if (late) {
          assert.equal(root.skills, undefined)
          await root.plugin(SkillsService)
        }
        const skills = root.skills
        for (const expected of listDefinitions(fixture.root).flatMap(definitionSkills)) {
          const definition = await skills.get(expected.name)
          assert.equal(definition.content, expected.content)
          assert.deepEqual(definition.invocation, { modelInvocable: false, userInvocable: true })
        }
        await plugin.dispose()
        assert.equal(await skills.get('synthetic-read'), undefined)
        assert.equal(await skills.get('bjrsj-import'), undefined)
        assert.equal(root.tools.schemas().filter(tool => tool.name.startsWith('browser_')).length, 0)
      } finally { await root.fiber.dispose(); rmSync(fixture.root,{recursive:true,force:true}) }
    })
  }

  it('answers real panel traffic and settles a real tool call end to end', async () => {
    const { Context } = await importArtifact(artifacts.cordis)
    const toolsModule = await importArtifact(artifacts.tools)
    const ToolsService = toolsModule.default ?? toolsModule.ToolRuntime

    const agent = { id: 'session-round-trip', session: { id: 'session-round-trip' } }
    const { root, routes } = await mountHost({ Context, ToolsService, agent, connection: true })

    /** @param {string} path - route path. @param {object} body - JSON body. */
    const post = async (path, body) => {
      const route = routes.get(`POST ${path}`)
      assert.notEqual(route, undefined, `missing route ${path}`)
      const response = await route.fetch(new Request(`http://127.0.0.1:62231${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { protocolVersion: 3, ...body } : body),
      }))
      return { status: response.status, body: await response.json() }
    }

    const pages = [{
      lease: 'guest-rt', partition: 'part-rt',
      url: 'https://example.test/sheet?token=leak', documentToken: 'doc-rt', tabId: 'tab-rt',
    }]
    const hello = await post('/api/browser-flow/hello', {
      kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: agent.id,
      panel: { instanceId: 'panel-rt', pages },
    })
    assert.equal(hello.status, 200)
    assert.equal(hello.body.value.protocolVersion, 3)
    assert.equal(hello.body.value.capabilities.screenshot, 'unsupported')

    await post('/api/browser-flow/authorize',{instanceId:'panel-rt',connectionGeneration:1,sessionId:agent.id,taskOperation:'create',spec:{goal:'Synthetic real registry task',origins:['https://example.test']}})
    const authorized = await post('/api/browser-flow/authorize', {
      instanceId: 'panel-rt', connectionGeneration: 1, sessionId: agent.id,
      lease: 'guest-rt', partition: 'part-rt', documentToken: 'doc-rt', tabId: 'tab-rt',
    })
    assert.equal(authorized.status, 200)

    // Run a real tool call through the real registry: `execute` is the exact
    // function the agent loop invokes, so this exercises the real argument path.
    const tool = root.tools.get('browser_observe')
    assert.notEqual(tool, undefined)
    const execution = tool.execute({}, { agent, signal: new AbortController().signal })

    const polled = await post('/api/browser-flow/poll', {
      instanceId: 'panel-rt', connectionGeneration: 1, sessionId: agent.id, pages,
    })
    assert.equal(polled.status, 200)
    const command = polled.body.value.commands[0]
    assert.equal(command.op.kind, 'observe')

    const settled = await post('/api/browser-flow/result', {
      kind: 'result', task:command.task, instanceId: 'panel-rt', id: command.id, leaseId: command.leaseId,
      connectionGeneration: command.connectionGeneration, epoch: command.epoch, sequence: command.sequence,
      outcome: 'ok',
      payload: { documentToken: 'doc-rt', url: 'https://example.test/sheet?token=leak', nodes: [] },
    })
    assert.equal(settled.status, 200)
    const outcome = await execution
    assert.equal(outcome.ok, true)
    assert.equal(outcome.value.url.includes('leak'), false, 'the service must redact before the model sees the URL')

    await root.fiber.dispose()
  })

  it('refuses a page tool on the real registry when no page is authorized', async () => {
    const { Context } = await importArtifact(artifacts.cordis)
    const toolsModule = await importArtifact(artifacts.tools)
    const ToolsService = toolsModule.default ?? toolsModule.ToolRuntime
    const agent = { id: 'session-unauthorized', session: { id: 'session-unauthorized' } }
    const { root } = await mountHost({ Context, ToolsService, agent, connection: true })
    const outcome = await root.tools.get('browser_observe').execute({}, { agent, signal: new AbortController().signal })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'task_not_bound')
    await root.fiber.dispose()
  })
})
