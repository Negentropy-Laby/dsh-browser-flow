import {expectOk,expectFailure,expectRecord,present,expectString} from './helpers/assertions.ts'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { readFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { taskHost } from './helpers/task-host.ts'
import { TaskStore } from '../src/task-store.ts'

const request={action:'await_user',wait:{kind:'other_user_input',reason:'A synthetic user decision is missing',resumeCondition:'The user supplies a new decision'}}
const resume=(env:Awaited<ReturnType<typeof taskHost>>,task:unknown,waitId:string,userInput?:string)=>env.post('authorize',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',taskOperation:'resume',task,waitId,...(userInput===undefined?{}:{userInput})})
it('records a durable Agent wait without page control or a guest command and deduplicates it',async t=>{
  const env=await taskHost(t);await env.task('a')
  const result=await env.tool('a','browser_act',request)
  assert.equal(result.ok,true)
  assert.equal(expectRecord(result.value).taskState,'awaiting_user')
  assert.equal(expectRecord(expectRecord(result.value).wait).owner,'user')
  assert.equal(expectRecord(expectRecord(result.value).wait).source,'model_declared')
  const repeated=await env.tool('a','browser_act',request)
  assert.equal(expectRecord(expectRecord(expectOk(repeated)).wait).id,expectRecord(expectRecord(result.value).wait).id)
  assert.equal(expectRecord(expectOk(repeated)).contextVersion,expectRecord(result.value).contextVersion)
  assert.equal(expectOk(env.service.state.takeCommands('panel-a',1,env.service.config)).commands.length,0)
  const refused=await env.tool('a','browser_act',{action:'click',documentToken:'doc-a',elementRef:'element'})
  assert.equal(expectFailure(refused).code,'awaiting_user')
  const view=await env.tool('a','browser_observe',{view:'task'})
  assert.equal(expectRecord(expectRecord(expectRecord(expectOk(view)).active_context).waiting).id,expectRecord(expectRecord(result.value).wait).id)
  assert.equal(expectFailure((await env.tool('a','browser_release'))).code,'not_authorized')
})
it('requires actual new user input and never turns resume into page authorization or business success',async t=>{
  const env=await taskHost(t),task=(await env.task('a')).body.value.task
  const wait=expectRecord(expectOk((await env.tool('a','browser_act',request)))).wait
  assert.equal((await resume(env,task,expectString(expectRecord(wait).id))).body.error.code,'awaiting_user')
  assert.equal((await resume(env,task,'wait-foreign','Provided')).body.error.code,'task_not_bound')
  assert.equal((await resume(env,task,expectString(expectRecord(wait).id),'User selected a safe read-only scope')).status,200)
  assert.equal(expectFailure((await env.tool('a','browser_observe'))).code,'not_authorized')
  assert.equal(expectRecord(expectOk((await env.tool('a','browser_observe',{view:'task'})))).businessVerdict,'unverified')
  assert.equal((await resume(env,task,expectString(expectRecord(wait).id),'Late repeat')).body.error.code,'task_not_bound')
})
it('does not accept an old page grant or typed acknowledgement instead of a fresh authorization',async t=>{
  const env=await taskHost(t),task=(await env.task('a')).body.value.task
  await env.authorize('a',task)
  const wait=expectRecord(expectOk((await env.tool('a','browser_act',{...request,wait:{...request.wait,kind:'page_authorization'}})))).wait
  assert.equal((await resume(env,task,expectString(expectRecord(wait).id),'I confirm')).body.error.code,'awaiting_user')
  assert.equal((await env.authorize('a',task)).status,200)
  await env.post('revoke',{sessionId:'session-a'})
  assert.equal((await resume(env,task,expectString(expectRecord(wait).id))).body.error.code,'awaiting_user')
  assert.equal((await env.authorize('a',task)).status,200)
  assert.equal((await resume(env,task,expectString(expectRecord(wait).id))).status,200)
  assert.equal(expectRecord(expectOk((await env.tool('a','browser_observe',{view:'task'})))).state,'active')
})
it('recovers an outstanding wait without resolving it and rejects late input after a new revision',async t=>{
  const env=await taskHost(t);await env.task('a')
  const result=await env.tool('a','browser_act',request),oldId=expectRecord(expectRecord(expectOk(result)).wait).id
  await env.service.close()
  const store=new TaskStore(env.root,env.ctx.profileContext,100);t.after(()=>store.close())
  const access=await store.forSession('session-a')
  assert.equal(present((await store.view(access,8000)).active_context.waiting).id,oldId)
  assert.throws(()=>store.assertReady(access),{code:'awaiting_user'})
  await store.resumeWait(access,oldId,'New user input',()=>false)
  const next=await store.revise(access,{goal:'Revised synthetic goal'})
  const waiting=await store.declareWait(next,request.wait)
  await assert.rejects(store.resumeWait(next,oldId,'Late old input',()=>false),{code:'task_not_bound'})
  assert.equal(present((await store.view(next,8000)).active_context.waiting).id,waiting.id)
})
it('records the model-facing wait declaration through the existing tool result',async t=>{
  const env=await taskHost(t);await env.task('a')
  const result=await env.tool('a','browser_act',request),scope=expectRecord(expectOk(result)).task
  const actual=JSON.stringify({tool:'browser_act',args:request,result},null,2).replaceAll(expectString(expectRecord(scope).profileId),'PROFILE').replaceAll(expectString(expectRecord(scope).taskId),'TASK').replaceAll(expectString(expectRecord(scope).runId),'RUN').replaceAll(expectString(expectRecord(expectRecord(expectOk(result)).wait).id),'WAIT')+'\n'
  assert.equal(actual,await readFile(new URL('./expected/task-user-wait.json',import.meta.url),'utf8'))
})
it('rejects forged callers, page fields and model attempts to resolve a user wait',async t=>{
  const env=await taskHost(t);await env.task('a');await env.task('b')
  assert.equal(expectFailure((await env.tool('a','browser_act',{...request,elementRef:'element'}))).code,'invalid_request')
  assert.equal(expectFailure((await env.tool('a','browser_act',{...request,wait:{...request.wait,qualified:true}}))).code,'invalid_request')
  assert.equal(expectFailure((await env.tool('a','browser_act',{action:'resume',waitId:'fake'}))).code,'invalid_request')
  env.agents.set('session-a',{id:'session-a'})
  const tool=env.service.tools.get('browser_act')
  assert.equal(expectFailure((await present(tool).execute(request,{agent:{id:'session-a'},signal:new AbortController().signal}))).code,'agent_mismatch')
})
it('does not register waits during pending writes, after unknown writes or when the log fails',async t=>{
  const env=await taskHost(t);await env.task('a')
  const store=env.service.tasks,access=store.current('session-a')
  const attempt=await store.beginAttempt(present(access),'click')
  assert.equal(expectFailure((await env.tool('a','browser_act',request))).code,'task_busy')
  await store.receipt(present(access),attempt,'unknown_outcome')
  assert.equal(expectFailure((await env.tool('a','browser_act',request))).code,'task_write_blocked')
  await env.task('b')
  await env.authorize('b')
  const other=store.current('session-b'),path=join(store.openTask(present(other)).dir,'basic_law_index/events.jsonl')
  await rename(path,path+'.preserved');await mkdir(path)
  assert.equal(expectFailure((await env.tool('b','browser_act',request))).code,'task_storage_failed')
  assert.equal((await env.tool('b','browser_release')).ok,true)
  assert.equal((await env.tool('a','browser_observe',{view:'task'})).ok,true)
})
it('keeps wait output in the owner Session and preserves its reason in a bounded summary',async t=>{
  const env=await taskHost(t);await env.task('a');await env.task('b')
  const result=await env.tool('a','browser_act',{...request,wait:{...request.wait,reason:'PRIVATE_WAIT_A '+ 'x'.repeat(900)}})
  assert.equal(result.ok,true)
  const a=env.service.tasks.current('session-a')
  const compact=(await env.service.tasks.view(present(a),1800))
  assert.ok(JSON.stringify(compact).length<=1800)
  assert.ok(present(compact.active_context.waiting).reason.startsWith('PRIVATE_WAIT_A'))
  assert.ok(!JSON.stringify(await env.tool('b','browser_observe',{view:'task'})).includes('PRIVATE_WAIT_A'))
  const bytes=await readFile(join(env.service.tasks.openTask(present(a)).dir,'basic_law_index/events.jsonl'),'utf8')
  assert.ok(bytes.includes('wait_requested'))
})
