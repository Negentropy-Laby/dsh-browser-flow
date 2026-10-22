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
it('verifies each unchanged original twice per tool task observation without caching across requests',async t=>{
 const {store,tool}=await fixture(t);let reads=0;const read=store.readArtifact.bind(store)
 store.readArtifact=async(...args)=>{reads++;return read(...args)}
 for(let request=1;request<=2;request++){
  const view=expectRecord(expectOk(await tool('a','browser_observe',{view:'task'})))
  assert.equal(view.businessVerdict,'entry_reached');assert.equal(reads,request*2)
 }
})
it('reuses shared attachment bytes within one fact read only',async t=>{
 const {store,access,data,path}=await fixture(t),value=expectRecord(JSON.parse(await readFile(path,'utf8')))
 const attachment=join(data.dir,'evidence',access.run.runId,'synthetic.bin');await writeFile(attachment,'synthetic-private-content')
 const ref=await store.artifact(access,attachment,'snapshot')
 await store.proof(access,{...value,files:[ref]});await store.proof(access,{...value,files:[ref]})
 let reads=0;const read=store.readArtifact.bind(store);store.readArtifact=async(...args)=>{reads++;return read(...args)}
 await store.view(access,8000);assert.equal(reads,8)
 await store.view(access,8000);assert.equal(reads,16)
})
it('rejects changed proof bytes even when the metadata provider retains the original identity',async t=>{
 const {store,access,data,path,proofRef}=await fixture(t),state=store.artifactState.bind(store),read=store.readArtifact.bind(store)
 const proof=present(data.events.find(e=>e.data.id===proofRef)),ref={role:'proof',path:expectString(expectRecord(proof.data.data).artifact),sha256:expectString(expectRecord(proof.data.data).sha256),bytes:Number(expectRecord(proof.data.data).bytes)}
 const originalState=await state(data,ref);let reads=0
 // Fixed metadata isolates content verification; it does not claim a real-volume timestamp attack.
 store.artifactState=async(owner,item)=>item.path===ref.path?originalState:state(owner,item)
 store.readArtifact=async(...args)=>{reads++;const bytes=await read(...args);if(reads===1)await writeFile(path,Buffer.alloc(bytes.length,32));return bytes}
 await store.refreshEvidence(access)
 assert.equal(reads,2);assert.equal(data.checkedProofs?.has(proofRef),false)
 assert.ok(data.evidenceIssues?.includes(proofRef));assert.equal(taskFacts(data).verdict,'unverified')
})
it('invalidates every proof depending on changed shared bytes with fixed reported metadata',async t=>{
 const {store,access,data,path}=await fixture(t),value=expectRecord(JSON.parse(await readFile(path,'utf8')))
 const attachment=join(data.dir,'evidence',access.run.runId,'shared.bin');await writeFile(attachment,'original-private-content')
 const ref=await store.artifact(access,attachment,'snapshot'),left=await store.proof(access,{...value,files:[ref]}),right=await store.proof(access,{...value,files:[ref]})
 const state=store.artifactState.bind(store),read=store.readArtifact.bind(store),originalState=await state(data,ref);let sharedReads=0
 store.artifactState=async(owner,item)=>item.path===ref.path?originalState:state(owner,item)
 store.readArtifact=async(...args)=>{const shared=args[1].path===ref.path;if(shared)sharedReads++;const bytes=await read(...args);if(shared&&sharedReads===1)await writeFile(attachment,Buffer.alloc(bytes.length,32));return bytes}
 await store.refreshEvidence(access)
 assert.equal(sharedReads,2)
 for(const id of [left,right]){assert.equal(data.checkedProofs?.has(id),false);assert.ok(data.evidenceIssues?.includes(id))}
})
it('never publishes a superseded evidence check over the newer request result',async t=>{
 const {store,access,data,path}=await fixture(t),hold=barrier(),read=store.readArtifact.bind(store);let first=true
 store.readArtifact=async(...args)=>{const bytes=await read(...args);if(first){first=false;hold.entered();await hold.gate}return bytes}
 const earlier=store.refreshEvidence(access),refused=assert.rejects(earlier,{code:'task_busy'})
 try{
  await hold.ready;await writeFile(path,'{}\n');await store.refreshEvidence(access)
  assert.equal(taskFacts(data).verdict,'unverified')
  hold.release();await refused
  assert.equal(data.checkedProofs?.size,0);assert.equal(taskFacts(data).verdict,'unverified')
 }finally{hold.release()}
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
