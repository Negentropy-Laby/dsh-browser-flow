/** Shared dependency lookup and per-instance Host wiring for synthetic DOM tests. */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyResult, programFor, type PageOperation } from '../../src/clientcore.ts'
import { decodePanelReply } from '../../src/client-wire.ts'
import { PAGE_CODE } from '../../src/panel.ts'
import { expectOk, expectRecord, present } from './assertions.ts'
import type { Dispose, FetchRoute, HostContext, LiveAgent, PanelPage, ToolDefinition } from './ports.ts'

/** @param checkout - selected Harness checkout. @param name - package name. @returns Its direct or first pnpm-store directory, when present. */
export function resolveDependency(checkout: string, name: string): string | undefined {
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

/** @param packageDir - dependency directory. @returns Its declared main entry, or index.js. */
export function entryOf(packageDir: string): string {
  const manifest = expectRecord(JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')))
  return join(packageDir, typeof manifest.main === 'string' ? manifest.main : 'index.js')
}

/** @param agent - fixture's live Agent. @returns Independent Host services and captured registrations. */
export function host(agent: LiveAgent) {
  const routes = new Map<string, FetchRoute>()
  const tools = new Map<string, ToolDefinition>()
  const connection = {
    fetch: {
      register(route: FetchRoute) {
        const key = `${route.methods.join(',')} ${route.path}`
        routes.set(key, route)
        return () => routes.delete(key)
      },
    },
  }
  const ctx: Omit<HostContext, 'get'> & { effects: (void | Dispose)[] } = {
    agents: { get: id => id === agent.id ? agent : undefined },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    inject(dependencies, callback) {
      callback({ ...ctx, ...(dependencies.includes('connection') ? { connection } : {}) })
    },
    effect(callback) { const dispose=callback();ctx.effects.push(dispose);return dispose },
    logger: { info() {}, warn() {}, error() {} },
    effects: [],
  }
  return { ctx, routes, tools }
}

/** @param route - captured Host route. @param body - fixture JSON. @returns HTTP status and untrusted response JSON. */
export async function call(route: FetchRoute, body: unknown) {
  const response = await route.fetch(new Request(`http://127.0.0.1:62231${route.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { protocolVersion: 4, ...body } : body),
  }))
  const value: unknown = await response.json()
  return { status: response.status, body: value }
}

/** @param input - fixture page realm and operation. @returns The shipped program's classified result. */
async function executeInPage({ window, op }: { window: { Function: FunctionConstructor }; op: PageOperation }) {
  const source = programFor(PAGE_CODE, op)
  return classifyResult(await new window.Function(`return (${source})`)())
}

/** @param input - fixture's captured routes, page realm and Session. @returns Completion of the current poll and its receipts. */
export async function pump({ routes, window, pages, sessionId }: {
  routes: Map<string, FetchRoute>; window: { Function: FunctionConstructor }; pages: PanelPage[]; sessionId: string
}): Promise<void> {
  const poll = await call(present(routes.get('POST /api/browser-flow/poll')), {
    instanceId: 'panel-1', connectionGeneration: 1, sessionId, pages,
  })
  assert.equal(poll.status, 200, `poll failed: ${JSON.stringify(poll.body)}`)
  const commands = present(expectOk(decodePanelReply(poll.body)).commands)
  for (const command of commands) {
    const result = await executeInPage({ window, op: command.op })
    await call(present(routes.get('POST /api/browser-flow/result')), {
      kind: 'result', task: command.task, instanceId: 'panel-1', id: command.id, leaseId: command.leaseId,
      connectionGeneration: command.connectionGeneration,
      epoch: command.epoch, sequence: command.sequence, ...result,
    })
  }
}
