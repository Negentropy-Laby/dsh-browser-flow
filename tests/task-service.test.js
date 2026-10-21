import assert from 'node:assert/strict'
import { it } from 'node:test'
import { taskHost } from './helpers/task-host.js'

it('requires task binding for every normal page tool, without requiring a page for task view',async t=>{
  const env=await taskHost(t)
  await env.hello('a')
  assert.equal((await env.tool('a','browser_observe')).error.code,'task_not_bound')
  assert.equal((await env.tool('a','browser_tabs')).error.code,'task_not_bound')
  assert.equal((await env.authorize('a')).body.error.code,'task_not_bound')
  const created=await env.task('a')
  assert.equal(created.status,200)
  const view=await env.tool('a','browser_observe',{view:'task'})
  assert.equal(view.ok,true)
  assert.equal(view.value.goal,'Private task a')
  assert.equal(view.value.task.taskId,created.body.value.task.taskId)
  assert.equal((await env.tool('a','browser_observe')).error.code,'not_authorized')
})
it('never rebinds a Session, leaks another task, or authorizes an out-of-scope page',async t=>{
  const env=await taskHost(t)
  const a=(await env.task('a')).body.value.task
  const b=(await env.task('b')).body.value.task
  assert.equal((await env.task('a')).body.error.code,'task_bound')
  const wrong=await env.authorize('a',b)
  assert.equal(wrong.body.error.code,'task_not_bound')
  assert.equal(JSON.stringify(wrong.body).includes('Private task b'),false)
  const own=await env.authorize('a',a)
  assert.equal(own.status,200)
  await env.post('hello',{kind:'hello',connectionGeneration:1,sessionId:'session-b',panel:{instanceId:'panel-b',pages:[{...env.page('b'),url:'https://a.example/outside'}]}})
  assert.equal((await env.authorize('b',b)).body.error.code,'task_scope_mismatch')
})
it('binds immutable task/run identities to commands and refuses forged or missing receipt identities',async t=>{
  const env=await taskHost(t)
  const a=(await env.task('a')).body.value.task
  const b=(await env.task('b')).body.value.task
  await env.authorize('a',a)
  const pending=env.tool('a','browser_observe')
  const polled=await env.post('poll',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',pages:[env.page('a')]})
  const command=polled.body.value.commands[0]
  assert.deepEqual(command.task,a)
  const receipt={kind:'result',id:command.id,leaseId:command.leaseId,task:a,instanceId:'panel-a',connectionGeneration:1,epoch:command.epoch,sequence:command.sequence,outcome:'ok',payload:{documentToken:'doc-a',nodes:[]}}
  assert.equal((await env.post('result',{...receipt,task:undefined})).status,400)
  assert.equal((await env.post('result',{...receipt,task:b})).status,409)
  assert.equal((await env.post('result',receipt)).status,200)
  const outcome=await pending
  assert.equal(outcome.ok,true)
  assert.deepEqual(outcome.value.task,a)
  assert.ok(!JSON.stringify(outcome).includes(b.taskId))
})
it('revising a task revokes page control; release remains independent of task storage',async t=>{
  const env=await taskHost(t)
  const a=(await env.task('a')).body.value.task
  await env.authorize('a',a)
  const revised=await env.post('authorize',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',taskOperation:'revise',task:a,spec:{goal:'New goal'}})
  assert.equal(revised.status,200)
  assert.equal(env.service.leaseOf(env.service.resolveCaller({agent:env.agents.get('session-a')}).value).ok,false)
  await env.authorize('a',revised.body.value.task)
  env.service.tasks.openTask=()=>{throw new Error('disk failure')}
  assert.equal((await env.tool('a','browser_release')).value.pageRetained,true)
  assert.equal(env.service.leaseOf(env.service.resolveCaller({agent:env.agents.get('session-a')}).value).ok,false)
})
