/** The dispatch budget includes elapsed Host time before the panel takes work. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createControlState } from '../src/state.ts'
import { resolveConfig } from '../src/config.ts'

function fixture() {
  let time = 0
  const state = createControlState({ now: () => time })
  const agent = { id: 'session-budget' }
  const page = { lease: 'guest-budget', partition: 'part-budget', documentToken: 'doc-budget', url: 'https://example.test/' }
  const limits = resolveConfig({ commandBudgetMs: 1000, waitMaxMs: 100 })
  state.registerConnection({ connectionGeneration: 1, sessionId: agent.id, panel: { instanceId: 'panel-budget', pages: [page] } })
  state.authorize({ connectionInstanceId: 'panel-budget', connectionGeneration: 1, sessionId: agent.id,
    agentInstanceToken: 'token-budget', agent, ...page })
  const lease = state.leaseFor(agent, 'token-budget', agent.id)
  return { state, lease, limits, setTime: value => { time = value } }
}

test('1000ms budget has at most 100ms left after 900ms waiting for take', async () => {
  const f = fixture()
  const pending = f.state.run(f.lease, { kind: 'observe' }, f.limits)
  try {
    f.setTime(900)
    const command = f.state.takeCommands('panel-budget', 1, f.limits).value.commands[0]
    assert.ok(command.budgetMs > 0 && command.budgetMs <= 100, `remaining budget=${command.budgetMs}`)
  } finally {
    f.state.revoke({ controlLeaseId: f.lease.id }, 'test cleanup')
    await pending
  }
})

test('a command at its exact deadline is not taken and consumes no sequence', async () => {
  const f = fixture()
  const pending = f.state.run(f.lease, { kind: 'observe' }, f.limits)
  try {
    f.setTime(1000)
    assert.equal(f.state.takeCommands('panel-budget', 1, f.limits).value.commands.length, 0)
    assert.equal(f.lease.nextSequence, 0)
    assert.equal((await pending).error.code, 'deadline_exceeded')
  } finally {
    f.state.revoke({ controlLeaseId: f.lease.id }, 'test cleanup')
    await pending
  }
})

for (const elapsed of [0, 999, 1001]) {
  test(`delivery after ${elapsed}ms uses only the original budget`, async () => {
    const f = fixture()
    const pending = f.state.run(f.lease, { kind: 'observe' }, f.limits)
    try {
      f.setTime(elapsed)
      const commands = f.state.takeCommands('panel-budget', 1, f.limits).value.commands
      if (elapsed < 1000) assert.equal(commands[0].budgetMs, 1000 - elapsed)
      else assert.equal(commands.length, 0)
    } finally {
      f.state.revoke({ controlLeaseId: f.lease.id }, 'test cleanup')
      await pending
    }
  })
}

test('queueing and waiting for take do not restart a second command budget', async () => {
  const f = fixture()
  const first = f.state.run(f.lease, { kind: 'observe' }, f.limits)
  f.setTime(200)
  const second = f.state.run(f.lease, { kind: 'observe' }, f.limits)
  try {
    f.setTime(400)
    const command = f.state.takeCommands('panel-budget', 1, f.limits).value.commands[0]
    assert.equal(command.budgetMs, 600)
    f.setTime(900)
    f.state.settle({ ...command, instanceId: 'panel-budget', outcome: 'ok', payload: {} }, f.limits)
    assert.equal((await first).ok, true)
    f.setTime(1100)
    const next = f.state.takeCommands('panel-budget', 1, f.limits).value.commands[0]
    assert.equal(next.budgetMs, 100)
    assert.equal(next.sequence, 1)
  } finally {
    f.state.revoke({ controlLeaseId: f.lease.id }, 'test cleanup')
    await Promise.all([first, second])
  }
})

test('cancellation before take leaves the sequence available', async () => {
  const f = fixture()
  const controller = new AbortController()
  const pending = f.state.run(f.lease, { kind: 'observe' }, f.limits, controller.signal)
  controller.abort()
  assert.equal((await pending).error.code, 'deadline_exceeded')
  assert.equal(f.state.takeCommands('panel-budget', 1, f.limits).value.commands.length, 0)
  assert.equal(f.lease.nextSequence, 0)
})

test('cancelled taken work releases its slot at the original deadline without replay', async () => {
  const f = fixture()
  const controller = new AbortController()
  const first = f.state.run(f.lease, { kind: 'act', action: 'click' }, f.limits, controller.signal)
  const original = f.state.takeCommands('panel-budget', 1, f.limits).value.commands[0]
  controller.abort()
  assert.equal((await first).error.code, 'unknown_outcome')
  f.setTime(100)
  const second = f.state.run(f.lease, { kind: 'observe' }, f.limits)
  try {
    f.setTime(999)
    assert.equal(f.state.takeCommands('panel-budget', 1, f.limits).value.commands.length, 0)
    f.setTime(1000)
    const commands = f.state.takeCommands('panel-budget', 1, f.limits).value.commands
    assert.equal(commands.length, 1, 'the expired cancelled record must not hold the slot forever')
    assert.notEqual(commands[0].id, original.id)
    assert.equal(commands[0].sequence, 1)
    assert.equal(commands[0].budgetMs, 100)
    const before = f.state.describeLease(f.lease.id)
    const late = f.state.settle({ ...original, instanceId: 'panel-budget', outcome: 'ok', payload: {} }, f.limits)
    assert.equal(late.value.outcome, 'ignored')
    assert.deepEqual(f.state.describeLease(f.lease.id), before)
    f.state.settle({ ...commands[0], instanceId: 'panel-budget', outcome: 'ok', payload: {} }, f.limits)
    assert.equal((await second).ok, true)
  } finally {
    f.state.revoke({ controlLeaseId: f.lease.id }, 'test cleanup')
    await second
  }
})
