import {expectOk,expectFailure,present} from './helpers/assertions.ts'
/**
 * Control-state tests.
 *
 * These cover the P0 properties the plugin claims: an unauthorized caller
 * cannot read or write, a different Agent instance cannot inherit control, a
 * stale epoch or generation cannot dispatch, duplicate and out-of-order results
 * are refused, an expired command is never dispatched, a cancellation before
 * dispatch is provable, and revocation detaches control without touching the
 * page.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createControlState } from '../src/state.ts'

/** Deterministic clock for deadline tests. */
function clock(start = 0) {
  let value = start
  return {
    now: () => value,
    advance: (milliseconds:number) => { value += milliseconds },
  }
}

/** Config used by the state machine in tests. */
const LIMITS = {
  commandBudgetMs: 1000,
  observeMaxChars: 1000,
  observeMaxNodes: 50,
  findMaxMatches: 20,
  waitMaxMs: 500,
  queueLimit: 2,
  pollWaitMs: 5000,
  connectionIdleMs: 60_000,
}

/** One page description as the panel reports it. */
function page(overrides = {}) {
  return {
    lease: 'guest-1',
    partition: 'part-1',
    url: 'https://example.test/a',
    documentToken: 'doc-1',
    sessionId: 'session-1',
    ...overrides,
  }
}

/** A hello envelope. */
function hello(overrides = {}) {
  return {
    kind: 'hello',
    protocolVersion: 3,
    connectionGeneration: 1,
    sessionId: 'session-1',
    panel: { instanceId: 'panel-1', pages: [page()] },
    ...overrides,
  }
}

/**
 * Build a state with one registered panel and one authorized lease.
 * @param {object} [options] - options.
 * @returns {object} fixture.
 */
function fixture(options = {}) {
  const time = clock()
  const state = createControlState({ now: time.now })
  const agent = { id: 'session-1', marker: 'agent' }
  state.registerConnection(hello())
  const authorized = state.authorize({
    sessionId: 'session-1',
    agentInstanceToken: 'token-1',
    agent,
    connectionInstanceId: 'panel-1',
    connectionGeneration: 1,
    lease: 'guest-1',
    partition: 'part-1',
    documentToken: 'doc-1',
    tabId: 'tab-1',
  })
  assert.equal(authorized.ok, true, 'fixture authorization must succeed')
  const lease = state.leaseFor(agent, 'token-1', 'session-1')
  assert.notEqual(lease, undefined)
  return { state, time, agent, lease, authorized: authorized.value, ...options }
}

describe('authorization', () => {
  it('refuses authorization before any panel connection exists', () => {
    const state = createControlState()
    const verdict = state.authorize({
      sessionId: 'session-1', agentInstanceToken: 't', agent: {},
      connectionInstanceId: 'panel-1', connectionGeneration: 1,
      lease: 'guest-1', partition: 'part-1', documentToken: 'doc-1',
    })
    assert.equal(verdict.ok, false)
    assert.equal(verdict.error.code, 'connection_stale')
  })

  it('refuses a page the panel does not report', () => {
    const state = createControlState()
    state.registerConnection(hello())
    const verdict = state.authorize({
      sessionId: 'session-1', agentInstanceToken: 't', agent: {},
      connectionInstanceId: 'panel-1', connectionGeneration: 1,
      lease: 'guest-elsewhere', partition: 'part-1', documentToken: 'doc-1',
    })
    assert.equal(verdict.ok, false)
    assert.equal(verdict.error.code, 'page_unavailable')
  })

  it('refuses a partition that does not match the reported page', () => {
    const state = createControlState()
    state.registerConnection(hello())
    const verdict = state.authorize({
      sessionId: 'session-1', agentInstanceToken: 't', agent: {},
      connectionInstanceId: 'panel-1', connectionGeneration: 1,
      lease: 'guest-1', partition: 'other-partition', documentToken: 'doc-1',
    })
    assert.equal(verdict.ok, false)
    assert.equal(verdict.error.code, 'page_replaced')
  })

  it('refuses a second Agent instance on the same page and allows the same one to re-authorize', () => {
    const { state, agent } = fixture()
    const otherAgent = { id: 'session-1', marker: 'other' }
    const conflicting = state.authorize({
      sessionId: 'session-1', agentInstanceToken: 'token-2', agent: otherAgent,
      connectionInstanceId: 'panel-1', connectionGeneration: 1,
      lease: 'guest-1', partition: 'part-1', documentToken: 'doc-1',
    })
    assert.equal(conflicting.ok, false)
    assert.equal(conflicting.error.code, 'not_authorized')

    const again = state.authorize({
      sessionId: 'session-1', agentInstanceToken: 'token-1', agent,
      connectionInstanceId: 'panel-1', connectionGeneration: 1,
      lease: 'guest-1', partition: 'part-1', documentToken: 'doc-2',
    })
    assert.equal(again.ok, true)
    assert.equal(again.value.documentToken, 'doc-2')
    assert.equal(again.value.epoch, 1)
  })
})

