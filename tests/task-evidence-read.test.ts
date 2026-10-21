import assert from 'node:assert/strict'
import { it } from 'node:test'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { navigation } from './helpers/task-navigation.ts'
import { present, expectOk, expectRecord, expectString, expectList } from './helpers/assertions.ts'
import { taskFacts } from '../src/task-facts.ts'

function barrier(){let release=()=>{},entered=()=>{};const gate=new Promise<void>(r=>{release=r}),ready=new Promise<void>(r=>{entered=r});return {release,entered,gate,ready}}
async function fixture(t:import('node:test').TestContext){
 const env=await navigation(t),store=env.service.tasks,access=present(env.access),data=store.openTask(access)
 const proof=present(data.events.find(e=>e.type==='asset'&&e.data.kind==='evidence')),proofRef=String(proof.data.id),path=join(data.dir,expectString(expectRecord(proof.data.data).artifact))
 return {...env,store,access,data,proofRef,path}
}
it('verifies each unchanged original once in a normal tool task observation and again in each new request',async t=>{
 const {store,tool}=await fixture(t);let reads=0;const read=store.readArtifact.bind(store)
 store.readArtifact=async(...args)=>{reads++;return read(...args)}
 for(let request=1;request<=2;request++){
  const view=expectRecord(expectOk(await tool('a','browser_observe',{view:'task'})))
  assert.equal(view.businessVerdict,'entry_reached');assert.equal(reads,request)
 }
})
it('reuses shared attachment bytes within one fact read only',async t=>{
 const {store,access,data,path}=await fixture(t),value=expectRecord(JSON.parse(await readFile(path,'utf8')))
 const attachment=join(data.dir,'evidence',access.run.runId,'synthetic.bin');await writeFile(attachment,'synthetic-private-content')
 const ref=await store.artifact(access,attachment,'snapshot')
 await store.proof(access,{...value,files:[ref]});await store.proof(access,{...value,files:[ref]})
 let reads=0;const read=store.readArtifact.bind(store);store.readArtifact=async(...args)=>{reads++;return read(...args)}
 await store.view(access,8000);assert.equal(reads,4)
 await store.view(access,8000);assert.equal(reads,8)
})
it('discards a derived graph when evidence changes during Go work and returns freshly checked Host facts',async t=>{
 const {service,store,access,path}=await fixture(t),hold=barrier(),project=service.graph.project.bind(service.graph)
 service.graph.project=async(...args)=>{const result=await project(...args);hold.entered();await hold.gate;return result}
 const reading=store.view(access,8000)
 try{await hold.ready;await writeFile(path,'{}\n')}finally{hold.release()}
 const view=await reading
 assert.equal(view.active_context.businessVerdict,'unverified');assert.equal(view.active_context.graph.reason,'stale_projection')
})
it('fact details independently recheck their originals without relying on a service pre-pass',async t=>{
 const {store,access,path}=await fixture(t)
 await unlink(path)
 const detail=expectRecord(await store.detail(access,'criteria',0,8000))
 assert.ok(expectList(JSON.parse(expectString(detail.text))).every(c=>expectRecord(c).status!=='passed'))
})
for(const mode of ['replace','delete','change'] as const)it(`refuses proof ${mode} between byte read and final evidence publication`,async t=>{
 const {store,access,path}=await fixture(t),read=store.readArtifact.bind(store)
 let changed=false
 store.readArtifact=async(...args)=>{
  const bytes=await read(...args)
  if(!changed){changed=true;if(mode==='replace'){await writeFile(path+'.replacement',bytes);await rename(path+'.replacement',path)}else if(mode==='delete')await unlink(path);else await writeFile(path,'{}\n')}
  return bytes
 }
 await store.refreshEvidence(access)
 assert.equal(taskFacts(store.openTask(access)).verdict,'unverified')
})
it('does not publish an old run evidence check over a newer run',async t=>{
 const {store,access}=await fixture(t),hold=barrier(),read=store.readArtifact.bind(store)
 store.readArtifact=async(...args)=>{const bytes=await read(...args);hold.entered();await hold.gate;return bytes}
 const reading=store.refreshEvidence(access),refused=assert.rejects(reading,{code:'task_not_bound'})
 try{
  await hold.ready
  const next=await store.revise(access,{newRun:true})
  await store.refreshEvidence(next)
  assert.equal(store.openTask(next).checkedProofs?.size,0)
  hold.release();await refused
  assert.equal(store.openTask(next).checkedProofs?.size,0)
 }finally{hold.release()}
})
it('rejects evidence publication if the journal changes during its read',async t=>{
 const {store,access}=await fixture(t),hold=barrier(),read=store.readArtifact.bind(store)
 store.readArtifact=async(...args)=>{const bytes=await read(...args);hold.entered();await hold.gate;return bytes}
 const reading=store.refreshEvidence(access),refused=assert.rejects(reading,{code:'task_busy'})
 try{await hold.ready;await store.asset(access,'page',{documentToken:'new-document'});hold.release();await refused}finally{hold.release()}
})
it('invalidates an earlier proof changed while reading a later original',async t=>{
 const {store,access,path,proofRef}=await fixture(t)
 await store.proof(access,{schemaVersion:1,run:access.run,kind:'synthetic'})
 const read=store.readArtifact.bind(store);let count=0
 store.readArtifact=async(...args)=>{const bytes=await read(...args);if(++count===2)await writeFile(path,'{}\n');return bytes}
 await store.refreshEvidence(access)
 assert.equal(store.openTask(access).checkedProofs?.has(proofRef),false)
 assert.equal(taskFacts(store.openTask(access)).verdict,'unverified')
})
it('does not return graph detail checked before an original changed during Go work',async t=>{
 const {service,store,access,path}=await fixture(t),hold=barrier(),detail=service.graph.detail.bind(service.graph)
 service.graph.detail=async(...args)=>{const value=await detail(...args);hold.entered();await hold.gate;return value}
 const reading=store.detail(access,'graph',0,8000),refused=assert.rejects(reading,{code:'task_not_bound'})
 try{await hold.ready;await unlink(path);hold.release();await refused}finally{hold.release()}
 assert.equal(taskFacts(store.openTask(access)).verdict,'unverified')
})
it('independently revalidates verdict evidence after a prior successful view',async t=>{
 const {store,access,path,proofRef}=await fixture(t)
 assert.equal((await store.view(access,8000)).active_context.businessVerdict,'entry_reached')
 await writeFile(path,'{}\n')
 assert.equal(await store.verdict(access,{verdict:'entry_reached'},proofRef),'unverified')
})
