import { throughPage } from './helpers/through-page.js'
import { bindTestTask } from './helpers/bind-task.js'
/**
 * The remaining actions and refusals, driven through the real tool layer.
 *
 * `dom-table-loop.test.js` proves the locate → edit → save → re-read loop with
 * `type` and `click`. This file covers what that one does not: `select` and
 * `check` against real form controls, `browser_wait` on a condition that becomes
 * true later, and refusals for unsafe targets —
 * an ambiguous match, a stale observation, and an action on a target that no
 * longer matches.
 *
 * Everything runs through `BrowserFlowService` and the shipped page programs in a
 * real DOM, so a regression in the dispatch path or in a program shows up here.
 */

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BrowserFlowService } from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'
import { actProgram, findProgram, identityProgram, observeProgram, waitProgram } from '../src/pagecode.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = process.env.DSH_CHECKOUT ?? join(root, '..', 'deepseek-harness')

/**
 * Resolve one dependency the way pnpm lays it out.
 * @param {string} name - package name.
 * @returns {string | undefined} absolute package directory.
 */
function resolveDependency(name) {
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

const jsdomEntry = resolveDependency('jsdom')

/**
 * Read a package's declared entry point.
 * @param {string} packageDir - package directory.
 * @returns {string} absolute entry file.
 */
function entryOf(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  return join(packageDir, typeof manifest.main === 'string' ? manifest.main : 'index.js')
}

/**
 * Build a fake Host context with one live Agent.
 * @param {object} agent - the live Agent object.
 * @returns {object} fake context and captures.
 */
function host(agent) {
  const routes = new Map()
  const tools = new Map()
  const connection = {
    fetch: {
      register(route) {
        routes.set(`${route.methods.join(',')} ${route.path}`, route)
        return () => routes.delete(`${route.methods.join(',')} ${route.path}`)
      },
    },
  }
  const ctx = {
    agents: { get: id => (id === agent.id ? agent : undefined) },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    inject(deps, callback) {
      const scope = Object.create(ctx)
      for (const dependency of deps) scope[dependency] = ctx.get(dependency)
      return callback(scope)
    },
    get: key => (key === 'connection' ? connection : undefined),
    effect(callback) {
      const disposer = callback()
      ctx.effects.push(disposer)
      return disposer
    },
    logger: { info() {}, warn() {}, error() {} },
    effects: [],
  }
  return { ctx, routes, tools }
}

/** POST one JSON body to a captured route. */
async function call(route, body) {
  const response = await route.fetch(new Request(`http://127.0.0.1:62231${route.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { protocolVersion: 3, ...body } : body),
  }))
  return { status: response.status, body: await response.json() }
}

/**
 * Run one operation's fixed program in the page realm.
 * @param {object} input - wiring.
 * @returns {Promise<object>} classified outcome.
 */
async function executeInPage({ window, op }) {
  let source
  if (op.kind === 'observe') source = observeProgram(op.maxChars, op.maxNodes)
  else if (op.kind === 'find') source = findProgram(op.query, op.limit)
  else if (op.kind === 'act') {
    source = actProgram({
      documentToken: op.target.documentToken,
      elementRef: op.target.elementRef,
      action: op.action,
      ...(op.value === undefined ? {} : { value: op.value }),
      ...(op.checked === undefined ? {} : { checked: op.checked }),
    })
  } else if (op.kind === 'wait') {
    source = waitProgram({
      condition: op.condition,
      target: op.target,
      timeoutMs: op.timeoutMs,
      ...(op.text === undefined ? {} : { text: op.text }),
    })
  } else {
    return { outcome: 'failed', error: { code: 'unsupported', message: `unsupported op ${op.kind}` } }
  }
  const value = await new window.Function(`return (${source})`)()
  if (value === null || value === undefined) {
    return { outcome: 'unknown_outcome', error: { code: 'unknown_outcome', message: 'no result' } }
  }
  if (value.ok !== true) {
    return {
      outcome: 'failed',
      error: {
        code: typeof value.error?.code === 'string' ? value.error.code : 'internal',
        message: typeof value.error?.message === 'string' ? value.error.message : 'page failure',
      },
    }
  }
  return { outcome: 'ok', payload: value.value }
}

/** Answer every command the panel would poll for. */
async function pump({ routes, window, pages, sessionId }) {
  const poll = await call(routes.get('POST /api/browser-flow/poll'), {
    instanceId: 'panel-1', connectionGeneration: 1, sessionId, pages,
  })
  assert.equal(poll.status, 200, `poll failed: ${JSON.stringify(poll.body)}`)
  for (const command of poll.body.value.commands) {
    const result = await executeInPage({ window, op: command.op })
    await call(routes.get('POST /api/browser-flow/result'), {
      kind: 'result',task:command.task, instanceId: 'panel-1', id: command.id, leaseId: command.leaseId,
      connectionGeneration: command.connectionGeneration,
      epoch: command.epoch, sequence: command.sequence, ...result,
    })
  }
}

const formHtml = `<!doctype html><html><body>
<h1>Settings</h1>
<label for="mode">Mode</label>
<select id="mode">
  <option value="fast">Fast</option>
  <option value="safe">Safe</option>
</select>
<label><input type="checkbox" id="notify"> Notify</label>
<input id="dup" class="dup" value="one">
<input id="dup2" class="dup" value="two">
<p id="status">idle</p>
<script>
  document.getElementById('mode').addEventListener('change', event => {
    document.getElementById('status').textContent = 'mode:' + event.target.value
  })
  document.getElementById('notify').addEventListener('change', event => {
    document.getElementById('status').textContent = 'notify:' + String(event.target.checked)
  })
  setTimeout(() => { document.getElementById('status').textContent = 'ready' }, 150)
</script>
</body></html>`

describe('actions and refusals through the tool layer', { skip: jsdomEntry === undefined ? 'jsdom is unavailable' : false }, () => {
  /** Build one authorized page over the form fixture. */
  async function authorizedForm(config = {}) {
    const { JSDOM } = await import(pathToFileURL(entryOf(jsdomEntry)).href)
    const dom = new JSDOM(formHtml, { url: 'https://sample.test/settings', runScripts: 'dangerously' })
    const window = dom.window
    window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const hidden = this.closest('[hidden]') !== null
      const width = hidden ? 0 : 100
      const height = hidden ? 0 : 20
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }
    }
    const saved = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle }
    globalThis.document = window.document
    globalThis.window = window
    globalThis.getComputedStyle = window.getComputedStyle.bind(window)

    const agent = { id: 'session-1', session: { id: 'session-1' } }
    const fake = host(agent)
    const service = new BrowserFlowService(fake.ctx, resolveConfig(config))
    service.start()

    const identity = new window.Function(`return (${identityProgram()})`)()
    const pages = [{
      lease: 'guest-1', partition: 'part-1',
      url: identity.value.url, documentToken: identity.value.documentToken, tabId: 'tab-1',
    }]
    await call(fake.routes.get('POST /api/browser-flow/hello'), {
      kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: agent.id,
      panel: { instanceId: 'panel-1', pages },
    })
    await bindTestTask(service,agent.id,[new URL(pages[0].url).origin])
      const authorized = await call(fake.routes.get('POST /api/browser-flow/authorize'), {
      instanceId: 'panel-1', connectionGeneration: 1, sessionId: agent.id,
      lease: 'guest-1', partition: 'part-1',
      documentToken: identity.value.documentToken, tabId: 'tab-1',
    })
    assert.equal(authorized.status, 200, `authorize failed: ${JSON.stringify(authorized.body)}`)

    /** Invoke one tool and drain the channel until it answers. */
    const invoke = async (toolName, args) => {
      const tool = fake.tools.get(toolName)
      return throughPage(service,()=>tool.execute(args,{agent,signal:new AbortController().signal}),()=>pump({routes:fake.routes,window,pages,sessionId:agent.id}))
    }

    const restore = () => {
      globalThis.document = saved.document
      globalThis.window = saved.window
      globalThis.getComputedStyle = saved.getComputedStyle
      window.close()
    }
    return { window, fake, agent, invoke, restore }
  }

  it('selects an explicit option and reports the page-side change', async () => {
    const form = await authorizedForm()
    try {
      const found = await form.invoke('browser_find', { by: 'attr', name: 'id', value: 'mode' })
      assert.equal(found.ok, true, `find failed: ${JSON.stringify(found.error)}`)
      const acted = await form.invoke('browser_act', {
        documentToken: found.value.documentToken,
        elementRef: found.value.match.elementRef,
        action: 'select',
        value: 'safe',
      })
      assert.equal(acted.ok, true, `select failed: ${JSON.stringify(acted.error)}`)
      assert.equal(form.window.document.getElementById('mode').value, 'safe')
      assert.equal(form.window.document.getElementById('status').textContent, 'mode:safe',
        'the page handler must observe the selected option')
    } finally { form.restore() }
  })

  it('sets an explicit checked state', async () => {
    const form = await authorizedForm()
    try {
      const found = await form.invoke('browser_find', { by: 'attr', name: 'id', value: 'notify' })
      assert.equal(found.ok, true)
      const acted = await form.invoke('browser_act', {
        documentToken: found.value.documentToken,
        elementRef: found.value.match.elementRef,
        action: 'check',
        checked: true,
      })
      assert.equal(acted.ok, true, `check failed: ${JSON.stringify(acted.error)}`)
      assert.equal(form.window.document.getElementById('notify').checked, true)
      assert.equal(form.window.document.getElementById('status').textContent, 'notify:true')
    } finally { form.restore() }
  })

  it('refuses an ambiguous match instead of choosing the first element', async () => {
    const form = await authorizedForm()
    try {
      const found = await form.invoke('browser_find', { by: 'attr', name: 'class', value: 'dup' })
      assert.equal(found.ok, false, 'two matches must not resolve to one element')
      assert.equal(found.error.code, 'ambiguous_match')
      assert.equal(found.error.details.matches.length, 2,
        'the refusal must list the candidates so the caller can narrow the query')
    } finally { form.restore() }
  })

  for (const scenario of [
    { name: 'locates one button through nested labels', html: '<main><button><span><em>批量导入</em></span></button></main>', tag: 'em' },
    { name: 'locates a label split across child elements', html: '<main><button><span>批量</span><span>导入</span></button></main>', tag: 'button' },
    { name: 'does not spend the match limit on ancestors', html: '<div>'.repeat(30) + '<button><span>批量导入</span></button>' + '</div>'.repeat(30), tag: 'span' },
    { name: 'ignores a hidden duplicate label', html: '<main><button hidden><span>批量导入</span></button><button><span>批量导入</span></button></main>', tag: 'span' },
  ]) {
    it(scenario.name, async () => {
      const form = await authorizedForm()
      try {
        form.window.document.body.insertAdjacentHTML('beforeend', scenario.html)
        let clicks = 0
        for (const button of form.window.document.querySelectorAll('main button, body > div button')) {
          button.addEventListener('click', () => { clicks++ })
        }
        const found = await form.invoke('browser_find', { by: 'text', value: '批量导入' })
        assert.equal(found.ok, true, JSON.stringify(found.error))
        assert.equal(found.value.match.tag, scenario.tag)
        const acted = await form.invoke('browser_act', {
          documentToken: found.value.documentToken, elementRef: found.value.match.elementRef, action: 'click',
        })
        assert.equal(acted.ok, true, JSON.stringify(acted.error))
        assert.equal(clicks, 1, 'one located label must dispatch exactly one button click')
      } finally { form.restore() }
    })
  }

  it('keeps independent text matches ambiguous', async () => {
    const form = await authorizedForm()
    try {
      form.window.document.body.insertAdjacentHTML('beforeend',
        '<main><button><span>批量导入</span></button><button><span>批量导入</span></button></main>')
      const found = await form.invoke('browser_find', { by: 'text', value: '批量导入' })
      assert.equal(found.ok, false)
      assert.equal(found.error.code, 'ambiguous_match')
      assert.equal(found.error.details.matches.length, 2)
      assert.ok(found.error.details.matches.every(match => match.tag === 'span'))
      assert.notEqual(found.error.details.matches[0].elementRef, found.error.details.matches[1].elementRef)
    } finally { form.restore() }
  })

  it('limits the unique deepest matches without returning ancestors', async () => {
    const form = await authorizedForm()
    try {
      form.window.document.body.insertAdjacentHTML('beforeend',
        '<main>' + '<button><span>批量导入</span></button>'.repeat(3) + '</main>')
      const result = new form.window.Function(`return (${findProgram({ by: 'text', value: '批量导入' }, 2)})`)()
      assert.equal(result.ok, true)
      assert.equal(result.value.matches.length, 2)
      assert.equal(result.value.limitReached, true)
      assert.equal(result.value.ambiguous, true)
      assert.ok(result.value.matches.every(match => match.tag === 'span'))
      assert.notEqual(result.value.matches[0].elementRef, result.value.matches[1].elementRef)
    } finally { form.restore() }
  })

  for (const query of [
    { by: 'text', value: '批量导入' },
    { by: 'attr', name: 'class', value: 'dup' },
  ]) {
    it(`does not turn two ${query.by} matches into a single target at limit one`, async () => {
      const form = await authorizedForm({ findMaxMatches: 1 })
      try {
        form.window.document.body.insertAdjacentHTML('beforeend',
          '<main><button><span>批量导入</span></button><button><span>批量导入</span></button></main>')
        const found = await form.invoke('browser_find', query)
        assert.equal(found.ok, false, 'the output limit must not grant a unique target')
        assert.equal(found.error.code, 'ambiguous_match')
        assert.equal(found.error.details.matches.length, 1, 'candidate details still respect the configured limit')
        assert.match(found.error.message, /multiple elements/i)
      } finally { form.restore() }
    })
  }

  it('still locates a genuinely unique target at limit one', async () => {
    const form = await authorizedForm({ findMaxMatches: 1 })
    try {
      const found = await form.invoke('browser_find', { by: 'attr', name: 'id', value: 'mode' })
      assert.equal(found.ok, true)
      assert.equal(found.value.match.tag, 'select')
    } finally { form.restore() }
  })

  it('refuses a stale observation after the document changes', async () => {
    const form = await authorizedForm()
    try {
      const found = await form.invoke('browser_find', { by: 'attr', name: 'id', value: 'mode' })
      assert.equal(found.ok, true)
      // Simulate a document replacement: the token minted for the old document
      // no longer identifies the page the action would run against.
      const acted = await form.invoke('browser_act', {
        documentToken: 'doc-that-is-gone',
        elementRef: found.value.match.elementRef,
        action: 'select',
        value: 'safe',
      })
      assert.equal(acted.ok, false)
      assert.equal(acted.error.code, 'stale_observation')
      assert.equal(form.window.document.getElementById('mode').value, 'fast',
        'a refused action must not change the page')
    } finally { form.restore() }
  })

  it('refuses an action on an element reference from another document', async () => {
    const form = await authorizedForm()
    try {
      const found = await form.invoke('browser_find', { by: 'attr', name: 'id', value: 'mode' })
      assert.equal(found.ok, true)
      const acted = await form.invoke('browser_act', {
        documentToken: found.value.documentToken,
        elementRef: 'el-does-not-exist',
        action: 'click',
      })
      assert.equal(acted.ok, false)
      assert.equal(acted.error.code, 'stale_observation')
    } finally { form.restore() }
  })

  it('waits for a condition that becomes true and then reports it', async () => {
    const form = await authorizedForm()
    try {
      // The fixture flips #status to "ready" after 150ms.
      const found = await form.invoke('browser_find', { by: 'attr', name: 'id', value: 'status' })
      assert.equal(found.ok, true)
      const waited = await form.invoke('browser_wait', {
        documentToken: found.value.documentToken,
        elementRef: found.value.match.elementRef,
        condition: 'text',
        text: 'ready',
        timeoutMs: 5_000,
      })
      assert.equal(waited.ok, true, `wait failed: ${JSON.stringify(waited.error)}`)
      assert.equal(form.window.document.getElementById('status').textContent, 'ready')
    } finally { form.restore() }
  })

  it('reports a wait that cannot be satisfied instead of hanging', async () => {
    const form = await authorizedForm()
    try {
      const found = await form.invoke('browser_find', { by: 'attr', name: 'id', value: 'status' })
      assert.equal(found.ok, true)
      const started = Date.now()
      const waited = await form.invoke('browser_wait', {
        documentToken: found.value.documentToken,
        elementRef: found.value.match.elementRef,
        condition: 'text',
        text: 'never-appears',
        timeoutMs: 300,
      })
      const elapsed = Date.now() - started
      // An unsatisfied wait is a normal, bounded outcome — not an error: the
      // page reports `satisfied: false` with `timedOut: true` so the caller can
      // decide what to do. Only a stale document is a refusal.
      assert.equal(waited.ok, true, `wait failed: ${JSON.stringify(waited.error)}`)
      assert.equal(waited.value.satisfied, false)
      assert.equal(waited.value.timedOut, true)
      assert.ok(elapsed < 5_000, `the wait must be bounded, took ${String(elapsed)}ms`)
      assert.equal(form.window.document.getElementById('status').textContent, 'ready',
        'a wait must not modify the page')
    } finally { form.restore() }
  })
})