describe('lease lookup', () => {
  it('binds the exact Agent object, not just the Session id', () => {
    const { state, lease } = fixture()
    assert.notEqual(lease, undefined)
    const impostor = { id: 'session-1', marker: 'impostor' }
    assert.equal(state.leaseFor(impostor, 'token-1', 'session-1'), undefined)
    assert.equal(state.leaseFor(present(lease).agent, 'wrong-token', 'session-1'), undefined)
    assert.equal(state.leaseFor(present(lease).agent, 'token-1', 'other-session'), undefined)
  })

  it('refuses a caller from another Session even with a valid token', () => {
    const { state } = fixture()
    const foreignAgent = { id: 'session-2', marker: 'foreign' }
    assert.equal(state.leaseFor(foreignAgent, 'token-1', 'session-2'), undefined)
  })
})

describe('page listing', () => {
  it('never lists pages of another panel instance', () => {
    const { state } = fixture()
    state.registerConnection(hello({ connectionGeneration: 1, panel: { instanceId: 'panel-2', pages: [page({ lease: 'guest-2' })] } }))
    const listed = state.listPages('panel-2', 1)
    assert.equal(listed.ok, true)
    assert.deepEqual(listed.value.pages.map(entry => entry.tabId), ['guest-2'])
    assert.equal(listed.value.pages[0].authorized, false)
  })

  it('marks the authorized page and refuses a superseded generation', () => {
    const { state } = fixture()
    const listed = state.listPages('panel-1', 1)
    assert.equal(listed.ok, true)
    assert.equal(listed.value.pages[0].authorized, true)
    const stale = state.listPages('panel-1', 2)
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, 'connection_stale')
  })
})

describe('command dispatch', () => {
  it('refuses to run on a revoked lease', async () => {
    const { state, lease } = fixture()
    state.revoke({ controlLeaseId: present(lease).id }, 'test')
    const outcome = await state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'not_authorized')
  })

  it('refuses a call cancelled before dispatch', async () => {
    const { state, lease } = fixture()
    const controller = new AbortController()
    controller.abort()
    const outcome = await state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS, controller.signal)
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'deadline_exceeded')
  })

  it('serializes one command per lease and reports the overflow', async () => {
    const { state, lease } = fixture()
    const first = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    const second = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    const third = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    const overflow = await third
    assert.equal(overflow.ok, false)
    assert.equal(overflow.error.code, 'queue_full')
    const taken = state.takeCommands('panel-1', 1, LIMITS)
    assert.equal(taken.ok, true)
    assert.equal(taken.value.commands.length, 1)
    // Settle both queued commands so the test leaves no pending promise.
    const command = taken.value.commands[0]
    state.settle({
      kind: 'result', instanceId: 'panel-1', id: command.id, leaseId: present(lease).id, connectionGeneration: 1,
      epoch: 0, sequence: command.sequence, outcome: 'ok', payload: {},
    }, LIMITS)
    const next = state.takeCommands('panel-1', 1, LIMITS)
    const command2 = expectOk(next).commands[0]
    state.settle({
      kind: 'result', instanceId: 'panel-1', id: command2.id, leaseId: present(lease).id, connectionGeneration: 1,
      epoch: 0, sequence: command2.sequence, outcome: 'ok', payload: {},
    }, LIMITS)
    assert.equal((await first).ok, true)
    assert.equal((await second).ok, true)
  })

  it('assigns a strictly increasing sequence per lease', async () => {
    const { state, lease } = fixture()
    const pending = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    const first = expectOk(state.takeCommands('panel-1', 1, LIMITS)).commands[0]
    assert.equal(first.sequence, 0)
    state.settle({
      kind: 'result', instanceId: 'panel-1', id: first.id, leaseId: present(lease).id, connectionGeneration: 1,
      epoch: first.epoch, sequence: first.sequence, outcome: 'ok', payload: {},
    }, LIMITS)
    await pending
    const second = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    const command = expectOk(state.takeCommands('panel-1', 1, LIMITS)).commands[0]
    assert.equal(command.sequence, 1)
    state.settle({
      kind: 'result', instanceId: 'panel-1', id: command.id, leaseId: present(lease).id, connectionGeneration: 1,
      epoch: command.epoch, sequence: command.sequence, outcome: 'ok', payload: {},
    }, LIMITS)
    await second
  })

  it('never re-sends a command the panel already took', async () => {
    const { state, lease } = fixture()
    const pending = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    const first = state.takeCommands('panel-1', 1, LIMITS)
    assert.equal(expectOk(first).commands.length, 1)
    const second = state.takeCommands('panel-1', 1, LIMITS)
    assert.equal(expectOk(second).commands.length, 0)
    const command = expectOk(first).commands[0]
    state.settle({
      kind: 'result', instanceId: 'panel-1', id: command.id, leaseId: present(lease).id, connectionGeneration: 1,
      epoch: command.epoch, sequence: command.sequence, outcome: 'ok', payload: { documentToken: 'doc-1' },
    }, LIMITS)
    assert.equal((await pending).ok, true)
  })

  it('drops a command whose deadline passed before the panel took it', async () => {
    const { state, time, lease } = fixture()
    const pending = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    time.advance(LIMITS.commandBudgetMs + 1)
    const taken = state.takeCommands('panel-1', 1, LIMITS)
    assert.equal(expectOk(taken).commands.length, 0)
    assert.equal(expectOk(taken).dropped.length, 1)
    const outcome = await pending
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'deadline_exceeded')
  })

  it('reports unknown_outcome for a command cancelled after dispatch', async () => {
    const { state, lease } = fixture()
    const controller = new AbortController()
    const pending = state.run(present(lease), { kind: 'act', action: 'click', target: { documentToken: 'doc-1', elementRef: 'el-1' } }, LIMITS, controller.signal)
    const taken = state.takeCommands('panel-1', 1, LIMITS)
    assert.equal(expectOk(taken).commands.length, 1)
    controller.abort()
    const outcome = await pending
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'unknown_outcome')
  })

  it('reports a caller cancellation before dispatch as a plain failure, not unknown', async () => {
    const { state, lease } = fixture()
    // Occupy the lease so the second command stays queued.
    const running = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    const controller = new AbortController()
    const queued = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS, controller.signal)
    controller.abort()
    const outcome = await queued
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'deadline_exceeded')
    const command = expectOk(state.takeCommands('panel-1', 1, LIMITS)).commands[0]
    state.settle({
      kind: 'result', instanceId: 'panel-1', id: command.id, leaseId: present(lease).id, connectionGeneration: 1,
      epoch: command.epoch, sequence: command.sequence, outcome: 'ok', payload: {},
    }, LIMITS)
    await running
  })
})

