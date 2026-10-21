/**
 * A command's deadline must cross the process boundary as a relative budget.
 *
 * The Host measures deadlines on its own monotonic clock (`performance.now()`),
 * which the browser realm cannot read. The panel used to compare that absolute
 * value against `Date.now()` — a Unix epoch timestamp roughly six orders of
 * magnitude larger — so every command looked expired and the tool call failed
 * with `deadline_exceeded` before the page was touched.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createControlState } from '../src/state.js'
import { resolveConfig } from '../src/config.ts'

const page = {
  lease: 'guest-1', partition: 'part-1', url: 'https://example.test/a',
  documentToken: 'doc-1', tabId: 'tab-1',
}
const agent = { id: 'session-1' }

/**
 * Build a control state with one connected, authorized panel.
 * @returns {object} state and limits.
 */
function ready() {
  const state = createControlState()
  const limits = resolveConfig({})
  state.registerConnection({
    kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'session-1',
    panel: { instanceId: 'panel-a', pages: [page] },
  })
  const authorized = state.authorize({
    connectionInstanceId: 'panel-a', connectionGeneration: 1, sessionId: 'session-1',
    agentInstanceToken: 'token-1', agent,
    lease: page.lease, partition: page.partition, documentToken: page.documentToken, tabId: page.tabId,
  })
  assert.equal(authorized.ok, true)
  return { state, limits }
}

describe('command deadlines cross the wire as a relative budget', () => {
  it('carries a positive budget the panel can spend on its own clock', () => {
    const { state, limits } = ready()
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    void state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const taken = state.takeCommands('panel-a', 1, limits)
    assert.equal(taken.ok, true)
    const command = taken.value.commands[0]
    assert.equal(typeof command.budgetMs, 'number', 'the envelope must carry a relative budget')
    assert.ok(command.budgetMs > 0, 'a freshly dispatched command must have time left')
    assert.ok(command.budgetMs <= limits.commandBudgetMs,
      'the budget may not exceed the configured command budget')
    // The absolute deadline stays on the Host clock and is not what the panel uses.
    assert.equal(typeof command.deadlineAt, 'number')
  })

  it('reports a spent budget rather than an absolute instant', () => {
    // A clock far ahead of the Host's monotonic origin must not expire commands;
    // only the budget matters. This pins the shape the panel reads.
    const { state, limits } = ready()
    const lease = state.leaseFor(agent, 'token-1', 'session-1')
    void state.run(lease, { kind: 'observe', maxChars: 100, maxNodes: 5 }, limits)
    const command = state.takeCommands('panel-a', 1, limits).value.commands[0]
    // Simulate a panel clock reading a Unix-epoch timestamp: the old comparison
    // `Date.now() > deadlineAt` would be true, the budget comparison is not.
    const panelNow = Date.now()
    const wouldHaveExpired = panelNow > command.deadlineAt
    assert.equal(wouldHaveExpired, true, 'this is exactly why the absolute comparison was wrong')
    assert.ok(command.budgetMs > 0, 'the relative budget is what keeps the command alive')
  })
})