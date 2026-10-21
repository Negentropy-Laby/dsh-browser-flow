/**
 * The sequence is consumed when the panel takes a command, not when the Host
 * dispatches it.
 *
 * Assigning it at dispatch would charge the panel for a command it never saw:
 * one that expired while queued consumes a sequence on the Host side only, and
 * from then on every command the panel receives is one ahead of what it expects
 * — so the page stops accepting work until the user authorizes it again.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createControlState } from '../src/state.ts'
import { resolveConfig } from '../src/config.ts'

const page = {
  lease: 'guest-1', partition: 'part-1', url: 'https://a.test/x',
  documentToken: 'doc-a', tabId: 'tab-1',
}
const agent = { id: 'session-1' }

/**
 * Build a state with one connected, authorized panel.
 * @param {object} [options] - limits overrides.
 * @returns {object} fixtures with a mutable clock.
 */
function ready(options = {}) {
  const clock = { t: 1000 }
  const state = createControlState({ now: () => clock.t })
  const limits = resolveConfig(options.limits ?? {})
  state.registerConnection({
    kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'session-1',
    panel: { instanceId: 'panel-1', pages: [page] },
  })
  const authorized = state.authorize({
    connectionInstanceId: 'panel-1', connectionGeneration: 1, sessionId: 'session-1',
    agentInstanceToken: 'token-1', agent,
    lease: page.lease, partition: page.partition, documentToken: page.documentToken, tabId: page.tabId,
  })
  assert.equal(authorized.ok, true)
  return { state, limits, clock, authorized: authorized.value }
}

describe('a command nobody took leaves the sequence untouched', () => {
  it('does not charge the panel for a command that expired before it was taken', async () => {
    const { state, limits, clock } = ready({ limits: { commandBudgetMs: 500, waitMaxMs: 500 } })
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    const abandoned = state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    // Time passes with the panel not polling; the command expires in the queue.
    clock.t += 700
    // A poll is what pumps the queue; it finds the command expired and drops it.
    const pumped = state.takeCommands('panel-1', 1, limits)
    assert.equal(pumped.ok, true)
    assert.equal(pumped.value.commands.length, 0, 'an expired command is not delivered')
    const outcome = await abandoned
    assert.equal(outcome.ok, false)

    // The next command must still be handed over as the panel's first sequence,
    // not as a later one it never saw.
    const next = state.run(state.leaseFor(agent, 'token-1', 'session-1'), { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const taken = state.takeCommands('panel-1', 1, limits)
    assert.equal(taken.ok, true)
    assert.equal(taken.value.commands.length, 1, 'the fresh command must be delivered')
    assert.equal(taken.value.commands[0].sequence, 0, 'the panel must see the sequence it actually needs')
    state.revoke({ controlLeaseId: 'lease-1' }, 'test cleanup')
    await next
  })

  it('numbers consecutive taken commands from zero', () => {
    const { state, limits } = ready()
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    const first = state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const one = state.takeCommands('panel-1', 1, limits).value.commands[0]
    assert.equal(one.sequence, 0)
    state.settle({
      kind: 'result', id: one.id, leaseId: one.leaseId, instanceId: 'panel-1',
      connectionGeneration: one.connectionGeneration, epoch: one.epoch, sequence: one.sequence,
      outcome: 'ok', payload: { documentToken: 'doc-a' },
    }, limits)
    void first
    const second = state.run(state.leaseFor(agent, 'token-1', 'session-1'), { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const two = state.takeCommands('panel-1', 1, limits).value.commands[0]
    assert.equal(two.sequence, 1, 'the next taken command takes the next sequence')
    state.revoke({ controlLeaseId: 'lease-1' }, 'test cleanup')
    void second
  })
})