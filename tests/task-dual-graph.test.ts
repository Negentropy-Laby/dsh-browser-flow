import assert from 'node:assert/strict'
import { it } from 'node:test'
import { unlink,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { taskHost } from './helpers/task-host.ts'
import { navigation } from './helpers/task-navigation.ts'
import { present,expectRecord,expectString,expectList,expectOk,expectFailure } from './helpers/assertions.ts'
import { pageIdentity,fileIdentity } from '../src/task-resources.ts'
import { graphInput } from '../src/task-projections.ts'
import { GraphWorkers,graphHash } from '../src/graph/worker.ts'
import { validateDetail,validateView } from '../src/graph/validation.ts'
import { graphBinary,graphRuntime } from './helpers/graph-process.ts'
import { TaskStore,TaskError } from '../src/task-store.ts'

const guest={connectionInstanceId:'panel-a',connectionGeneration:1,lease:'guest-a',partition:'part-a',documentToken:'doc-a'}
async function detail(store:TaskStore,access:import('../src/task-store.ts').TaskAccess,ref:string){return expectRecord(JSON.parse(expectString(expectRecord(await store.detail(access,ref,0,1_000_000)).text)))}
async function ready(t:import('node:test').TestContext){const env=await taskHost(t);await env.task('a');const store=env.service.tasks,access=present(store.current('session-a'));return {...env,store,access}}

it('groups document instances while preserving observations, contexts and independent old snapshots',async t=>{
 const env=await ready(t),{store,access}=env
 const refs:string[]=[]
 for(const marker of ['first','changed'])refs.push(await store.asset(access,'page',{documentToken:'doc-a',marker,resourceIdentity:pageIdentity(access.run,guest,'observation')}))
 const replaced=await store.asset(access,'page',{documentToken:'doc-b',resourceIdentity:pageIdentity(access.run,{...guest,documentToken:'doc-b'},'observation')})
 const otherGuest=await store.asset(access,'page',{documentToken:'doc-a',resourceIdentity:pageIdentity(access.run,{...guest,lease:'guest-b'},'observation')})
 const old=await store.asset(access,'page',{documentToken:'doc-a'})
 const graph=await detail(store,access,'graph:assets'),resources=expectList(graph.resources).map(expectRecord)
 assert.equal(resources.length,4)
 const grouped=present(resources.find(r=>expectList(r.snapshots).includes(refs[0])))
 assert.deepEqual(grouped.snapshots,refs);assert.equal(grouped.basis,'document_instance')
 for(const id of [replaced,otherGuest,old])assert.ok(!expectList(grouped.snapshots).includes(id))
 assert.equal(present(resources.find(r=>expectList(r.snapshots).includes(old))).groupingReason,'reliable_identity_unavailable')
 assert.equal(expectRecord((await detail(store,access,refs[0])).data).marker,'first')
 assert.equal(await store.pageContext(access,guest),refs[1])
 assert.equal(await store.pageContext(access,{...guest,connectionInstanceId:'remounted-panel',connectionGeneration:9}),refs[1])
 const context=await store.pageContext(access,{...guest,documentToken:'unobserved'})
 assert.equal(expectRecord((await detail(store,access,context)).data).contextOnly,true)
 const before=await detail(store,access,'graph:assets')
 await env.service.close()
 const workers=new GraphWorkers(env.service.config,graphBinary);workers.attach(graphRuntime())
 const recovered=new TaskStore(env.root,env.ctx.profileContext,100,workers,env.service.config)
 try{const own=await recovered.forSession('session-a');assert.deepEqual(await detail(recovered,own,'graph:assets'),before)}finally{await recovered.close();await workers.close()}
})

it('uses checked file source identity rather than same name, content or run, and leaks no source path to Go',async t=>{
 const {store,access,service}=await ready(t)
 const path='/private/source-a/same.xlsx',other='/private/source-b/same.xlsx'
 const a=await store.asset(access,'file',{sha256:'a'.repeat(64),resourceIdentity:fileIdentity(access.run,path)})
 const b=await store.asset(access,'file',{sha256:'b'.repeat(64),resourceIdentity:fileIdentity(access.run,path)})
 const c=await store.asset(access,'file',{sha256:'a'.repeat(64),resourceIdentity:fileIdentity(access.run,other)})
 const graph=await detail(store,access,'graph:assets'),rows=expectList(graph.resources).map(expectRecord)
 assert.equal(rows.length,2);assert.deepEqual(rows[0].snapshots,[a,b]);assert.deepEqual(rows[1].snapshots,[c])
 assert.ok(!JSON.stringify(graphInput(store.openTask(access),service.config)).includes('/private/'))
 const next=await store.revise(access,{newRun:true}),d=await store.asset(next,'file',{resourceIdentity:fileIdentity(next.run,path)})
 const current=await detail(store,next,'graph:assets');assert.equal(expectList(current.resources).length,3)
 for(const pair of [[a,d],[d,a]])await assert.rejects(store.relate(next,pair[0],pair[1],'derived_from'),{code:'task_not_bound'})
 assert.equal((await detail(store,next,a)).id,a)
})

it('keeps task resources inaccessible across owners and never admits a logical resource as an edge endpoint',async t=>{
 const {store,access,task}=await ready(t);await task('b')
 const b=present(store.current('session-b')),id=await store.asset(access,'page',{resourceIdentity:pageIdentity(access.run,guest,'observation')})
 const ref=expectString(expectRecord(expectList((await detail(store,access,'graph:assets')).resources)[0]).id)
 await assert.rejects(store.detail(b,ref,0,500),{code:'task_not_bound'})
 await assert.rejects(store.relate(access,ref,id,'proves'),{code:'task_not_bound'})
 const foreign=await store.asset(b,'page',{})
 await assert.rejects(store.relate(access,id,foreign,'observed_on'),{code:'task_not_bound'})
})

it('returns identical typed cross-plane anchors and bidirectional proof and operation references',async t=>{
 const env=await navigation(t,['甲','乙']),store=env.service.tasks,access=present(env.access)
 const assets=await detail(store,access,'graph:assets'),page=expectRecord(expectList(assets.snapshots).find(v=>expectRecord(v).kind==='page'))
 const attempt=await store.beginAttempt(access,'click');await store.relate(access,attempt,expectString(page.id),'observed_on');await store.receipt(access,attempt,'executed')
 const a=await detail(store,access,'graph:assets'),e=await detail(store,access,'graph:exploration')
 assert.deepEqual(a.anchors,e.anchors)
 const proofAnchor=expectRecord(expectList(a.anchors).find(v=>expectRecord(v).relation==='proves'))
 assert.deepEqual(proofAnchor.run,access.run);assert.ok(Number(proofAnchor.sourceSeq)>0)
 const resource=expectRecord(expectList(a.resources).find(r=>expectList(expectRecord(r).snapshots).includes(page.id)))
 const trace=await detail(store,access,expectString(resource.id))
 assert.ok(expectList(trace.explorationRefs).includes(attempt));assert.ok(expectList(trace.explorationRefs).includes(proofAnchor.to));assert.deepEqual(trace.evidenceRefs,[proofAnchor.from])
 const criterion=await detail(store,access,expectString(proofAnchor.to));assert.deepEqual(criterion.proofRefs,[proofAnchor.from])
 const coverage=await detail(store,access,'coverage')
 assert.equal(coverage.total,3);assert.equal(coverage.verified,1);assert.equal(coverage.unverified,2);assert.equal(coverage.ratio,1/3)
 assert.deepEqual(expectList(coverage.conditions).map(v=>expectRecord(v).reason),['no_validator','no_validator','verified'])
})

it('does not infer relations from neighboring events or a shared goal',async t=>{
 const {store,access}=await ready(t)
 const page=await store.asset(access,'page',{resourceIdentity:pageIdentity(access.run,guest,'observation')})
 const a=await store.beginAttempt(access,'click');await store.relate(access,a,page,'observed_on');await store.receipt(access,a,'executed')
 const unrelated=await store.beginAttempt(access,'click');await store.receipt(access,unrelated,'executed')
 const resource=expectString(expectRecord(expectList((await detail(store,access,'graph:assets')).resources)[0]).id)
 const trace=await detail(store,access,resource)
 assert.ok(expectList(trace.explorationRefs).includes(a));assert.ok(!expectList(trace.explorationRefs).includes(unrelated));assert.deepEqual(trace.evidenceRefs,[])
 assert.equal((await detail(store,access,'coverage')).ratio,null)
})

for(const mode of ['missing','changed','old-run','receipt-only'] as const)it(`keeps ${mode} evidence out of the coverage numerator`,async t=>{
 const env=await navigation(t,['甲','乙']),store=env.service.tasks;let access=present(env.access)
 const data=store.openTask(access),proof=present(data.events.find(e=>e.type==='asset'&&e.data.kind==='evidence'))
 const original=join(data.dir,expectString(expectRecord(proof.data.data).artifact))
 if(mode==='missing')await unlink(original)
 if(mode==='changed')await writeFile(original,'{}')
 if(mode==='old-run'||mode==='receipt-only')access=await store.revise(access,{newRun:true})
 if(mode==='receipt-only'){const attempt=await store.beginAttempt(access,'click');await store.receipt(access,attempt,'executed')}
 const coverage=await detail(store,access,'coverage');assert.equal(coverage.verified,0);assert.equal(coverage.total,3)
})

it('requires fresh identities for new detail continuations and rejects history/evidence changes',async t=>{
 const env=await navigation(t),store=env.service.tasks,access=present(env.access)
 const resource=expectString(expectRecord(expectList((await detail(store,access,'graph:assets')).resources)[0]).id)
 for(const ref of ['graph:assets','graph:exploration',resource,'coverage']){
  const first=expectRecord(await store.detail(access,ref,0,11)),projection=expectString(first.projectionId)
  await assert.rejects(store.detail(access,ref,11,11),{code:'task_not_bound'})
  assert.equal(expectRecord(await store.detail(access,ref,11,11,projection)).offset,11)
  await store.asset(access,'unit_check',{})
  await assert.rejects(store.detail(access,ref,11,11,projection),{code:'task_not_bound'})
 }
 const first=expectRecord(await store.detail(access,'coverage',0,11)),data=store.openTask(access)
 const proof=present(data.events.find(e=>e.type==='asset'&&e.data.kind==='evidence'))
 await unlink(join(data.dir,expectString(expectRecord(proof.data.data).artifact)))
 await assert.rejects(store.detail(access,'coverage',11,11,expectString(first.projectionId)),{code:'task_not_bound'})
})

it('serves Host coverage with a failed graph and keeps panel polls free of graph and evidence scans',async t=>{
 const env=await navigation(t),store=env.service.tasks,access=present(env.access)
 env.service.graph.project=async()=>{throw new Error('synthetic graph crash')}
 const view=await store.view(access,8000)
 assert.equal(view.active_context.graph.status,'unavailable');assert.equal(view.active_context.coverage.verified,1)
 assert.equal((await detail(store,access,'coverage')).verified,1)
 let scanned=0,computed=0
 store.refreshEvidence=async()=>{scanned++};env.service.graph.project=async()=>{computed++;throw new Error('not a polling dependency')}
 await env.post('poll',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',pages:[{...env.page('a'),url:'https://fuwu.rsj.beijing.gov.cn/zhrs/yltc/information-third-new/imp'}]})
 assert.equal(scanned,0);assert.equal(computed,0)
 assert.equal((await env.tool('a','browser_release')).ok,true)
})

it('rejects forged groups, omitted anchors and foreign runs in the kernel output',async t=>{
 const env=await navigation(t),store=env.service.tasks,access=present(env.access),input=graphInput(store.openTask(access),env.service.config),hash=graphHash(JSON.stringify(input))
 const graph=await detail(store,access,'graph:assets')
 for(const mode of ['snapshot','anchor','run'] as const){const v=structuredClone(graph)
  if(mode==='snapshot')expectList(expectRecord(expectList(v.resources)[0]).snapshots).push('asset-foreign')
  if(mode==='anchor')expectList(v.anchors).pop()
  if(mode==='run')expectRecord(expectRecord(expectList(v.resources)[0]).run).runId='run-foreign'
  assert.throws(()=>validateDetail(v,'graph:assets',input,hash),/invalid_projection/)
 }
 const view=await env.service.graph.project(input,80000,()=>true)
 expectRecord(expectRecord(expectRecord(view.knowledge_graph).views).assets).resources=999
 assert.throws(()=>validateView(view,input,hash),/invalid_projection/)
})

it('does not dispatch when a context relation fails after the intent was recorded',async t=>{
 const env=await ready(t);await env.authorize('a')
 let dispatched=0;const run=env.service.state.run
 env.service.state.run=(...args)=>{dispatched++;return run(...args)}
 env.store.relate=async()=>{throw new TaskError('task_storage_failed','synthetic context append failure')}
 const result=await env.tool('a','browser_act',{action:'click',documentToken:'doc-a',elementRef:'el-0'})
 assert.equal(expectFailure(result).code,'task_storage_failed');assert.equal(dispatched,0)
 const history=env.store.openTask(env.access).events
 assert.equal(history.at(-1)?.type,'receipt');assert.equal(history.at(-1)?.data.outcome,'not_executed');assert.equal(env.store.openTask(env.access).pendingWrite,undefined)
})

it('does not let a context-only snapshot satisfy the navigation validator even with matching page text',async t=>{
 const env=await navigation(t),store=env.service.tasks,access=present(env.access)
 const page=present(store.openTask(access).events.find(e=>e.type==='asset'&&e.data.kind==='page'))
 const context=await store.asset(access,'page',{...expectRecord(page.data.data),resourceIdentity:pageIdentity(access.run,guest,'context'),contextOnly:true})
 const proof=await store.proof(access,{schemaVersion:1,kind:'navigation',run:access.run,pageRef:context})
 assert.equal(await store.verdict(access,{verdict:'entry_reached'},proof),'unverified')
 assert.equal((await detail(store,access,'coverage')).verified,0)
})

it('assembles large Chinese dual-view and resource details with character continuation',async t=>{
 const env=await ready(t),{store,access}=env
 const workers=new GraphWorkers(store.graphConfig,graphBinary);workers.attach(graphRuntime());t.after(()=>workers.close());store.graph=workers
 // Repeated snapshots and a long current goal exercise multi-part character reads.
 const next=await store.revise(access,{goal:'中文😀'.repeat(300)})
 for(let i=0;i<100;i++)await store.asset(next,'page',{documentToken:'doc-a',resourceIdentity:pageIdentity(next.run,guest,'observation')})
 const read=async(ref:string)=>{
  let offset=0,text='',projectionId:string|undefined
  for(;;){const part=expectRecord(await store.detail(next,ref,offset,997,projectionId));projectionId=expectString(part.projectionId);text+=expectString(part.text);offset=text.length;if(part.complete)break}
  assert.equal(offset,text.length);return expectRecord(JSON.parse(text))
 }
 const assets=await read('graph:assets');assert.equal(expectList(assets.snapshots).length,100)
 const resource=expectString(expectRecord(expectList(assets.resources)[0]).id)
 assert.equal(expectList((await read(resource)).snapshots).length,100)
 const exploration=await read('graph:exploration')
 assert.ok(expectList(exploration.nodes).some(n=>expectRecord(expectRecord(n).data).goal==='中文😀'.repeat(300)))
})
