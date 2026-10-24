import {present} from './helpers/assertions.ts'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { it } from 'node:test'
import { TaskStore } from '../src/task-store.ts'
import { syntheticDefinition } from './helpers/task-definition.ts'
import { GraphWorkers } from '../src/graph/worker.ts'
import { resolveConfig } from '../src/config.ts'

async function fixture(t:import('node:test').TestContext) {
  const root=await mkdtemp(join(tmpdir(),'bf-task-store-'))
  const profile={name:'test',home:join(root,'home')}
  const store=new TaskStore(root,profile,100)
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
  return {root,store,profile}
}
const spec={workflowRef:'generic',goal:'Read a synthetic task',origins:['https://one.example','https://two.example'],constraints:['Do not submit'],criteria:['Current visible document observed']}
it('rejects invalid task display budgets before evidence or graph work',async t=>{
  const {store}=await fixture(t),access=await store.create('budget-owner',spec)
  store.refreshEvidence=async()=>{assert.fail('invalid display budget reached evidence work')}
  for(const budget of [0,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
    await assert.rejects(store.view(access,budget),{code:'invalid_request'})
    await assert.rejects(store.detail(access,'graph',0,budget),{code:'invalid_request'})
  }
})
it('returns committed end and revision results when derived cleanup fails, including after recovery',async t=>{
  const {store,root,profile}=await fixture(t)
  const graph=new GraphWorkers(resolveConfig({}))
  graph.retire=async()=>{throw new Error('exit observation failed')}
  store.graph=graph
  const a=await store.create('session-a',spec),b=await store.create('session-b',spec)
  await store.end(a,'cancelled')
  const revised=await store.revise(b,{goal:'Durably revised'})
  assert.equal(revised.scope.scopeRevision,2)
  await store.close()
  const recovered=new TaskStore(root,profile,100);t.after(()=>recovered.close())
  assert.equal(recovered.openTask(await recovered.forSession('session-a')).state,'cancelled')
  assert.equal(recovered.openTask(await recovered.forSession('session-b')).manifest.goal,'Durably revised')
})
it('persists one Session ownership and rejects task, profile, Session and revision forgeries',async t=>{
  const {store}=await fixture(t)
  const a=await store.create('session-a',spec)
  const b=await store.create('session-b',spec)
  assert.notEqual(a.scope.taskId,b.scope.taskId)
  for(const patch of [{taskId:b.scope.taskId},{ownerSessionId:'session-b'},{profileId:'profile-'+ '0'.repeat(32)},{scopeRevision:2}] as const){
    await assert.rejects(store.forSession('session-a',{...a.scope,...patch}),{code:'task_not_bound'})
  }
  assert.throws(()=>store.openTask({...a}),{code:'task_not_bound'})
  await assert.rejects(store.create('session-a',spec),{code:'task_bound'})
  const revised=await store.revise(a,{goal:'Revised goal'})
  assert.equal(revised.scope.scopeRevision,2)
  assert.throws(()=>store.openTask(a),{code:'task_not_bound'})
  store.assertPage(revised,'https://two.example/path')
  assert.throws(()=>store.assertPage(revised,'https://outside.example'),{code:'task_scope_mismatch'})
})
it('snapshots local definitions; changed local files do not replace existing instructions',async t=>{
  const {store,root,profile}=await fixture(t)
  const def=syntheticDefinition({root})
  const a=await store.create('session-a',{definitionId:def.definition.id,workflowRef:'read',goal:'Synthetic'})
  await writeFile(join(def.dir,'instructions/steps.md'),'CHANGED_LOCAL_DEFINITION')
  assert.ok(present(store.openTask(a).snapshot).files['instructions/steps.md'].includes(def.marker))
  await store.close()
  const restored=new TaskStore(root,profile,100)
  t.after(()=>restored.close())
  const loaded=await restored.forSession('session-a')
  assert.equal(loaded.scope.taskId,a.scope.taskId)
  assert.ok(present(restored.openTask(loaded).snapshot).files['instructions/steps.md'].includes(def.marker))
})
it('unknown writes survive new runs, revision, handoff and restart without replay',async t=>{
  const {store,root,profile}=await fixture(t)
  const a=await store.create('session-a',spec)
  const attempt=await store.beginAttempt(a,'click')
  await store.receipt(a,attempt,'unknown_outcome')
  assert.throws(()=>store.openTask(a,true),{code:'task_write_blocked'})
  const next=await store.revise(a,{newRun:true})
  assert.throws(()=>store.openTask(next,true),{code:'task_write_blocked'})
  await store.end(next,'handed_off')
  await store.close()
  const restored=new TaskStore(root,profile,100);t.after(()=>restored.close())
  const loaded=await restored.forSession('session-a')
  assert.throws(()=>restored.openTask(loaded,true),{code:'task_write_blocked'})
  assert.equal(restored.openTask(loaded).state,'handed_off')
})
it('unfinished attempts and damaged tails block writes and preserve journal bytes',async t=>{
  for(const damaged of [false,true] as const){
    const {store,root,profile}=await fixture(t)
    const a=await store.create('session-a',spec)
    await store.beginAttempt(a,'set_file')
    const path=join(store.openTask(a).dir,'basic_law_index/events.jsonl')
    await store.close()
    if(damaged)await appendFile(path,'{"incomplete":')
    const before=await readFile(path)
    const restored=new TaskStore(root,profile,100);t.after(()=>restored.close())
    const loaded=await restored.forSession('session-a')
    assert.throws(()=>restored.openTask(loaded,true),{code:'task_write_blocked'})
    assert.ok(restored.openTask(loaded).events.length>=2)
    assert.deepEqual(await readFile(path),before)
  }
})
it('enforces a single profile writer and does not reclaim a live process lock',async t=>{
  const {store,root,profile}=await fixture(t)
  await store.create('session-a',spec)
  const contender=new TaskStore(root,profile,0);t.after(()=>contender.close())
  await assert.rejects(contender.create('session-b',spec),{code:'task_unavailable'})
})
it('keeps independently readable history available when writer acquisition fails',async t=>{
  const {store,root,profile}=await fixture(t)
  const a=await store.create('session-a',spec)
  const readOnly=new TaskStore(root,profile,0);t.after(()=>readOnly.close())
  const loaded=await readOnly.forSession('session-a')
  assert.equal(loaded.scope.taskId,a.scope.taskId)
  assert.equal(readOnly.openTask(loaded).manifest.goal,spec.goal)
  assert.throws(()=>readOnly.openTask(loaded,true),{code:'task_unavailable'})
})
