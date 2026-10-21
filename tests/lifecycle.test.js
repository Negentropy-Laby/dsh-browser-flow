/**
 * Connection and navigation lifecycle shared by Host and Client.
 *
 * Two rows are easy to get subtly wrong. A same-origin reload keeps the guest and
 * the element, so the Host retains the grant and only retires observations — the
 * panel must follow that verdict instead of dropping a grant the user still
 * holds. A lost and restored channel must open a NEW connection generation,
 * because it cannot silently resume the old binding.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createControlState } from '../src/state.js'
import { resolveConfig } from '../src/config.ts'
import { navigationEvent } from '../src/clientcore.js'

const page = {
  lease: 'guest-1', partition: 'part-1', url: 'https://a.test/x',
  documentToken: 'doc-1', tabId: 'tab-1',
}
const agent = { id: 'session-1' }

/**
 * Build a state with one authorized page.
 * @returns {object} fixtures.
 */
function ready() {
  const state = createControlState()
  const limits = resolveConfig({})
  state.registerConnection({
    kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'session-1',
    panel: { instanceId: 'panel-1', pages: [page] },
  })
  const granted = state.authorize({
    connectionInstanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
    agentInstanceToken: 'token-1', agent,
    lease: page.lease, partition: page.partition, documentToken: page.documentToken, tabId: page.tabId,
  })
  assert.equal(granted.ok, true)
  return { state, limits, lease: state.leaseFor(agent, 'token-1', 'session-1') }
}

/**
 * Report one invalidation and return the affected entry.
 * @param {object} state - control state.
 * @param {string} event - event name.
 * @returns {any} the affected entry.
 */
function report(state, event) {
  const answer = state.reportInvalidation('panel-1', 1, page.lease, event)
  assert.equal(answer.ok, true, `invalidate failed: ${JSON.stringify(answer)}`)
  return answer.value.affected[0]
}

describe('a same-origin reload keeps the grant', () => {
  it('retains control and advances the epoch so earlier observations are stale', () => {
    const { state, lease } = ready()
    const before = lease.epoch
    const affected = report(state, 'same_origin_navigation')
    assert.equal(affected.state, 'active', 'same-origin reload keeps control')
    assert.notEqual(affected.epoch, before, 'earlier observations must be stale')
    const after = state.leaseFor(agent, 'token-1', 'session-1')
    assert.notEqual(after, undefined, 'the grant survives')
    assert.equal(after.epoch, affected.epoch)
  })

  it('refuses a queued command from before the reload without dispatching it', async () => {
    const { state, limits, lease } = ready()
    // Hold the page busy, then queue behind it.
    const blocking = state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    state.takeCommands('panel-1', 1, limits)
    const queued = state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    report(state, 'same_origin_navigation')
    const outcome = await queued
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'stale_observation', 'a queued command must not run against the new document')
    state.revoke({ controlLeaseId: 'lease-1' }, 'test cleanup')
    await blocking
  })

  it('ends control when the navigation crosses origins', () => {
    const { state, lease } = ready()
    const affected = report(state, 'cross_origin_navigation')
    assert.notEqual(affected.state, 'active', 'a cross-origin navigation ends the grant')
    assert.equal(state.leaseFor(agent, 'token-1', 'session-1'), undefined,
      'the next action requires a fresh authorization')
    assert.equal(lease.epoch >= 0, true)
  })

  it('classifies the same navigation the same way on the panel side', () => {
    assert.equal(navigationEvent('https://a.test/x', 'https://a.test/y'), 'same_origin_navigation')
    assert.equal(navigationEvent('https://a.test/x', 'https://b.test/x'), 'cross_origin_navigation')
  })
})

describe('a restored channel opens a new generation', () => {
  it('retires the leases of the previous generation', () => {
    const { state } = ready()
    assert.equal(state.leaseCountForSession('session-1'), 1)
    // Reconnect uses a new generation.
    const rejoined = state.registerConnection({
      kind: 'hello', protocolVersion: 3, connectionGeneration: 2, sessionId: 'session-1',
      panel: { instanceId: 'panel-1', pages: [page] },
    })
    assert.equal(rejoined.ok, true)
    assert.equal(state.leaseCountForSession('session-1'), 0, 'reconnect cannot inherit control')
    assert.equal(state.leaseFor(agent, 'token-1', 'session-1'), undefined,
      'the user must allow control again after a reconnect')
  })

  it('refuses a poll that names the generation it replaced', () => {
    const { state, limits } = ready()
    state.registerConnection({
      kind: 'hello', protocolVersion: 3, connectionGeneration: 2, sessionId: 'session-1',
      panel: { instanceId: 'panel-1', pages: [page] },
    })
    const current = state.takeCommands('panel-1', 2, limits)
    assert.equal(current.ok, true, 'the new generation is the current one')
    const stale = state.takeCommands('panel-1', 1, limits)
    assert.equal(stale.ok, false, 'the superseded generation must not poll as current')
    assert.equal(stale.error.code, 'connection_stale')
  })
})

