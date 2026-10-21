import assert from 'node:assert/strict'
import {it} from 'node:test'
import {taskHost} from './helpers/task-host.ts'
import {present} from './helpers/assertions.ts'

it('never builds graph input or starts a worker for read-only or damaged history details',async t=>{
 const env=await taskHost(t);await env.task('a');const store=env.service.tasks,access=present(store.current('session-a')),data=store.openTask(access)
 let calls=0;env.service.graph.detail=async()=>{calls++;throw new Error('must not enter worker')}
 for(const mode of ['readOnly','unhealthy'] as const){
  data.readOnly=mode==='readOnly';data.unhealthy=mode==='unhealthy'
  await assert.rejects(store.detail(access,'graph',0,8000),{code:mode==='readOnly'?'task_read_only':'task_unavailable'})
  await assert.rejects(store.detail(access,'digest-missing',0,8000),{code:mode==='readOnly'?'task_read_only':'task_unavailable'})
  assert.ok(await store.detail(access,'goal',0,8000));assert.equal(calls,0)
 }
})
