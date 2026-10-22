import assert from 'node:assert/strict'
import {it} from 'node:test'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {taskHost} from './helpers/task-host.ts'
import {navigation} from './helpers/task-navigation.ts'
import {syntheticDefinition} from './helpers/task-definition.ts'
import {taskFacts} from '../src/task-facts.ts'
import {expectFailure,expectRecord,expectString,expectNumber,present} from './helpers/assertions.ts'

it('rejects every detail family over capacity before public dispatch or Store evidence and graph work',async t=>{
 const env=await navigation(t),store=env.service.tasks,access=present(env.access),data=store.openTask(access)
 const asset=await store.asset(access,'file',{marker:'synthetic asset'})
 await store.declareWait(access,{kind:'other_user_input',reason:'Synthetic dependency',resumeCondition:'A new actual input'})
 const refs=[asset,present(data.events.find(event=>event.type==='asset'&&event.data.kind==='evidence')).data.id,'criteria',...taskFacts(data).criteria.map(row=>row.id),'goal','waiting',...present(data.snapshot).definition.resources,'graph','digest-synthetic']
 let reads=0,graphs=0,dispatches=0
 const read=store.readArtifact.bind(store),detail=env.service.graph.detail.bind(env.service.graph),observe=env.service.observe.bind(env.service)
 store.readArtifact=async(...args)=>{reads++;return read(...args)}
 env.service.graph.detail=async(...args)=>{graphs++;return detail(...args)}
 env.service.observe=async(...args)=>{dispatches++;return observe(...args)}
 for(const ref of refs)for(const offset of [env.service.config.graphMaxDetailBytes+1,Number.MAX_SAFE_INTEGER]){
  assert.equal(expectFailure(await env.tool('a','browser_observe',{view:'task',ref,offset})).code,'invalid_request')
  await assert.rejects(store.detail(access,expectString(ref),offset,100),{code:'invalid_request'})
 }
 assert.equal(dispatches,0);assert.equal(graphs,0);assert.equal(reads,0)
})
it('uses actual lengths for offsets within capacity and still performs independent proof verification',async t=>{
 const env=await navigation(t),store=env.service.tasks,access=present(env.access);let reads=0
 const read=store.readArtifact.bind(store);store.readArtifact=async(...args)=>{reads++;return read(...args)}
 await assert.rejects(store.detail(access,'goal',env.service.config.graphMaxDetailBytes,100),{code:'invalid_request'})
 assert.equal(reads,2)
})
it('accepts an exact-capacity original and its end offset but refuses the next byte',async t=>{
 const env=await taskHost(t);await env.task('a');const store=env.service.tasks,access=present(store.current('session-a')),limit=65536
 const empty=await store.asset(access,'file',{text:''}),base=expectString(expectRecord(await store.detail(access,empty,0,10000)).text)
 store.graphConfig={...store.graphConfig,graphMaxFrameBytes:limit,graphMaxDetailBytes:limit}
 const id=await store.asset(access,'file',{text:'x'.repeat(limit-Buffer.byteLength(base))})
 const first=expectRecord(await store.detail(access,id,0,100));assert.equal(first.totalChars,limit)
 const end=expectRecord(await store.detail(access,id,limit,100));assert.equal(end.text,'');assert.equal(end.complete,true)
 const over=await store.asset(access,'file',{text:'x'.repeat(limit-Buffer.byteLength(base)+1)})
 await assert.rejects(store.detail(access,over,0,100),/detail_capacity/)
})
it('bounds original assets by UTF-8 bytes rather than JavaScript characters',async t=>{
 const env=await taskHost(t);await env.task('a');const store=env.service.tasks,access=present(store.current('session-a'))
 const id=await store.asset(access,'file',{text:'中😀'.repeat(10000)})
 const original=expectString(expectRecord(await store.detail(access,id,0,100000)).text)
 assert.ok(original.length<65536);assert.ok(Buffer.byteLength(original)>65536)
 store.graphConfig={...store.graphConfig,graphMaxFrameBytes:65536,graphMaxDetailBytes:65536}
 await assert.rejects(store.detail(access,id,0,100),/detail_capacity/)
})
it('applies the configured byte capacity to goals and criterion lists',async t=>{
 const env=await taskHost(t);await env.task('a',{goal:'Synthetic criteria capacity',origins:['https://a.example'],criteria:Array.from({length:32},()=> '中'.repeat(1000))})
 const store=env.service.tasks,access=present(store.current('session-a'));store.graphConfig={...store.graphConfig,graphMaxFrameBytes:65536,graphMaxDetailBytes:65536}
 for(const ref of ['goal','criteria'])await assert.rejects(store.detail(access,ref,0,100),/detail_capacity/)
})
it('bounds raw wait histories without treating task lifecycle as business completion',async t=>{
 const env=await taskHost(t);await env.task('a');const store=env.service.tasks,access=present(store.current('session-a'))
 for(let i=0;i<13;i++){
  const wait=await store.declareWait(access,{kind:'other_user_input',reason:'中'.repeat(1000),resumeCondition:'新'.repeat(1000)})
  await store.resumeWait(access,wait.id,'新'.repeat(1000),()=>false)
 }
 store.graphConfig={...store.graphConfig,graphMaxFrameBytes:65536,graphMaxDetailBytes:65536}
 await assert.rejects(store.detail(access,'waiting',0,100),/detail_capacity/)
 assert.equal(taskFacts(store.openTask(access)).verdict,'unverified')
})
it('applies capacity to a valid local instruction snapshot',async t=>{
 const env=await taskHost(t),def=syntheticDefinition({root:env.root})
 await writeFile(join(def.dir,'instructions/steps.md'),'中😀'.repeat(14000))
 await env.task('a',{definitionId:'synthetic',workflowRef:'read',goal:'Synthetic snapshot capacity'})
 const store=env.service.tasks,access=present(store.current('session-a'));store.graphConfig={...store.graphConfig,graphMaxFrameBytes:65536,graphMaxDetailBytes:65536}
 await assert.rejects(store.detail(access,'instructions/steps.md',0,100),/detail_capacity/)
})
it('preserves JavaScript character continuations and exact end for original details',async t=>{
 const env=await taskHost(t);await env.task('a');const store=env.service.tasks,access=present(store.current('session-a'))
 const id=await store.asset(access,'file',{text:'中文😀'}),first=expectRecord(await store.detail(access,id,0,10000)),text=expectString(first.text),offset=text.indexOf('😀')+1
 const left=expectRecord(await store.detail(access,id,0,offset)),right=expectRecord(await store.detail(access,id,offset,10000))
 assert.equal(expectString(left.text)+expectString(right.text),text)
 const end=expectRecord(await store.detail(access,id,expectNumber(first.totalChars),100));assert.equal(end.text,'');assert.equal(end.complete,true)
})
