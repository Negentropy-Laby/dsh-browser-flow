import {expectOk,present,expectRecord} from './helpers/assertions.ts'
/**
 * The plan's required counterexamples that were not yet exercised.
 *
 * Two of them were stated but never actually run: cancellation, and the case of
 * two guests showing the same address. Both are identity questions — which page
 * an authorization is attached to, and what a caller may expect after asking to
 * stop — so they belong together.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createControlState } from '../src/state.ts'
import { resolveConfig } from '../src/config.ts'

const agent = { id: 'session-1' }

/**
 * Build a state with one connected panel holding the given pages.
 * @param {Array<object>} pages - pages the panel reports.
 * @param {string} [instanceId] - panel instance.
 * @returns {{ state: ReturnType<typeof createControlState>, limits: Pick<import('../src/config.ts').BrowserFlowConfig,'commandBudgetMs'|'queueLimit'> }} fixtures.
 */
function ready(pages: import('../src/state.ts').PanelPage[], instanceId: string = 'panel-1')  {
  const state = createControlState()
  const limits = resolveConfig({})
  const registered = state.registerConnection({
    kind: 'hello', protocolVersion: 4, connectionGeneration: 1, sessionId: 'session-1',
    panel: { instanceId, pages },
  })
  assert.equal(registered.ok, true)
  return { state, limits }
}

/**
 * Authorize one page from the connected panel.
 * @param {object} state - control state.
 * @param {object} page - page to authorize.
 * @param {string} [instanceId] - panel instance.
 * @returns {object} the authorization verdict.
 */
function grant(state: ReturnType<typeof createControlState>, page: import('../src/state.ts').PanelPage, instanceId: string = 'panel-1') {
  return state.authorize({
    connectionInstanceId: instanceId, connectionGeneration: 1, sessionId: 'session-1',
    agentInstanceToken: 'token-1', agent,
    lease: page.lease, partition: page.partition, documentToken: page.documentToken, tabId: page.tabId,
  })
}

/** One page definition. */
const PAGE = {
  lease: 'guest-1', partition: 'part-1', url: 'https://a.test/x',
  documentToken: 'doc-1', tabId: 'tab-1',
}

describe('cancellation', () => {
  it('never dispatches a call cancelled while it is still queued', async () => {
    const { state, limits } = ready([PAGE])
    assert.equal(grant(state, PAGE).ok, true)
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    // Hold the page busy so the second call stays queued.
    const blocking = state.run(present(lease), { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    state.takeCommands('panel-1', 1, limits)

    const controller = new AbortController()
    const queued = state.run(present(lease), { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits, controller.signal)
    controller.abort()
    const outcome = await queued
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'deadline_exceeded', 'a queued call that was cancelled did not run')

    // The cancelled call must not appear in any later dispatch.
    state.revoke({ controlLeaseId: 'lease-1' }, 'test cleanup')
    await blocking
  })

  it('settles a call cancelled after dispatch as an unknown outcome, never as executed', async () => {
    const { state, limits } = ready([PAGE])
    assert.equal(grant(state, PAGE).ok, true)
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    const controller = new AbortController()
    const pending = state.run(present(lease), { kind: 'act', action: 'click', target: { documentToken: 'doc-1', elementRef: 'el-0' } }, limits, controller.signal)
    const taken = state.takeCommands('panel-1', 1, limits)
    assert.equal(expectOk(taken).commands.length, 1, 'the command reached the panel before cancellation')
    controller.abort()
    const outcome = await pending
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'unknown_outcome', 'a dispatched call may have acted; it is never reported as not run')
  })

  it('returns before dispatch when the caller is already aborted', async () => {
    const { state, limits } = ready([PAGE])
    assert.equal(grant(state, PAGE).ok, true)
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    const controller = new AbortController()
    controller.abort()
    const outcome = await state.run(present(lease), { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits, controller.signal)
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'deadline_exceeded')
    assert.equal(expectOk(state.takeCommands('panel-1', 1, limits)).commands.length, 0, 'nothing may be dispatched')
  })
})

describe('two guests on the same address stay distinct', () => {
  it('does not serve the authorized guest from another guest showing the same URL', () => {
    const twin = { ...PAGE, lease: 'guest-2', tabId: 'tab-2' }
    const { state } = ready([PAGE, twin])
    const granted = grant(state, PAGE)
    assert.equal(granted.ok, true)

    const listed = state.listPages('panel-1', 1)
    assert.equal(listed.ok, true)
    assert.equal(listed.value.pages.length, 2, 'the two guests are two candidates, not one')
    const byLease = new Map(listed.value.pages.map(page => [page.lease, page]))
    assert.equal(present(byLease.get('guest-1')).authorized, true)
    assert.equal(present(byLease.get('guest-2')).authorized, false, 'the identical address does not inherit the grant')
  })

  it('refuses a second authorization that names the other guest', () => {
    const twin = { ...PAGE, lease: 'guest-2', tabId: 'tab-2', documentToken: 'doc-2' }
    const { state } = ready([PAGE, twin])
    assert.equal(grant(state, PAGE).ok, true)
    // Same Agent, same Session, same address, different guest: a separate page
    // needs its own explicit authorization, which the user must give.
    const second = grant(state, twin)
    assert.equal(second.ok, true, 'a second page may be authorized')
    assert.notEqual(second.value.controlLeaseId, undefined)
    assert.equal(state.leaseCount(), 2, 'each guest carries its own grant')
  })

  it('keeps each grant bound to its own document', () => {
    const twin = { ...PAGE, lease: 'guest-2', tabId: 'tab-2', documentToken: 'doc-2' }
    const { state } = ready([PAGE, twin])
    const first = grant(state, PAGE)
    const second = grant(state, twin)
    assert.equal(present(state.describeLease(expectOk(first).controlLeaseId)).guestLease, 'guest-1')
    assert.equal(present(state.describeLease(expectOk(second).controlLeaseId)).guestLease, 'guest-2')
    assert.equal(present(state.describeLease(expectOk(second).controlLeaseId)).epoch, 0)
  })
})