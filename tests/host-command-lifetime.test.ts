import {expectFailure,expectOk,present} from './helpers/assertions.ts'
import { bindTestTask } from './helpers/bind-task.ts'
/** Host deadlines and unload complete calls even when the panel stops polling. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BrowserFlowService } from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'

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
  const caller = expectOk(service.resolveCaller({ agent }))
  return { service, caller }
}

for (const taken of [false, true] as const) {
  test(`Host deadline settles ${taken ? 'taken' : 'untaken'} work without another poll`, async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] })
    const { service, caller } = await fixture()
    const pending = service.dispatch(caller, { kind: 'observe' }, new AbortController().signal)
    const capture:{outcome?:Awaited<ReturnType<typeof service.dispatch>>}={}
    pending.then(value => { capture.outcome = value })
    try {
      if (taken) assert.equal(expectOk(service.state.takeCommands('panel-lifetime', 1, service.config)).commands.length, 1)
      context.mock.timers.tick(500)
      await Promise.resolve()
      await Promise.resolve()
      assert.notEqual(capture.outcome, undefined, 'the command budget must not depend on another panel poll')
      assert.equal(expectFailure(present(capture.outcome)).code, taken ? 'unknown_outcome' : 'deadline_exceeded')
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
  const capture:{outcome?:Awaited<ReturnType<typeof service.dispatch>>}={}
  pending.then(value => { capture.outcome = value })
  try {
    await service.close()
    await Promise.resolve()
    assert.notEqual(capture.outcome, undefined, 'unload must settle pending calls before completing')
    assert.equal(expectFailure(present(capture.outcome)).code, 'unknown_outcome')
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
  let releaseDisposal!:()=>void
  const gate = new Promise<void>(resolve => { releaseDisposal = resolve })
  let signalDisposal!:()=>void
  const disposalEntered = new Promise<void>(resolve => { signalDisposal = resolve })
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
