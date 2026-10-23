import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { it, type TestContext } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { taskFacts } from '../src/task-facts.ts'
import { taskView } from '../src/task-projections.ts'
import type { TaskData } from '../src/task-store.ts'
import { taskHost } from './helpers/task-host.ts'
import { navigation } from './helpers/task-navigation.ts'
import { syntheticDefinition } from './helpers/task-definition.ts'
import { facts, people, scope, workbook } from './import-fixture.ts'
import { expectRecord, expectString, present } from './helpers/assertions.ts'

async function importProof(t:TestContext) {
  const env=await taskHost(t),definition=syntheticDefinition({root:env.root})
  await writeFile(join(definition.dir,'definition.json'),JSON.stringify({...definition.definition,adapter:'bjrsj',origins:['https://fuwu.rsj.beijing.gov.cn'],workflows:definition.definition.workflows.map(w=>({...w,id:'import',stopBoundary:'import_confirmed'}))}))
  await env.task('a',{definitionId:'synthetic',workflowRef:'import',goal:'Synthetic import fact reuse'})
  const store=env.service.tasks,access=present(store.current('session-a')),data=store.openTask(access),bytes=workbook(),sha256=createHash('sha256').update(bytes).digest('hex')
  const directory=join(data.dir,'evidence',access.run.runId);await mkdir(directory,{recursive:true})
  const snapshot=join(directory,'input.xlsx'),dispatch=join(directory,'dispatch.json'),fileGrantId='synthetic-file-grant'
  await writeFile(snapshot,bytes)
  await writeFile(dispatch,JSON.stringify({fileGrantId,sha256,binding:JSON.stringify([access.run,'panel',1,'lease',1,'partition','doc'])}))
  const fileRef=await store.asset(access,'file',{sha256,bytes:bytes.length,rows:people.length,kind:scope.kind},'code_verified')
  const attemptId=await store.beginAttempt(access,'set_file');await store.receipt(access,attemptId,'executed',{fileGrantId})
  const resultRef=await store.asset(access,'import_result',{verdict:'import_confirmed',qualified:true},'code_verified')
  const proofRef=await store.proof(access,{schemaVersion:1,kind:'import',run:access.run,scope,documentToken:'doc',fileRef,resultRef,attemptId,fileGrantId,files:[await store.artifact(access,snapshot,'snapshot'),await store.artifact(access,dispatch,'dispatch')],evidence:{unitBodies:[JSON.stringify({map:{data:[{unitDTO:{unitId:scope.unitId,socialCreditCode:scope.legalIdentity}}]}})],unitPending:0,coverage:true,closed:true,expired:false,cleanupFailed:false,fileGrantId,facts:facts()}})
  assert.equal(await store.verdict(access,{verdict:'import_confirmed',qualified:true},proofRef),'import_confirmed')
  return {...env,access}
}

/** Count complete fact-selection passes without timing or a production test hook. */
function countFacts(data:TaskData) {
  const original=data.events;let passes=0
  data.events=new Proxy(original,{get(target,key,receiver){if(key===Symbol.iterator)return function(){passes++;return target[Symbol.iterator]()};return Reflect.get(target,key,receiver)}})
  return {reset(){passes=0},get passes(){return passes},restore(){data.events=original}}
}

for(const kind of ['navigation','import','unproved'] as const)it(`reuses read-phase facts for ${kind} views, summaries and criterion details`,async t=>{
  const env=kind==='navigation'?await navigation(t):kind==='import'?await importProof(t):await taskHost(t)
  if(kind==='unproved')await env.task('a',{goal:'Synthetic unproved',origins:['https://a.example'],criteria:['Free text']})
  const store=env.service.tasks,access=present(store.current('session-a')),data=store.openTask(access),expected=taskFacts(data),criterion=present(expected.criteria.find(c=>c.source==='code_verified')??expected.criteria[0]),counter=countFacts(data)
  try{
    const view=taskView(data,8000,undefined,'unavailable',store.writable)
    assert.equal(counter.passes,1);assert.equal(view.active_context.businessVerdict,expected.verdict)
    counter.reset();const summary=await env.service.taskSummary(access)
    assert.equal(counter.passes,1);assert.equal(summary.businessVerdict,expected.verdict);assert.equal(summary.active_context.businessVerdict,expected.verdict)
    for(const ref of [criterion.id,'criteria','coverage']){
      counter.reset();const reply=expectRecord(await store.detail(access,ref,0,10000))
      assert.equal(counter.passes,2,'facts before and after evidence refresh must be retained, with no third computation')
      if(ref===criterion.id)assert.deepEqual(expectRecord(JSON.parse(expectString(reply.text))).proofRefs,expected.proofRef?[expected.proofRef]:[])
    }
  }finally{counter.restore()}
})

it('keeps summary verdict and Host coverage coherent when the graph fails',async t=>{
  const env=await importProof(t),access=env.access
  env.service.graph.project=async()=>{throw new Error('synthetic graph failure')}
  const summary=await env.service.taskSummary(access,true)
  assert.equal(summary.businessVerdict,'import_confirmed');assert.equal(summary.active_context.businessVerdict,'import_confirmed')
  assert.equal(summary.active_context.coverage.verified,1);assert.equal(summary.active_context.graph.status,'unavailable')
})
