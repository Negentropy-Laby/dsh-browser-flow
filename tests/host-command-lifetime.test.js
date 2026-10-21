import { bindTestTask } from './helpers/bind-task.js'
/** Host deadlines and unload complete calls even when the panel stops polling. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BrowserFlowService } from '../src/index.js'
import { resolveConfig } from '../src/config.js'

async function fixture() {
  const agent = { id: 'session-lifetime' }
  const service = new BrowserFlowService({ agents: { get: id => id === agent.id ? agent : undefined } },
    resolveConfig({ commandBudgetMs: 500, waitMaxMs: 100 }))
  const page = { lease: 'guest-lifetime', partition: 'part-lifetime', documentToken: 'doc-lifetime', url: 'https://example.test/' }
  service.state.registerConnection({ connectionGeneration: 1, sessionId: agent.id,
    panel: { instanceId: 'panel-lifetime', pages: [page] } })
  const access=await bindTestTask(service,agent.id)
  service.state.authorize({task:access.run, connectionInstanceId: 'panel-lifetime', connectionGeneration: 1,
    sessionId: agent.id, agent, agentInstanceToken: service.tokenOf(agent), ...page })
  const caller = service.resolveCaller({ agent }).value
  return { service, caller }
}

for (const taken of [false, true]) {
  test(`Host deadline settles ${taken ? 'taken' : 'untaken'} work without another poll`, async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] })
    const { service, caller } = await fixture()
    const pending = service.dispatch(caller, { kind: 'observe' }, new AbortController().signal)
    let outcome
    pending.then(value => { outcome = value })
    try {
      if (taken) assert.equal(service.state.takeCommands('panel-lifetime', 1, service.config).value.commands.length, 1)
      context.mock.timers.tick(500)
      await Promise.resolve()
      await Promise.resolve()
      assert.notEqual(outcome, undefined, 'the command budget must not depend on another panel poll')
      assert.equal(outcome.error.code, taken ? 'unknown_outcome' : 'deadline_exceeded')
    } finally {
      service.state.revoke({ sessionId: caller.sessionId }, 'test cleanup')
      await pending
      await service.close()
      context.mock.timers.reset()
    }
  })
}

test('unloading the service settles pending work and removes every binding', async () => {
  const { service, caller } = await fixture()
  const pending = service.dispatch(caller, { kind: 'observe' }, new AbortController().signal)
  service.state.takeCommands('panel-lifetime', 1, service.config)
  let outcome
  pending.then(value => { outcome = value })
  try {
    await service.close()
    await Promise.resolve()
    assert.notEqual(outcome, undefined, 'unload must settle pending calls before completing')
    assert.equal(outcome.error.code, 'unknown_outcome')
    assert.equal(service.state.leaseCount(), 0)
    assert.equal(service.state.connectionCount(), 0)
    const refused = await service.dispatch(caller, { kind: 'observe' }, new AbortController().signal)
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'connection_stale')
  } finally {
    service.state.revoke({ sessionId: caller.sessionId }, 'test cleanup')
    await pending
    await service.close()
  }
})

test('concurrent unload calls await one disposal and leave no command timer', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { service, caller } = await fixture()
  const pending = service.dispatch(caller, { kind: 'observe' }, new AbortController().signal)
  let releaseDisposal
  const gate = new Promise(resolve => { releaseDisposal = resolve })
  let signalDisposal
  const disposalEntered = new Promise(resolve => { signalDisposal = resolve })
  let disposals = 0
  service.disposers.push(async () => { disposals += 1; signalDisposal(); await gate })
  try {
    const first = service.close()
    const second = service.close()
    assert.equal(first, second)
    await pending
    await disposalEntered
    assert.equal(disposals, 1)
    releaseDisposal()
    await Promise.all([first, second])
    assert.equal(service.pending.size, 0)
    context.mock.timers.tick(500)
    assert.equal(service.state.leaseCount(), 0)
    assert.equal(service.state.registerConnection({ connectionGeneration: 1, sessionId: caller.sessionId,
      panel: { instanceId: 'late-panel', pages: [] } }).ok, false)
  } finally {
    releaseDisposal()
    await service.close()
    await pending
    context.mock.timers.reset()
  }
})