describe('result settlement', () => {
  it('refuses a result from a superseded connection generation', async () => {
    const { state, lease } = fixture()
    const pending = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    const command = expectOk(state.takeCommands('panel-1', 1, LIMITS)).commands[0]
    // A new panel instance generation retires the previous one and its leases.
    state.registerConnection(hello({ connectionGeneration: 2 }))
    const settled = state.settle({
      kind: 'result', instanceId: 'panel-1', id: command.id, leaseId: present(lease).id, connectionGeneration: 1,
      epoch: command.epoch, sequence: command.sequence, outcome: 'ok', payload: {},
    }, LIMITS)
    assert.equal(settled.ok, false)
    const outcome = await pending
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'unknown_outcome')
  })

  it('refuses a duplicate result and keeps the first settlement', async () => {
    const { state, lease } = fixture()
    const pending = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    const command = expectOk(state.takeCommands('panel-1', 1, LIMITS)).commands[0]
    const payload = { documentToken: 'doc-1' }
    const first = state.settle({
      kind: 'result', instanceId: 'panel-1', id: command.id, leaseId: present(lease).id, connectionGeneration: 1,
      epoch: command.epoch, sequence: command.sequence, outcome: 'ok', payload,
    }, LIMITS)
    assert.equal(first.ok, true)
    const second = state.settle({
      kind: 'result', instanceId: 'panel-1', id: command.id, leaseId: present(lease).id, connectionGeneration: 1,
      epoch: command.epoch, sequence: command.sequence, outcome: 'ok', payload,
    }, LIMITS)
    assert.equal(second.ok, false)
    assert.equal(second.error.code, 'protocol_violation')
    assert.deepEqual(expectOk((await pending)), payload)
  })

  it('refuses an out-of-sequence result and resets the epoch', async () => {
    const { state, lease } = fixture()
    const pending = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    const command = expectOk(state.takeCommands('panel-1', 1, LIMITS)).commands[0]
    const settled = state.settle({
      kind: 'result', instanceId: 'panel-1', id: command.id, leaseId: present(lease).id, connectionGeneration: 1,
      epoch: command.epoch, sequence: command.sequence + 7, outcome: 'ok', payload: {},
    }, LIMITS)
    assert.equal(settled.ok, false)
    assert.equal(settled.error.code, 'protocol_violation')
    const outcome = await pending
    assert.equal(outcome.ok, false)
    assert.equal(present(state.describeLease(present(lease).id)).epoch, 1)
  })

  it('refuses a foreign epoch without changing the current authorization', async () => {
    const { state, lease } = fixture()
    const pending = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    const command = expectOk(state.takeCommands('panel-1', 1, LIMITS)).commands[0]
    const settled = state.settle({
      kind: 'result', instanceId: 'panel-1', id: command.id, leaseId: present(lease).id, connectionGeneration: 1,
      epoch: command.epoch + 5, sequence: command.sequence, outcome: 'ok', payload: {},
    }, LIMITS)
    assert.equal(settled.ok, false)
    assert.equal(settled.error.code, 'stale_observation')
    assert.equal(present(state.describeLease(present(lease).id)).epoch, 0)
    assert.equal(present(state.describeLease(present(lease).id)).inFlight, 1)
    assert.equal(state.settle({
      kind: 'result', instanceId: 'panel-1', id: command.id, leaseId: present(lease).id, connectionGeneration: 1,
      epoch: command.epoch, sequence: command.sequence, outcome: 'ok', payload: {},
    }, LIMITS).ok, true)
    assert.equal((await pending).ok, true)
  })

  it('refuses a result for a lease that never existed', () => {
    const { state } = fixture()
    const settled = state.settle({
      kind: 'result', instanceId: 'panel-1', id: 'cmd-x', leaseId: 'lease-x', connectionGeneration: 1,
      epoch: 0, sequence: 0, outcome: 'ok', payload: {},
    }, LIMITS)
    assert.equal(settled.ok, false)
    assert.equal(settled.error.code, 'stale_observation')
  })
})

