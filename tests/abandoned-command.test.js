/**
 * What happens when the Host gives up before the panel answers (§6.2).
 *
 * The Host's deadline stops it waiting; it settles the call as unknown_outcome
 * because a dispatched command may have acted. The panel learns the id from the
 * poll and must not answer it — and if it answers anyway, that late result is
 * expected traffic, not a protocol violation that resets the user's control.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createControlState } from '../src/state.js'
import { resolveConfig } from '../src/config.js'

const page = {
  lease: 'guest-1', partition: 'part-1', url: 'https://a.test/x',
  documentToken: 'doc-a', tabId: 'tab-1',
}
const agent = { id: 'session-1' }

/**
 * Build a state with one authorized panel and a controllable clock.
 * @returns {object} fixtures.
 */
function ready() {
  const clock = { t: 1000 }
  const state = createControlState({ now: () => clock.t })
  const limits = resolveConfig({ commandBudgetMs: 500, waitMaxMs: 500 })
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
  return { state, limits, clock }
}

describe('a command the Host abandoned before the panel answered', () => {
  it('tells the panel which id it stopped waiting for', () => {
    const { state, limits, clock } = ready()
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    void state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const command = state.takeCommands('panel-1', 1, limits).value.commands[0]
    // The panel never answers; the next poll expires the record and reports it.
    clock.t += 700
    const next = state.takeCommands('panel-1', 1, limits)
    assert.equal(next.ok, true)
    assert.deepEqual(next.value.dropped, [command.id], 'the panel must be told the id is abandoned')
    assert.equal(next.value.commands.length, 0)
  })

  it('ignores a late result instead of resetting the user control', () => {
    const { state, limits, clock } = ready()
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    const pending = state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const command = state.takeCommands('panel-1', 1, limits).value.commands[0]
    clock.t += 700
    state.takeCommands('panel-1', 1, limits)
    // The panel finally answers. This must not be read as a protocol violation.
    const late = state.settle({
      kind: 'result', id: command.id, leaseId: command.leaseId, instanceId: 'panel-1',
      connectionGeneration: command.connectionGeneration,
      epoch: command.epoch, sequence: command.sequence,
      outcome: 'ok', payload: { documentToken: 'doc-a' },
    }, limits)
    assert.equal(late.ok, true, `a late answer must be accepted as ignored: ${JSON.stringify(late)}`)
    assert.equal(late.value.outcome, 'ignored')
    const survivor = state.leaseFor(agent, 'token-1', 'session-1')
    assert.notEqual(survivor, undefined, 'control must survive an abandoned command answering late')
    // eslint-disable-next-line no-void
    void pending
  })

  it('still refuses a result that names no command at all', () => {
    const { state, limits } = ready()
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    void state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const command = state.takeCommands('panel-1', 1, limits).value.commands[0]
    const bogus = state.settle({
      kind: 'result', id: 'cmd-9999', leaseId: command.leaseId, instanceId: 'panel-1',
      connectionGeneration: command.connectionGeneration,
      epoch: command.epoch, sequence: command.sequence,
      outcome: 'ok', payload: {},
    }, limits)
    assert.equal(bogus.ok, false, 'an invented id is still a violation')
    assert.equal(bogus.error.code, 'protocol_violation')
  })
})