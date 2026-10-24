import {present} from './helpers/assertions.ts'
import { tmpdir } from 'node:os'
/**
 * Installed-Host loadability against an explicitly selected application archive.
 *
 * `host-loadability.test.ts` proves the plugin loads into a real Host built from
 * this checkout. This test checks that the
 * plugin loads into the **installed** Desktop's own Host runtime — the
 * `@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools` artifacts extracted
 * verbatim from an explicitly supplied installed application archive.
 *
 * The extraction is recorded under `.evidence/installed-host/` together with the
 * manifest that names the build commit, so the artifact under test is traceable.
 * When that extraction is absent the test skips with an explicit reason.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it, after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { apply, inject, name } from '../src/index.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const evidence = join(root, '.evidence', 'installed-host')
const installed = join(evidence, 'node_modules', '@deepseek-ai')

/** Artifacts of the installed Host that the proof needs. */
const artifacts = {
  cordis: join(installed, 'cordis', 'lib', 'index.js'),
  tools: join(installed, 'dsh-tools', 'lib', 'index.js'),
  manifest: join(evidence, 'desktop-app-manifest.json'),
}

const available = Object.fromEntries(Object.entries(artifacts).map(([key, path]) => [key, existsSync(path)]))
const ready = Object.values(available).every(Boolean)

/**
 * Import one installed artifact by file URL.
 * @param {string} path - absolute path.
 * @returns {Promise<object>} module namespace.
 */
async function importArtifact(path: string) {
  return import(pathToFileURL(path).href)
}

describe('installed Desktop Host loadability', { skip: ready ? false : `missing extracted installed Host artifacts under ${installed}: ${JSON.stringify(available)}` }, () => {
  it('records which installed build the proof ran against', () => {
    const manifest = JSON.parse(readFileSync(artifacts.manifest, 'utf8'))
    assert.equal(manifest.name, '@deepseek-ai/dsh-desktop')
    assert.match(manifest.version, /^0\.2\.1-rc\.\d+$/)
    // The extraction records the exact installed build, so this proof cannot
    // silently drift onto another host.
    assert.equal(manifest.dshBuildCommit.length, 40)
    assert.equal(manifest.dshBuildDirty, false)
    assert.equal(manifest.source, 'resources/app.asar package.json')
    assert.ok(Array.isArray(manifest.packages) && manifest.packages.includes('@deepseek-ai/dsh-tools'))
  })

  it('loads into the installed Host registry and registers the six tools', async () => {
    const { Context } = await importArtifact(artifacts.cordis)
    const toolsModule = await importArtifact(artifacts.tools)
    const ToolsService = toolsModule.default ?? toolsModule.ToolRuntime
    assert.equal(typeof ToolsService, 'function')

    const rootContext = new Context()
    const home=mkdtempSync(join(tmpdir(),'bf-installed-task-'))
    rootContext.provide('profileContext',{name:'test',home})
    after(async()=>{await rootContext.fiber.dispose();rmSync(home,{recursive:true,force:true})})
    // The installed `ToolRuntime` injects `systemPrompt`; supply the same
    // minimal face the real Host composition provides before activation.
    rootContext.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
    await rootContext.plugin(ToolsService)
    assert.notEqual(rootContext.tools, undefined, 'the installed tools service must be available')

    const agent = { id: 'session-installed', session: { id: 'session-installed' } }
    const agents = new Map([[agent.id, agent]])
    rootContext.provide('agents', { get: (id:string) => agents.get(id) })
    const routes = new Map<string,import('../src/index.ts').FetchRoute>()
    rootContext.provide('connection', {
      fetch: {
        register(route:import('../src/index.ts').FetchRoute) {
          routes.set(`${route.methods.join(',')} ${route.path}`, route)
          return () => routes.delete(`${route.methods.join(',')} ${route.path}`)
        },
      },
    })
    await rootContext.plugin({ inject, apply: (ctx:import('../src/index.ts').HostContext, config:Record<string,unknown>) => apply(ctx, config) })

    const registered = rootContext.tools.schemas().map((schema:{name:string}) => schema.name).filter((toolName:string) => toolName.startsWith('browser_'))
    assert.deepEqual(registered.sort(), [
      'browser_act', 'browser_find', 'browser_observe', 'browser_release', 'browser_tabs', 'browser_wait',
    ])

    // Drive one full command through the installed Host's route + tool path.
    const post = async (path:string, body:unknown) => {
      const route = routes.get(`POST ${path}`)
      assert.notEqual(route, undefined, `missing route ${path}`)
      const response = await present(route).fetch(new Request(`http://127.0.0.1:62231${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { protocolVersion: 4, ...body } : body),
      }))
      return { status: response.status, body: await response.json() }
    }
    const pages = [{
      lease: 'guest-installed', partition: 'part-installed',
      url: 'https://example.test/sheet?access_token=leak', documentToken: 'doc-installed', tabId: 'tab-installed',
    }]
    const hello = await post('/api/browser-flow/hello', {
      kind: 'hello', protocolVersion: 4, connectionGeneration: 1, sessionId: agent.id,
      panel: { instanceId: 'panel-installed', pages },
    })
    assert.equal(hello.status, 200)
    assert.equal(hello.body.value.capabilities.visual, 'unsupported')

    await post('/api/browser-flow/authorize',{instanceId:'panel-installed',connectionGeneration:1,sessionId:agent.id,taskOperation:'create',spec:{goal:'Synthetic registry task',origins:['https://example.test']}})
    const authorized = await post('/api/browser-flow/authorize', {
      instanceId: 'panel-installed', connectionGeneration: 1, sessionId: agent.id,
      lease: 'guest-installed', partition: 'part-installed', documentToken: 'doc-installed', tabId: 'tab-installed',
    })
    assert.equal(authorized.status, 200)

    const execution = rootContext.tools.get('browser_observe').execute({}, { agent, signal: new AbortController().signal })
    const polled = await post('/api/browser-flow/poll', {
      instanceId: 'panel-installed', connectionGeneration: 1, sessionId: agent.id, pages,
    })
    const command = polled.body.value.commands[0]
    await post('/api/browser-flow/result', {
      kind: 'result', task:command.task, instanceId: 'panel-installed', id: command.id, leaseId: command.leaseId,
      connectionGeneration: command.connectionGeneration, epoch: command.epoch, sequence: command.sequence,
      outcome: 'ok',
      payload: { documentToken: 'doc-installed', url: 'https://example.test/sheet?access_token=leak', nodes: [] },
    })
    const outcome = await execution
    assert.equal(outcome.ok, true)
    assert.equal(outcome.value.url.includes('leak'), false)

    await rootContext.fiber.dispose()
  })

  it('declares the same plugin identity the Loader entry uses', () => {
    assert.equal(name, 'browser-flow')
    assert.deepEqual(inject, ['tools', 'agents'])
  })
})
