import assert from 'node:assert/strict'
import { it } from 'node:test'
import { readFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { taskHost } from './helpers/task-host.js'

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
const action={action:'click',documentToken:'doc-a',elementRef:'el-0'}
async function ready(t){const env=await taskHost(t);env.scope=(await env.task('a')).body.value.task;await env.authorize('a',env.scope);return env}
function pauseAttempt(env,afterSync=false){
  const entered=deferred(),resume=deferred();const original=env.service.tasks.appendOwned.bind(env.service.tasks)
  env.service.tasks.appendOwned=async(...args)=>{
    if(args[1]!=='attempt')return original(...args)
    if(afterSync){const event=await original(...args);entered.resolve();await resume.promise;return event}
    entered.resolve();await resume.promise;return original(...args)
  }
  return {entered,resume}
}
function queued(env){const seen=deferred();const original=env.service.state.run;env.service.state.run=(...args)=>{const pending=original(...args);seen.resolve();return pending};return seen.promise}
async function take(env){return (await env.post('poll',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',pages:[env.page('a')]})).body.value.commands}
async function settle(env,command,outcome='ok') {return env.post('result',{kind:'result',task:command.task,id:command.id,leaseId:command.leaseId,instanceId:'panel-a',connectionGeneration:1,epoch:command.epoch,sequence:command.sequence,outcome,payload:{documentToken:'doc-a',action:'click',dispatched:true}})}
it('revokes without waiting for the durable attempt; resumption never queues the old write',async t=>{
  const env=await ready(t),barrier=pauseAttempt(env)
  const pending=env.tool('a','browser_act',action)
  await barrier.entered.promise
  assert.deepEqual(await take(env),[])
  assert.equal((await env.post('revoke',{sessionId:'session-a'})).body.value.pageRetained,true)
  barrier.resume.resolve()
  assert.equal((await pending).error.code,'revoked')
  assert.deepEqual(await take(env),[])
})
it('deducts WAL time from the original command budget, including exactly expired attempts',async t=>{
  for(const elapsed of [900,1000]){
    const env=await ready(t)
    env.service.config={...env.service.config,commandBudgetMs:1000,waitMaxMs:100}
    let now=0;env.service.now=()=>now
    const barrier=pauseAttempt(env,true),admitted=queued(env)
    const pending=env.tool('a','browser_act',action)
    await barrier.entered.promise
    now=elapsed;barrier.resume.resolve()
    if(elapsed===1000){assert.equal((await pending).error.code,'deadline_exceeded');assert.deepEqual(await take(env),[])}
    else {await admitted;const [command]=await take(env);assert.ok(command.budgetMs<=100);assert.equal(command.sequence,0);await settle(env,command);assert.equal((await pending).ok,true)}
  }
})
it('unknown delivered writes block every act and file grant across a new run; safe reads and release remain usable',async t=>{
  const env=await ready(t),admitted=queued(env)
  const pending=env.tool('a','browser_act',action)
  await admitted;const [command]=await take(env)
  await env.post('invalidate',{instanceId:'panel-a',connectionGeneration:1,lease:'guest-a',event:'connection_lost'})
  assert.equal((await pending).error.code,'unknown_outcome')
  assert.equal((await env.tool('a','browser_act',action)).error.code,'task_write_blocked')
  let scope=(await env.post('authorize',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',taskOperation:'revise',task:env.scope,spec:{newRun:true}})).body.value.task
  await env.authorize('a',scope)
  assert.equal((await env.post('authorize',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',...env.page('a'),fileOperation:'prepare',path:'/must-not-read.xlsx'})).body.error.code,'task_write_blocked')
  assert.equal((await env.tool('a','browser_observe',{view:'task'})).value.writeBlocked,true)
  assert.equal((await env.tool('a','browser_release')).value.pageRetained,true)
  assert.equal((await settle(env,command)).status,409)
})
it('a journal failure prevents dispatch and cannot prevent permission withdrawal',async t=>{
  const env=await ready(t)
  const access=env.service.tasks.current('session-a')
  const journal=join(env.service.tasks.openTask(access).dir,'basic_law_index/events.jsonl')
  await rename(journal,journal+'.preserved');await mkdir(journal)
  assert.equal((await env.tool('a','browser_act',action)).error.code,'task_storage_failed')
  assert.deepEqual(await take(env),[])
  assert.equal((await env.tool('a','browser_release')).value.pageRetained,true)
  const view=await env.tool('a','browser_observe',{view:'task'})
  assert.equal(view.value.writeBlocked,true)
})
it('shutdown retains the task writer until an admitted write records its terminal result',async t=>{
  const env=await ready(t),barrier=pauseAttempt(env,true)
  const access=env.service.tasks.current('session-a')
  const journal=join(env.service.tasks.openTask(access).dir,'basic_law_index/events.jsonl')
  const pending=env.tool('a','browser_act',action)
  await barrier.entered.promise
  let closed=false;const closing=env.service.close().then(()=>{closed=true})
  await Promise.resolve();assert.equal(closed,false)
  barrier.resume.resolve()
  assert.equal((await pending).error.code,'revoked')
  await closing
  const history=(await readFile(journal,'utf8')).trim().split('\n').map(line=>JSON.parse(line))
  assert.equal(history.at(-1).type,'receipt')
  assert.equal(history.at(-1).data.outcome,'not_executed')
})
