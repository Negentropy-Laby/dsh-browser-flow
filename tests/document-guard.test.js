/**
 * A successful result naming another document must not be served.
 *
 * The panel compares the document identity before acting, but a navigation can
 * land between that check and the reply. This is the Host's own backstop: if the
 * reply names a different document, the authorization was granted for a page
 * that is no longer on screen.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createControlState } from '../src/state.js'
import { resolveConfig } from '../src/config.ts'

const page = {
  lease: 'guest-1', partition: 'part-1', url: 'https://a.test/x',
  documentToken: 'doc-a', tabId: 'tab-1',
}
const agent = { id: 'session-1' }

/**
 * Build a state with one connected, authorized panel.
 * @returns {{ state: object, limits: object, lease: object }} fixtures.
 */
function ready() {
  const state = createControlState()
  const limits = resolveConfig({})
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
  return { state, limits, lease: state.leaseFor(agent, 'token-1', 'session-1') }
}

describe('the Host refuses a result from a different document', () => {
  it('fails the call and forces a re-observe when the reply names another document', async () => {
    const { state, limits, lease } = ready()
    const pending = state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const command = state.takeCommands('panel-1', 1, limits).value.commands[0]
    state.settle({
      kind: 'result', id: command.id, leaseId: command.leaseId, instanceId: 'panel-1',
      connectionGeneration: command.connectionGeneration,
      epoch: command.epoch, sequence: command.sequence,
      outcome: 'ok', payload: { documentToken: 'doc-b' },
    }, limits)
    const outcome = await pending
    assert.equal(outcome.ok, false, 'a reply from another document must not be served')
    assert.equal(outcome.error.code, 'stale_observation')
    // document_replaced advances the epoch instead of revoking: the user's\n    // authorization stands, but every reference taken against the old document\n    // is now refused until the page is observed again.\n    const after = state.leaseFor(agent, 'token-1', 'session-1')\n    assert.notEqual(after, undefined, 'the authorization survives a document replacement')\n    assert.notEqual(after.epoch, 0, 'the epoch must advance so earlier references are stale')
  })

  it('still serves a reply that names the authorized document', async () => {
    const { state, limits, lease } = ready()
    const pending = state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const command = state.takeCommands('panel-1', 1, limits).value.commands[0]
    state.settle({
      kind: 'result', id: command.id, leaseId: command.leaseId, instanceId: 'panel-1',
      connectionGeneration: command.connectionGeneration,
      epoch: command.epoch, sequence: command.sequence,
      outcome: 'ok', payload: { documentToken: 'doc-a', nodes: [] },
    }, limits)
    const outcome = await pending
    assert.equal(outcome.ok, true, JSON.stringify(outcome))
  })
})