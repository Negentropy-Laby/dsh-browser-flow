/**
 * Regression tests for the defects the user's own Desktop surfaced.
 *
 * Two bugs only appeared once a real panel was driven by a real user:
 *
 * 1. The same physical page was listed several times, each with its own control
 *    lease, because `authorize` keyed its de-duplication on the panel instance.
 * 2. Commands expired unserved (`deadline_exceeded`) because delivery was bound
 *    to the panel instance that authorized, and a remounted panel has a new
 *    instance id, so no poll ever matched and the command sat until its deadline.
 *
 * Both are about a panel that remounts mid-session, which unit tests with one
 * stable fake panel never exercised.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createControlState } from '../src/state.ts'
import { resolveConfig } from '../src/config.ts'

/** One panel page as the panel reports it. */
const page = {
  lease: 'guest-1', partition: 'part-1', url: 'https://example.test/a',
  documentToken: 'doc-1', tabId: 'tab-1',
}

/** One live Agent object. */
const agent = { id: 'session-1' }

/**
 * Register one panel connection.
 * @param {object} state - control state.
 * @param {object} input - connection inputs.
 * @returns {void}
 */
function connect(state, { instanceId, generation = 1, sessionId = 'session-1', pages = [page] }) {
  const registered = state.registerConnection({
    kind: 'hello', protocolVersion: 3, connectionGeneration: generation,
    sessionId, panel: { instanceId, pages },
  })
  assert.equal(registered.ok, true, 'connect failed: ' + JSON.stringify(registered))
}

/**
 * Authorize the fixture page for one Agent from one panel instance.
 * @param {object} state - control state.
 * @param {object} input - authorization inputs.
 * @returns {object} the authorization verdict.
 */
function authorize(state, { instanceId, generation = 1, agentInstanceToken = 'token-1', sessionId = 'session-1' }) {
  return state.authorize({
    connectionInstanceId: instanceId,
    connectionGeneration: generation,
    sessionId,
    agentInstanceToken,
    agent,
    lease: page.lease,
    partition: page.partition,
    documentToken: page.documentToken,
    tabId: page.tabId,
  })
}

/**
 * Settle one taken command successfully.
 * @param {object} state - control state.
 * @param {object} command - taken command envelope.
 * @param {object} limits - resolved config.
 * @param {string} instanceId - reporting panel instance.
 * @returns {object} the settlement verdict.
 */
function settleOk(state, command, limits, instanceId) {
  return state.settle({
    kind: 'result', id: command.id, leaseId: command.leaseId, instanceId,
    connectionGeneration: command.connectionGeneration,
    epoch: command.epoch, sequence: command.sequence,
    outcome: 'ok', payload: { documentToken: 'doc-1' },
  }, limits)
}

describe('one page, one lease, across panel remounts', () => {
  it('re-authorizing from a new panel instance reuses the existing lease', () => {
    const state = createControlState()
    connect(state, { instanceId: 'panel-a' })
    const first = authorize(state, { instanceId: 'panel-a' })
    assert.equal(first.ok, true)
    connect(state, { instanceId: 'panel-b' })
    const second = authorize(state, { instanceId: 'panel-b' })
    assert.equal(second.ok, true)
    assert.equal(second.value.controlLeaseId, first.value.controlLeaseId,
      'the same physical page must keep one control lease')
    assert.equal(state.leaseCount(), 1, 'no duplicate lease may be minted')
  })

  it('keeps the lease usable from the instance that re-authorized it', async () => {
    const state = createControlState()
    const limits = resolveConfig({})
    connect(state, { instanceId: 'panel-a' })
    authorize(state, { instanceId: 'panel-a' })
    connect(state, { instanceId: 'panel-b' })
    assert.equal(authorize(state, { instanceId: 'panel-b' }).ok, true)

    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    assert.notEqual(lease, undefined, 'the lease must still resolve for the caller')
    const pending = state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const taken = state.takeCommands('panel-b', 1, limits)
    assert.equal(taken.ok, true, 'take failed: ' + JSON.stringify(taken))
    assert.equal(taken.value.commands.length, 1, 'the live panel must receive the command')
    const settled = settleOk(state, taken.value.commands[0], limits, 'panel-b')
    assert.equal(settled.ok, true, 'settle failed: ' + JSON.stringify(settled))
    const outcome = await pending
    assert.equal(outcome.ok, true, 'command failed: ' + JSON.stringify(outcome))
  })

  it('still refuses a second Agent instance trying to take the same page', () => {
    const state = createControlState()
    connect(state, { instanceId: 'panel-a' })
    authorize(state, { instanceId: 'panel-a' })
    connect(state, { instanceId: 'panel-b' })
    const other = authorize(state, { instanceId: 'panel-b', agentInstanceToken: 'token-2' })
    assert.equal(other.ok, false)
    assert.equal(other.error.code, 'not_authorized')
  })
})

describe('command delivery follows the live panel', () => {
  it('serves a command to the panel instance that polls, not the one that authorized', async () => {
    const state = createControlState()
    const limits = resolveConfig({})
    connect(state, { instanceId: 'panel-a' })
    authorize(state, { instanceId: 'panel-a' })
    connect(state, { instanceId: 'panel-b' })
    authorize(state, { instanceId: 'panel-b' })

    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    const pending = state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const taken = state.takeCommands('panel-b', 1, limits)
    assert.equal(taken.ok, true)
    assert.equal(taken.value.commands.length, 1, 'the live panel must receive the queued command')
    settleOk(state, taken.value.commands[0], limits, 'panel-b')
    const outcome = await pending
    assert.equal(outcome.ok, true, 'command failed: ' + JSON.stringify(outcome))
  })

  it('does not hand one Session commands to another Session panel', async () => {
    const state = createControlState()
    const limits = resolveConfig({})
    connect(state, { instanceId: 'panel-a', sessionId: 'session-1' })
    authorize(state, { instanceId: 'panel-a', sessionId: 'session-1' })
    connect(state, { instanceId: 'panel-other', sessionId: 'session-2', pages: [] })
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    const pending = state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const taken = state.takeCommands('panel-other', 1, limits)
    assert.equal(taken.ok, true)
    assert.equal(taken.value.commands.length, 0, 'another Session must not see these commands')
    state.revoke({ controlLeaseId: 'lease-1' }, 'test cleanup')
    await pending
  })
})