import {expectOk,expectRecord,present} from './helpers/assertions.ts'
/**
 * The dispatch path must survive a panel remount.
 *
 * `pump` used to look up the panel instance recorded on the lease. A remounted
 * panel registers a new instance id, so the lookup failed and every queued
 * command was refused as `connection_stale` before it ever reached `inFlight` —
 * the symptom the user saw was `deadline_exceeded` on every tool call.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createControlState } from '../src/state.ts'
import { resolveConfig } from '../src/config.ts'

const page = {
  lease: 'guest-1', partition: 'part-1', url: 'https://example.test/a',
  documentToken: 'doc-1', tabId: 'tab-1',
}
const agent = { id: 'session-1' }

/**
 * Register one panel connection.
 * @param {object} state - control state.
 * @param {string} instanceId - panel instance.
 * @param {string} [sessionId] - Session.
 * @returns {void}
 */
function connect(state: ReturnType<typeof createControlState>, instanceId: string, sessionId: string = 'session-1') : void {
  const registered = state.registerConnection({
    kind: 'hello', protocolVersion: 3, connectionGeneration: 1,
    sessionId, panel: { instanceId, pages: [page] },
  })
  assert.equal(registered.ok, true)
}

/**
 * Authorize the fixture page from one panel instance.
 * @param {object} state - control state.
 * @param {string} instanceId - panel instance.
 * @param {string} [token] - Agent instance token.
 * @returns {object} verdict.
 */
function authorize(state: ReturnType<typeof createControlState>, instanceId: string, token: string = 'token-1') {
  return state.authorize({
    connectionInstanceId: instanceId, connectionGeneration: 1, sessionId: 'session-1',
    agentInstanceToken: token, agent,
    lease: page.lease, partition: page.partition, documentToken: page.documentToken, tabId: page.tabId,
  })
}

describe('dispatch follows the authorization, not the newest panel', () => {
  it('does not hand a lease to a panel that has not been authorized for it', async () => {
    const state = createControlState()
    const limits = resolveConfig({})
    connect(state, 'panel-a')
    assert.equal(authorize(state, 'panel-a').ok, true)
    // The panel remounts. It holds no authorization until the user grants one
    // again, so it must not receive the old lease's commands.
    connect(state, 'panel-b')
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    const pending = state.run(present(lease), { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const stolen = state.takeCommands('panel-b', 1, limits)
    assert.equal(stolen.ok, true)
    assert.equal(stolen.value.commands.length, 0, 'an unauthorized panel must not take the command')
    // The panel that does hold the authorization still gets it.
    const taken = state.takeCommands('panel-a', 1, limits)
    assert.equal(expectOk(taken).commands.length, 1, 'the authorizing panel must still receive its command')
    const command = expectOk(taken).commands[0]
    state.settle({
      kind: 'result', id: command.id, leaseId: command.leaseId, instanceId: 'panel-a',
      connectionGeneration: command.connectionGeneration,
      epoch: command.epoch, sequence: command.sequence,
      outcome: 'ok', payload: { documentToken: 'doc-1' },
    }, limits)
    const outcome = await pending
    assert.equal(outcome.ok, true, 'command failed: ' + JSON.stringify(outcome))
  })

  it('serves the lease from the new panel once the user authorizes it again', async () => {
    const state = createControlState()
    const limits = resolveConfig({})
    connect(state, 'panel-a')
    assert.equal(authorize(state, 'panel-a').ok, true)
    connect(state, 'panel-b')
    assert.equal(authorize(state, 'panel-b').ok, true, 'the remounted panel re-authorizes')
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    const pending = state.run(present(lease), { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const old = state.takeCommands('panel-a', 1, limits)
    assert.equal(expectOk(old).commands.length, 0, 'the previous instance no longer serves this lease')
    const taken = state.takeCommands('panel-b', 1, limits)
    assert.equal(expectOk(taken).commands.length, 1, 'the re-authorized panel receives it')
    const command = expectOk(taken).commands[0]
    state.settle({
      kind: 'result', id: command.id, leaseId: command.leaseId, instanceId: 'panel-b',
      connectionGeneration: command.connectionGeneration,
      epoch: command.epoch, sequence: command.sequence,
      outcome: 'ok', payload: { documentToken: 'doc-1' },
    }, limits)
    const outcome = await pending
    assert.equal(outcome.ok, true, 'command failed: ' + JSON.stringify(outcome))
  })

  it('revokes control when the only panel of the lease Session goes away', () => {
    const state = createControlState()
    connect(state, 'panel-a')
    assert.equal(authorize(state, 'panel-a').ok, true)
    const expired = state.expireIdleConnections(-1)
    assert.equal(expired.length, 1)
    assert.equal(state.leaseFor(agent, 'token-1', 'session-1'), undefined,
      'a lease must not outlive every panel that could carry its commands')
  })
})