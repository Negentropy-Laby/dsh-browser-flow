import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { it } from 'node:test'
import { resolveConfig } from '../src/config.ts'
import { graphInput } from '../src/task-projections.ts'
import { eventResourceDescriptor, fileIdentity, pageIdentity, resourceDescriptor } from '../src/task-resources.ts'
import type { TaskData, TaskEvent } from '../src/task-store.ts'
import type { RunScope } from '../src/task-scope.ts'
import { TASK } from './helpers/task-scope.ts'

function asset(index:number):TaskEvent {
  return {schemaVersion:1,seq:index+1,prev:'',hash:'synthetic-'+index,type:'asset',data:{id:'asset-synthetic-'+index,kind:['page','file','unit_check','import_result','evidence'][index%5],source:'host',run:TASK,data:{}}}
}

it('hashes each immutable asset once across repeated graph input and lookup paths',t=>{
  const {runId,workflowRef,...scope}=TASK
  const task:TaskData={dir:'',manifest:{schemaVersion:1,scope,runId,workflowRef,goal:'Synthetic cache',constraints:[],criteria:[],origins:['https://example.test'],adapter:'generic',adapterVersion:1},events:Array.from({length:250},(_,i)=>asset(i)),blocked:false,unhealthy:false,state:'active'}
  let calls=0;const original=crypto.createHash
  const mock=t.mock.method(crypto,'createHash',(algorithm:string,options?:Parameters<typeof original>[1])=>{if(algorithm==='sha256')calls++;return original(algorithm,options)})
  syncBuiltinESMExports()
  try{
    const first=graphInput(task,resolveConfig({}))
    for(let i=0;i<3;i++)assert.deepEqual(graphInput(task,resolveConfig({})),first)
    assert.equal(calls,250,'four full input builds must hash each descriptor only once')
    assert.equal(eventResourceDescriptor(task.events[0]!,TASK),first.events[0]!.resource)
    assert.throws(()=>{eventResourceDescriptor(task.events[0]!,TASK).id='forged'},TypeError)
    assert.equal(calls,250,'resource and page lookup callers share the same cached row')
    task.events.push(asset(250));const appended=graphInput(task,resolveConfig({}))
    assert.equal(calls,251,'appending one row adds one descriptor computation')
    assert.deepEqual(graphInput(structuredClone(task),resolveConfig({})),appended)
    assert.equal(calls,502,'recovered row objects rebuild deterministically without sharing a live cache')
  }finally{mock.mock.restore();syncBuiltinESMExports()}
})

it('binds cached descriptors to every RunScope field and distinct event objects',()=>{
  const row=asset(0),first=eventResourceDescriptor(row,TASK)
  const scopes:RunScope[]=[
    {...TASK,profileId:('profile-'+'b'.repeat(32)) as RunScope['profileId']},
    {...TASK,taskId:'task-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' as RunScope['taskId']},
    {...TASK,ownerSessionId:TASK.ownerSessionId+'-other'},
    {...TASK,scopeRevision:TASK.scopeRevision+1},
    {...TASK,runId:'run-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' as RunScope['runId']},
    {...TASK,workflowRef:TASK.workflowRef+'-other'},
  ]
  for(const run of scopes){assert.notEqual(eventResourceDescriptor(row,run).id,first.id);assert.equal(eventResourceDescriptor(row,TASK).id,first.id)}
  const other=structuredClone(row);other.data.kind='file'
  assert.notEqual(eventResourceDescriptor(other,TASK).id,first.id)
})

it('preserves baseline Host identity bytes with controls, HTML, separators and Unicode',()=>{
  const chars=String.fromCharCode(...Array.from({length:32},(_,i)=>i))+'<>&\u2028\u2029中文😀'
  const run={...TASK,ownerSessionId:'owner-'+chars,workflowRef:'workflow-'+chars}
  const guest={connectionInstanceId:'connection',connectionGeneration:1,lease:'guest-'+chars,partition:'partition-'+chars,documentToken:'doc-'+chars}
  const page=pageIdentity(run,guest,'observation'),file=fileIdentity(run,'/synthetic/中文😀.xlsx')
  // Vectors captured from the pre-fix 6e5b2b4 implementation.
  assert.equal(page.key,'b5ca2bcb84ea799d9f2e2cc869420dd8f4c530f98e4c7d921d8512bbae846862')
  assert.equal(file.key,'987a7e7cfb48c9350717a1dbc6637e4fd974ffc7662395e3330ac88661382ae2')
  assert.equal(resourceDescriptor(run,'page','asset-page',{resourceIdentity:page}).id,'resource-01d3234d8ca74cc437d5971064faad7b38cf4874d03d6d3d54439ae4e309c7f5')
  assert.equal(resourceDescriptor(run,'file','asset-file',{resourceIdentity:file}).id,'resource-033cef5e3350690c21767131eb6388feede94570937d4183386d885551d9d297')
  assert.equal(resourceDescriptor(run,'unit_check','asset-check',{}).id,'resource-36cf4030668508966e7e5f079617239c258695083bf5a474bf62f10ac2cb299a')
  assert.equal(resourceDescriptor(run,'page','asset-old',{}).id,'resource-213fe642f95007831af63d47d1f9e04426027d28d788ce2247a18fadef0a69c3')
  const reordered={workflowRef:run.workflowRef,runId:run.runId,scopeRevision:run.scopeRevision,ownerSessionId:run.ownerSessionId,taskId:run.taskId,profileId:run.profileId}
  assert.deepEqual(pageIdentity(reordered,guest,'observation'),page)
})