describe('a retained grant keeps working on the new document', () => {
  /**
   * Report one invalidation that carries the new document identity.
   * @param {object} state - control state.
   * @param {string} event - event name.
   * @param {string} token - the document now in the guest.
   * @returns {any} the affected entry.
   */
  function reportWithToken(state, event, token) {
    const answer = state.reportInvalidation('panel-1', 1, page.lease, event, token)
    assert.equal(answer.ok, true, JSON.stringify(answer))
    return answer.value.affected[0]
  }

  it('accepts a result from the new document after a same-origin reload', async () => {
    const { state, limits } = ready()
    const affected = reportWithToken(state, 'same_origin_navigation', 'doc-2')
    assert.equal(affected.state, 'active', 'control is retained')

    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    const pending = state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const command = state.takeCommands('panel-1', 1, limits).value.commands[0]
    // The panel reports a result from the document now on screen.
    const settled = state.settle({
      kind: 'result', id: command.id, leaseId: command.leaseId, instanceId: 'panel-1',
      connectionGeneration: command.connectionGeneration,
      epoch: command.epoch, sequence: command.sequence,
      outcome: 'ok', payload: { documentToken: 'doc-2' },
    }, limits)
    assert.equal(settled.ok, true, `settle refused: ${JSON.stringify(settled)}`)
    const outcome = await pending
    assert.equal(outcome.ok, true,
      'a retained grant must be able to act on the document that replaced the old one')
  })

  it('still refuses a result whose document is neither the old one nor the one reported', async () => {
    const { state, limits } = ready()
    reportWithToken(state, 'same_origin_navigation', 'doc-2')
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    const pending = state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const command = state.takeCommands('panel-1', 1, limits).value.commands[0]
    state.settle({
      kind: 'result', id: command.id, leaseId: command.leaseId, instanceId: 'panel-1',
      connectionGeneration: command.connectionGeneration,
      epoch: command.epoch, sequence: command.sequence,
      outcome: 'ok', payload: { documentToken: 'doc-3' },
    }, limits)
    const outcome = await pending
    assert.equal(outcome.ok, false, 'an unexpected document must still be refused')
    assert.equal(outcome.error.code, 'stale_observation')
  })
})

describe('revoked leases do not accumulate', () => {
  it('keeps the newest revoked leases describable and drops the oldest', () => {
    const state = createControlState()
    const limits = resolveConfig({})
    state.registerConnection({
      kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'session-1',
      panel: { instanceId: 'panel-1', pages: [] },
    })
    // Forty grant-and-revoke cycles: far more history than the Host should keep.
    for (let index = 0; index < 40; index += 1) {
      const guest = 'guest-' + String(index)
      state.registerConnection({
        kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'session-1',
        panel: { instanceId: 'panel-1', pages: [{ lease: guest, partition: 'part-1', url: 'https://a.test/x' + String(index), documentToken: 'doc-' + String(index), tabId: 'tab-' + String(index) }] },
      })
      const granted = state.authorize({
        connectionInstanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
        agentInstanceToken: 'token-1', agent,
        lease: guest, partition: 'part-1', documentToken: 'doc-' + String(index), tabId: 'tab-' + String(index),
      })
      assert.equal(granted.ok, true, 'grant ' + String(index) + ' failed')
      state.revoke({ controlLeaseId: granted.value.controlLeaseId }, 'test cleanup')
    }
    // Bounded: the map must not grow with every grant the user ever made.
    assert.ok(state.leaseCount() <= 32, 'revoked history is unbounded: ' + String(state.leaseCount()))
    // The newest is still describable, so a late caller sees 'revoked'.
    const newest = state.describeLease('lease-40')
    assert.notEqual(newest, undefined, 'the most recent revoked lease must still be describable')
    assert.equal(newest.state, 'revoked')
    // The oldest has been dropped, so it reads as a lease that no longer exists.
    assert.equal(state.describeLease('lease-1'), undefined, 'very old revoked leases are dropped')
    // No active lease was collateral damage.
    assert.equal(state.leaseCountForSession('session-1'), 0)
    assert.equal(limits.commandBudgetMs > 0, true)
  })

  it('never prunes an active lease', () => {
    const state = createControlState()
    state.registerConnection({
      kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'session-1',
      panel: { instanceId: 'panel-1', pages: [] },
    })
    // One live grant, then enough churn to trigger pruning.
    state.registerConnection({
      kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'session-1',
      panel: { instanceId: 'panel-1', pages: [{ lease: 'keep', partition: 'part-1', url: 'https://a.test/keep', documentToken: 'doc-keep', tabId: 'tab-keep' }] },
    })
    const live = state.authorize({
      connectionInstanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
      agentInstanceToken: 'token-1', agent,
      lease: 'keep', partition: 'part-1', documentToken: 'doc-keep', tabId: 'tab-keep',
    })
    assert.equal(live.ok, true)
    const churnAgent = { id: 'session-churn' }
    for (let index = 0; index < 40; index += 1) {
      const guest = 'churn-' + String(index)
      state.registerConnection({
        kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'session-churn',
        panel: { instanceId: 'panel-churn', pages: [{ lease: guest, partition: 'part-1', url: 'https://a.test/c' + String(index), documentToken: 'doc-c' + String(index), tabId: 'tab-c' + String(index) }] },
      })
      const granted = state.authorize({
        connectionInstanceId: 'panel-churn', connectionGeneration: 1, sessionId: 'session-churn',
        agentInstanceToken: 'token-churn', agent: churnAgent,
        lease: guest, partition: 'part-1', documentToken: 'doc-c' + String(index), tabId: 'tab-c' + String(index),
      })
      state.revoke({ controlLeaseId: granted.value.controlLeaseId }, 'test cleanup')
    }
    assert.equal(state.leaseCountForSession('session-1'), 1, 'the live grant must survive the churn')
    assert.equal(state.describeLease(live.value.controlLeaseId).state, 'active')
  })
})