describe('invalidation and revocation', () => {
  it('keeps control across an in-page document change but advances the epoch', () => {
    const { state, lease } = fixture()
    const applied = state.reportInvalidation('panel-1', 1, 'guest-1', 'document_replaced')
    assert.equal(applied.ok, true)
    assert.equal(applied.value.affected[0].state, 'active')
    assert.equal(applied.value.affected[0].epoch, 1)
    assert.equal(present(state.leaseFor(present(lease).agent, 'token-1', 'session-1')).epoch, 1)
  })

  it('invalidates control on a cross-origin navigation', () => {
    const { state, lease } = fixture()
    state.reportInvalidation('panel-1', 1, 'guest-1', 'cross_origin_navigation')
    assert.equal(state.leaseFor(present(lease).agent, 'token-1', 'session-1'), undefined)
    assert.equal(present(state.describeLease(present(lease).id)).revokedReason, 'cross_origin_navigation')
  })

  it('refuses an unknown invalidation event', () => {
    const { state } = fixture()
    const applied = state.reportInvalidation('panel-1', 1, 'guest-1', 'made-up-event')
    assert.equal(applied.ok, false)
    assert.equal(applied.error.code, 'invalid_request')
  })

  it('revokes every lease of one Session and keeps the page', () => {
    const { state, lease } = fixture()
    const revoked = state.revoke({ sessionId: 'session-1' }, 'test revoke')
    assert.equal(revoked.ok, true)
    assert.deepEqual(revoked.value.revoked, [present(lease).id])
    assert.equal(revoked.value.pageRetained, true)
    assert.equal(state.leaseFor(present(lease).agent, 'token-1', 'session-1'), undefined)
  })

  it('reports not_authorized when revoking without a matching lease', () => {
    const { state } = fixture()
    const revoked = state.revoke({ controlLeaseId: 'lease-missing' }, 'test')
    assert.equal(revoked.ok, false)
    assert.equal(revoked.error.code, 'not_authorized')
  })

  it('settles queued work as revoked and dispatched work as unknown', async () => {
    const { state, lease } = fixture()
    const running = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    state.takeCommands('panel-1', 1, LIMITS)
    const queued = state.run(present(lease), { kind: 'observe', maxChars: 10, maxNodes: 1 }, LIMITS)
    state.revoke({ controlLeaseId: present(lease).id }, 'user revoked')
    const runningOutcome = await running
    assert.equal(expectFailure(runningOutcome).code, 'unknown_outcome')
    const queuedOutcome = await queued
    assert.equal(queuedOutcome.ok, false)
    assert.equal(queuedOutcome.error.code, 'revoked')
  })

  it('expires an abandoned panel connection and invalidates its leases', () => {
    const { state, time, lease } = fixture()
    time.advance(LIMITS.connectionIdleMs + 1)
    const expired = state.expireIdleConnections(LIMITS.connectionIdleMs)
    assert.deepEqual(expired, ['panel-1'])
    assert.equal(state.leaseFor(present(lease).agent, 'token-1', 'session-1'), undefined)
    assert.equal(state.connectionCount(), 0)
  })

  it('refuses a lower connection generation from the same panel instance', () => {
    const { state } = fixture()
    state.registerConnection(hello({ connectionGeneration: 2 }))
    const stale = state.registerConnection(hello({ connectionGeneration: 1 }))
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, 'connection_stale')
  })
})
