/** Host ownership and authorization replacement regressions. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createControlState } from '../src/state.js'
import { resolveConfig } from '../src/config.ts'

const limits = resolveConfig({ commandBudgetMs: 1000, waitMaxMs: 100 })
const pageA = { lease: 'guest-a', partition: 'part-a', documentToken: 'doc-a', url: 'https://a.test/', tabId: 'tab-a' }
const pageB = { lease: 'guest-b', partition: 'part-b', documentToken: 'doc-b', url: 'https://b.test/', tabId: 'tab-b' }

function fixture() {
  const state = createControlState({ now: () => 0 })
  const agent = { id: 'session-review' }
  function connect(id, pages, sessionId = agent.id) {
    return state.registerConnection({ kind: 'hello', protocolVersion: 3, connectionGeneration: 1,
      sessionId, panel: { instanceId: id, pages } })
  }
  function authorize(page, overrides = {}) {
    return state.authorize({ sessionId: agent.id, agent, agentInstanceToken: 'instance-review',
      connectionInstanceId: 'panel-a', connectionGeneration: 1, ...page, ...overrides })
  }
  connect('panel-a', [pageA, pageB])
  assert.equal(authorize(pageA).ok, true)
  return { state, agent, connect, authorize,
    lease: () => state.leaseFor(agent, 'instance-review', agent.id) }
}

function result(command, overrides = {}) {
  return { kind: 'result', id: command.id, leaseId: command.leaseId,
    instanceId: 'panel-a', connectionGeneration: command.connectionGeneration,
    epoch: command.epoch, sequence: command.sequence,
    outcome: 'ok', payload: { documentToken: 'doc-a' }, ...overrides }
}

for (const scenario of [
  { name: 'a mismatched result generation cannot settle a command', override: { connectionGeneration: 999 } },
  { name: 'an unbound same-session panel cannot settle a command', override: { instanceId: 'panel-b' } },
  { name: 'a different Session panel cannot settle a command', override: { instanceId: 'panel-c' } },
]) {
  test(scenario.name, async () => {
    const f = fixture()
    f.connect('panel-b', [pageB])
    f.connect('panel-c', [pageB], 'other-session')
    const pending = f.state.run(f.lease(), { kind: 'observe', maxChars: 1000, maxNodes: 20 }, limits)
    try {
      const command = f.state.takeCommands('panel-a', 1, limits).value.commands[0]
      const before = f.state.describeLease(command.leaseId)
      const rejected = f.state.settle(result(command, scenario.override), limits)
      assert.equal(rejected.ok, false, 'wrong connection identity must fail')
      assert.deepEqual(f.state.describeLease(command.leaseId), before, 'an unrelated reply must not change the pending command')
      assert.equal(f.state.settle(result(command), limits).ok, true)
      assert.equal((await pending).ok, true)
    } finally {
      f.state.revoke({ sessionId: f.agent.id }, 'test cleanup')
      await pending
    }
  })
}

test('authorizing B replaces A and release leaves no hidden grant', () => {
  const f = fixture()
  const previous = f.lease()
  assert.equal(f.authorize(pageB).ok, true)
  assert.equal(f.lease().lease, 'guest-b')
  assert.equal(previous.state, 'revoked')
  assert.equal(f.state.leaseCountForSession(f.agent.id), 1)
  assert.equal(f.state.revoke({ controlLeaseId: f.lease().id }, 'release').ok, true)
  assert.equal(f.state.leaseCountForSession(f.agent.id), 0)
})

test('an unsuccessful B authorization keeps A available', () => {
  const f = fixture()
  const previous = f.lease()
  assert.equal(f.authorize(pageB, { partition: 'wrong' }).ok, false)
  assert.equal(f.lease(), previous)
  assert.equal(previous.state, 'active')
})

test('a panel cannot authorize an Agent from a different Session', () => {
  const f = fixture()
  const previous = f.lease()
  const rejected = f.authorize(pageB, { sessionId: 'other-session' })
  assert.equal(rejected.ok, false)
  assert.equal(f.lease(), previous)
})

test('a same-generation panel cannot silently move to another Session', () => {
  const f = fixture()
  assert.equal(f.connect('panel-a', [pageB], 'other-session').ok, false)
  assert.equal(f.state.connectionsFor(f.agent.id).length, 1)
  assert.equal(f.lease().state, 'active')
})

test('switching pages ends untaken work without claiming it may have executed', async () => {
  const f = fixture()
  const pending = f.state.run(f.lease(), { kind: 'observe' }, limits)
  f.authorize(pageB)
  const outcome = await pending
  assert.equal(outcome.ok, false)
  assert.notEqual(outcome.error.code, 'unknown_outcome')
})

test('same-page reauthorization ends old work and late replies preserve the new epoch', async () => {
  const f = fixture()
  const oldLease = f.lease()
  const oldPending = f.state.run(oldLease, { kind: 'act', action: 'click' }, limits)
  const oldCommand = f.state.takeCommands('panel-a', 1, limits).value.commands[0]
  const authorized = f.authorize(pageA)
  assert.equal(authorized.value.controlLeaseId, oldLease.id)
  assert.equal((await oldPending).error.code, 'unknown_outcome')
  const newPending = f.state.run(f.lease(), { kind: 'observe' }, limits)
  try {
    const command = f.state.takeCommands('panel-a', 1, limits).value.commands[0]
    const before = f.state.describeLease(oldLease.id)
    assert.equal(f.state.settle(result(oldCommand), limits).ok, false)
    assert.deepEqual(f.state.describeLease(oldLease.id), before)
    assert.equal(f.state.settle(result(command), limits).ok, true)
    assert.equal((await newPending).ok, true)
  } finally {
    f.state.revoke({ sessionId: f.agent.id }, 'test cleanup')
    await newPending
  }
})

test('page switching leaves a different Session grant active', () => {
  const f = fixture()
  const otherAgent = { id: 'other-session' }
  const otherPage = { ...pageB, lease: 'guest-c', partition: 'part-c' }
  f.connect('panel-c', [otherPage], otherAgent.id)
  assert.equal(f.authorize(otherPage, { sessionId: otherAgent.id, agent: otherAgent,
    agentInstanceToken: 'other-token', connectionInstanceId: 'panel-c' }).ok, true)
  f.authorize(pageB)
  assert.equal(f.state.leaseFor(otherAgent, 'other-token', otherAgent.id).state, 'active')
})

test('a reply for untaken work cannot consume its first sequence', async () => {
  const f = fixture()
  const pending = f.state.run(f.lease(), { kind: 'observe' }, limits)
  try {
    const record = [...f.lease().inFlight.values()][0]
    assert.equal(f.state.settle(result({ ...record.command, sequence: 0 }), limits).ok, false)
    assert.equal(f.lease().nextSequence, 0)
    const command = f.state.takeCommands('panel-a', 1, limits).value.commands[0]
    assert.equal(command.sequence, 0)
    assert.equal(f.state.settle(result(command), limits).ok, true)
    assert.equal((await pending).ok, true)
  } finally {
    f.state.revoke({ sessionId: f.agent.id }, 'test cleanup')
    await pending
  }
})
