import assert from 'node:assert/strict'
import { it } from 'node:test'
import { currentRunReferences, taskFacts, taskReferences } from '../src/task-facts.ts'
import { taskHost } from './helpers/task-host.ts'
import { expectRecord, expectString, present } from './helpers/assertions.ts'

it('shares reference generation across multiple runs while keeping historical reads separate from new relations',async t=>{
  const env=await taskHost(t);await env.task('a');await env.task('b')
  const store=env.service.tasks;let access=present(store.current('session-a'))
  const foreign=await store.asset(present(store.current('session-b')),'page',{})
  const history:string[][]=[]
  for(let round=0;round<3;round++){
    if(round)access=await store.revise(access,{goal:'Synthetic revision '+round,criteria:['Current free text']})
    const refs=[`goal-${access.run.taskId}-r${access.run.scopeRevision}`]
    for(const kind of ['page','file','unit_check','import_result','evidence'])refs.push(await store.asset(access,kind,{marker:'synthetic-'+round}))
    const attempt=await store.beginAttempt(access,'click');refs.push(attempt)
    await store.receipt(access,attempt,'executed')
    refs.push(`receipt-${access.run.taskId}-${store.openTask(access).events.at(-1)!.seq}`)
    history.push(refs)
  }
  const data=store.openTask(access),all=taskReferences(data),current=taskReferences(data,{currentRunOnly:true}),criteria=taskFacts(data).criteria.map(c=>c.id)
  assert.deepEqual(all,new Set([...history.flat(),...criteria]))
  assert.deepEqual(current,new Set([...history.at(-1)!,...criteria]))
  assert.deepEqual(currentRunReferences(data),current)
  assert.ok([...current].every(ref=>all.has(ref)))
  assert.equal(all.has(foreign),false);assert.equal(current.has(foreign),false)
  const ownPage=history.at(-1)![1],ownAttempt=history.at(-1)![6]
  await store.relate(access,ownAttempt,ownPage,'observed_on')
  for(const refs of history.slice(0,-1)){
    for(const ref of refs){
      const value=expectRecord(await store.detail(access,ref,0,10000))
      assert.ok(expectString(value.text).includes(ref),'every admitted historical goal, asset, attempt and receipt remains readable')
      await assert.rejects(store.relate(access,ownAttempt,ref,'observed_on'),{code:'task_not_bound'})
    }
  }
  await assert.rejects(store.relate(access,ownAttempt,foreign,'observed_on'),{code:'task_not_bound'})
})

it('keeps legacy references readable without granting relation authority to missing or foreign runs',async t=>{
  const env=await taskHost(t);await env.task('a')
  const store=env.service.tasks,access=present(store.current('session-a')),data=structuredClone(store.openTask(access))
  for(const [id,run] of [['asset-legacy',undefined],['asset-other-run',{...access.run,scopeRevision:access.run.scopeRevision+1}]] as const){
    data.events.push({seq:data.events.length+1,prev:'',hash:'synthetic',type:'asset',data:{id,kind:'page',data:{},...(run?{run}:{})}})
  }
  const all=taskReferences(data),current=taskReferences(data,{currentRunOnly:true})
  for(const id of ['asset-legacy','asset-other-run']){assert.equal(all.has(id),true);assert.equal(current.has(id),false)}
  for(const id of ['resource-synthetic','digest-synthetic']){assert.equal(all.has(id),false);assert.equal(current.has(id),false)}
})
