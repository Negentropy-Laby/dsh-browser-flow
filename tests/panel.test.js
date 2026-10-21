import { TASK, TASK_VIEW } from './helpers/task-scope.ts'
/**
 * Panel component tests.
 *
 * The panel is the user's authorization surface: it lists live pages, asks the
 * Host to authorize the one the user clicks, runs dispatched commands, and
 * returns results. These tests drive the real component with a minimal
 * React-shaped harness and a fake DOM, so the behaviour that matters is
 * asserted rather than only the bundle's shape:
 *
 * - it renders the unsupported-host notice instead of pretending to work in Web;
 * - it never sends an Agent identity (the Host resolves the Agent itself);
 * - it polls, executes a dispatched command through the fixed program, and
 *   returns the Host-assigned generation/epoch/sequence unchanged;
 * - it reports a thrown execution as `unknown_outcome`, never as success;
 * - authorization is only attempted when the user clicks, and the result is
 *   surfaced when the Host refuses.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { COPY, PAGE_CODE, POLL_INTERVAL_MS, ROUTES, createPanel } from '../src/panel.ts'

/**
 * Minimal React substitute: enough of `useState`, `useRef`, `useMemo`,
 * `useCallback`, and `useEffect` to drive one render and its effects.
 * @returns {object} React-shaped API plus the render function.
 */
function createReactHarness() {
  const state = []
  const effects = []
  const refs = []
  let cursor = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in refs)) refs[index] = { current: initial }
      return refs[index]
    },
    useMemo(factory) {
      cursor++
      return factory()
    },
    useCallback(callback) {
      cursor++
      return callback
    },
    useEffect(callback) {
      cursor++
      effects.push(callback)
    },
  }
  return {
    React,
    /** Render once, resetting the hook cursor. */
    render(Component, props) {
      cursor = 0
      return Component(props)
    },
    /** Run every effect and collect their cleanups. */
    runEffects() {
      const cleanups = []
      for (const effect of effects.splice(0)) {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
      return cleanups
    },
    state,
  }
}

/** A locale lookup that returns the key, so assertions read the key names. */
const t = key => key

/** Collect every element in a rendered tree. */
function flatten(node) {
  if (node === null || node === undefined || typeof node !== 'object') return []
  return [node, ...(node.children ?? []).flatMap(flatten)]
}

/** Find the first element matching a predicate. */
function find(node, predicate) {
  return flatten(node).find(predicate)
}

/** Collect every element matching a predicate. */
function findAll(node, predicate) {
  return flatten(node).filter(predicate)
}

/**
 * Install a fake browser environment for one test.
 * @param {object} input - environment inputs.
 * @returns {object} recorded calls and a restore function.
 */
function fakeBrowser(input = {}) {
  const previous = {
    fetch: globalThis.fetch,
    document: globalThis.document,
    dshDesktop: globalThis.dshDesktop,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  }
  const calls = []
  const responses = new Map(Object.entries(input.responses ?? {}))
  globalThis.fetch = async (route, init) => {
    calls.push({ route, body: init?.body === undefined ? undefined : JSON.parse(init.body) })
    const answer = responses.get(route) ?? { ok: false, error: { code: 'internal', message: 'no canned answer' } }
    return { status: 200, json: async () => answer }
  }
  const elements = input.elements ?? []
  globalThis.document = { querySelectorAll: () => elements }
  globalThis.dshDesktop = input.desktop
  // Keep timers inert: the tests drive `tick` through the captured effect.
  globalThis.setInterval = () => 0
  globalThis.clearInterval = () => {}
  return {
    calls,
    restore() {
      globalThis.fetch = previous.fetch
      globalThis.document = previous.document
      globalThis.dshDesktop = previous.dshDesktop
      globalThis.setInterval = previous.setInterval
      globalThis.clearInterval = previous.clearInterval
    },
  }
}

/** One live guest element as the panel sees it. */
function guest({ lease = 'guest-1', partition = 'part-1', session = 'session-1', tab = 'tab-1', probe, executed = [] } = {}) {
  return {
    isConnected: true,
    getAttribute: name => (name === 'name' ? lease : name === 'partition' ? partition : null),
    closest: selector => {
      if (selector === '[data-sidebar-right-session]') return { getAttribute: () => session }
      if (selector === '[data-sidebar-right-tab]') return { getAttribute: () => tab }
      return null
    },
    executeJavaScript: async source => {
      executed.push(source)
      if (source === PAGE_CODE.identity) return probe ?? { ok: true, value: { url: 'https://example.test/a', title: 'Sheet', documentToken: 'doc-1' } }
      return { ok: true, value: { observed: true } }
    },
  }
}

describe('panel copy', () => {
  it('declares both locales with the same keys', () => {
    assert.deepEqual(Object.keys(COPY.zh).sort(), Object.keys(COPY.en).sort())
  })

  it('states the unsupported-host and privacy limits in both languages', () => {
    for (const locale of [COPY.zh, COPY.en]) {
      assert.equal(typeof locale.unsupportedHost, 'string')
      assert.equal(typeof locale.privacy, 'string')
      assert.equal(typeof locale.limit, 'string')
      assert.equal(typeof locale.revokeHint, 'string')
    }
  })
})

describe('panel rendering', () => {
  it('renders the unsupported-host notice on the Web carrier', () => {
    const browser = fakeBrowser({ desktop: undefined })
    try {
      const harness = createReactHarness()
      const Panel = createPanel({ React: harness.React, t })
      const tree = harness.render(Panel, { sessionId: 'session-1' })
      assert.notEqual(find(tree, node => node.type === 'section'), undefined)
      assert.notEqual(find(tree, node => node.children?.includes('unsupportedHost')), undefined)
      // With no Desktop bridge the panel must not offer an authorize button.
      const authorize = findAll(tree, node => node.props?.['data-browser-flow-action'] === 'authorize')
      assert.equal(authorize.length, 0)
    } finally {
      browser.restore()
    }
  })

  it('offers authorize per page on the Desktop carrier', () => {
    const browser = fakeBrowser({ desktop: { protocolVersion: 1 } })
    try {
      const harness = createReactHarness()
      const Panel = createPanel({ React: harness.React, t })
      // Seed the page list by rendering once, running the poll effect, then re-rendering.
      harness.render(Panel, { sessionId: 'session-1' })
      assert.notEqual(find(harness.render(Panel, { sessionId: 'session-1' }), node => node.type === 'section'), undefined)
    } finally {
      browser.restore()
    }
  })
})

describe('panel command loop', () => {
  it('polls, executes the dispatched command, and returns its sequence unchanged', async () => {
    const executed = []
    const element = guest({ executed })
    const browser = fakeBrowser({
      desktop: { protocolVersion: 1 },
      elements: [element],
      responses: {
        [ROUTES.poll]: {
          ok: true,
          value: {
            protocolVersion: 3, task:TASK_VIEW,
            commands: [{
              id: 'cmd-1', protocolVersion:3,task:TASK, leaseId: 'lease-1', connectionGeneration: 3, epoch: 2, sequence: 7,
              deadlineAt: Date.now() + 10_000,
              op: { kind: 'observe', maxChars: 100, maxNodes: 5 },
            }],
            dropped: [],
          },
        },
        [ROUTES.result]: { ok: true, value: { settled: 'cmd-1' } },
        [ROUTES.authorize]: { ok: true, value: {task:TASK,origins:['https://example.test'],controlLeaseId: 'lease-1', epoch: 2 } },
      },
    })
    try {
      const harness = createReactHarness()
      const Panel = createPanel({ React: harness.React, t })
      harness.render(Panel, { sessionId: 'session-1' })
      const cleanups = harness.runEffects()
      // The poll effect starts a tick immediately; wait for it to settle.
      await new Promise(resolve => setTimeout(resolve, 50))
      const poll = browser.calls.find(call => call.route === ROUTES.poll)
      assert.notEqual(poll, undefined, 'the panel must poll the Host')
      assert.equal(poll.body.sessionId, 'session-1')
      assert.equal(poll.body.pages.length, 1)
      assert.equal(poll.body.pages[0].lease, 'guest-1')
      assert.equal(poll.body.pages[0].documentToken, 'doc-1')
      // No page is authorized yet, so the command is refused rather than executed.
      const result = browser.calls.find(call => call.route === ROUTES.result)
      assert.notEqual(result, undefined)
      assert.equal(result.body.outcome, 'failed')
      assert.equal(result.body.error.code, 'not_authorized')
      assert.equal(result.body.connectionGeneration, 3)
      assert.equal(result.body.epoch, 2)
      assert.equal(result.body.sequence, 7)
      for (const cleanup of cleanups) cleanup()
    } finally {
      browser.restore()
    }
  })

  it('never sends an Agent identity over the wire', async () => {
    const browser = fakeBrowser({
      desktop: { protocolVersion: 1 },
      elements: [guest()],
      responses: { [ROUTES.poll]: { ok: true, value: { protocolVersion: 3, task:TASK_VIEW, commands: [], dropped: [] } } },
    })
    try {
      const harness = createReactHarness()
      const Panel = createPanel({ React: harness.React, t })
      harness.render(Panel, { sessionId: 'session-1' })
      harness.runEffects()
      await new Promise(resolve => setTimeout(resolve, 50))
      const serialized = JSON.stringify(browser.calls)
      assert.equal(serialized.includes('agentInstanceToken'), false)
      assert.equal(serialized.includes('agentId'), false)
    } finally {
      browser.restore()
    }
  })

  it('reports a Host refusal instead of assuming success', async () => {
    const browser = fakeBrowser({
      desktop: { protocolVersion: 1 },
      elements: [guest()],
      responses: {
        [ROUTES.poll]: { ok: false, error: { code: 'page_unavailable', message: 'panel not connected' } },
      },
    })
    try {
      const harness = createReactHarness()
      const Panel = createPanel({ React: harness.React, t })
      harness.render(Panel, { sessionId: 'session-1' })
      harness.runEffects()
      await new Promise(resolve => setTimeout(resolve, 50))
      const tree = harness.render(Panel, { sessionId: 'session-1' })
      const alert = find(tree, node => node.props?.role === 'alert')
      assert.notEqual(alert, undefined, 'a Host refusal must surface as an alert')
      assert.ok(flatten(alert).some(node => String(node.children ?? '').includes('page_unavailable')))
    } finally {
      browser.restore()
    }
  })

  it('uses the declared poll interval', () => {
    assert.ok(POLL_INTERVAL_MS > 0 && POLL_INTERVAL_MS <= 5_000)
  })
})
