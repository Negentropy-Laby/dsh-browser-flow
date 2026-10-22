import assert from 'node:assert/strict'
import {it} from 'node:test'
import {GraphWorkers,graphHash,graphProjectionId} from '../src/graph/worker.ts'
import {graphInput} from '../src/task-projections.ts'
import {resolveConfig} from '../src/config.ts'
import type {GraphInput} from '../src/graph/protocol.ts'
import {graphRuntime,graphBinary} from './helpers/graph-process.ts'
import {TASK} from './helpers/task-scope.ts'
import {expectRecord,expectList,expectString,expectNumber,expectFailure,present} from './helpers/assertions.ts'
import {taskHost} from './helpers/task-host.ts'
import {PassThrough} from 'node:stream'
import {Frames,frame} from '../src/graph/protocol.ts'

function large(n:number):GraphInput{
 const events:GraphInput['events']=[{seq:1,hash:'h1',type:'created',run:TASK,goal:'中文😀'}]
 for(let i=0;i<n;i++)for(const type of ['attempt','receipt'] as const){const seq=events.length+1;events.push({seq,hash:'h'+seq,type,run:TASK,id:'intent-'+i,...(type==='attempt'?{action:'click'}:{outcome:'executed'})})}
 return {scope:TASK,events,version:events.length,tailHash:events.at(-1)!.hash,goal:'中文😀',constraints:[],criteria:[],protected:[],proofRef:'',proofSeq:0,coldRounds:6,minGroup:2,liveDocumentToken:''}
}
it('reads a complete graph whose detail exceeds its 64 KiB frame',async t=>{
 const config=resolveConfig({graphMaxFrameBytes:65536}),runtime=graphRuntime(),workers=new GraphWorkers(config,graphBinary);workers.attach(runtime);t.after(()=>workers.close())
 const input=large(100);await workers.project(input,6000,()=>true)
 const detail=expectRecord(await workers.detail(input,'graph',()=>true))
 assert.ok(Buffer.byteLength(JSON.stringify(detail))>config.graphMaxFrameBytes)
 assert.equal(expectList(detail.nodes).filter(n=>expectRecord(n).kind!=='digest').length,201)
})
it('reads the exploration view beyond one wire frame and retains all original nodes',async t=>{
 const config=resolveConfig({graphMaxFrameBytes:65536}),workers=new GraphWorkers(config,graphBinary);workers.attach(graphRuntime());t.after(()=>workers.close())
 const input=large(100)
 const detail=expectRecord(await workers.detail(input,'graph:exploration',()=>true))
 assert.ok(Buffer.byteLength(JSON.stringify(detail))>config.graphMaxFrameBytes)
 assert.equal(expectList(detail.nodes).filter(n=>expectRecord(n).kind!=='digest').length,201)
 assert.deepEqual(detail.anchors,[])
})
it('pins outer continuations to the same projection and rejects offsets beyond the detail',async t=>{
 const env=await taskHost(t);await env.task('a');const access=present(env.service.tasks.current('session-a')),store=env.service.tasks
 const first=expectRecord(await store.detail(access,'graph',0,30))
 assert.equal(typeof first.projectionId,'string')
 const rawHash=graphHash(JSON.stringify(graphInput(store.openTask(access),env.service.config)))
 assert.equal(first.projectionId,graphProjectionId(rawHash))
 await assert.rejects(store.detail(access,'graph',30,30,rawHash),/projection/)
 await env.service.graph.retire(access.scope.taskId)
 assert.equal(expectRecord(await store.detail(access,'graph',0,30)).projectionId,first.projectionId)
 await assert.rejects(store.detail(access,'graph',30,30),/projection/)
 const next=expectRecord(await store.detail(access,'graph',30,30,String(first.projectionId)))
 assert.equal(next.offset,30)
 await store.asset(access,'page',{documentToken:'new-document'})
 await assert.rejects(store.detail(access,'graph',30,30,String(first.projectionId)),/projection/)
 await assert.rejects(store.detail(access,'graph',Number.MAX_SAFE_INTEGER,30,String(first.projectionId)))
})
it('rejects impossible scoped offsets before graph or evidence work at both public and store entries',async t=>{
 const env=await taskHost(t);await env.task('a');const store=env.service.tasks,access=present(store.current('session-a'))
 const first=expectRecord(await store.detail(access,'graph',0,30)),projectionId=expectString(first.projectionId)
 let graphs=0,evidence=0,dispatches=0
 const detail=env.service.graph.detail.bind(env.service.graph),refresh=store.refreshEvidence.bind(store),observe=env.service.observe.bind(env.service)
 env.service.graph.detail=async(...args)=>{graphs++;return detail(...args)}
 store.refreshEvidence=async(...args)=>{evidence++;return refresh(...args)}
 env.service.observe=async(...args)=>{dispatches++;return observe(...args)}
 for(const ref of ['graph','digest-impossible'])for(const offset of [env.service.config.graphMaxDetailBytes+1,Number.MAX_SAFE_INTEGER]){
  assert.equal(expectFailure(await env.tool('a','browser_observe',{view:'task',ref,offset,projectionId})).code,'invalid_request')
  await assert.rejects(store.detail(access,ref,offset,30,projectionId),{code:'invalid_request'})
 }
 assert.equal(dispatches,0);assert.equal(graphs,0);assert.equal(evidence,0)
})
it('reuses one current length across worker retirement to reject known overflow without graph or evidence work',async t=>{
 const env=await taskHost(t);await env.task('a');const store=env.service.tasks,access=present(store.current('session-a'))
 const first=expectRecord(await store.detail(access,'graph',0,30)),projectionId=expectString(first.projectionId),total=expectNumber(first.totalChars)
 await env.service.graph.retire(access.scope.taskId)
 let graphs=0,evidence=0;const detail=env.service.graph.detail.bind(env.service.graph),refresh=store.refreshEvidence.bind(store)
 env.service.graph.detail=async(...args)=>{graphs++;return detail(...args)}
 store.refreshEvidence=async(...args)=>{evidence++;return refresh(...args)}
 await assert.rejects(store.detail(access,'graph',total+1,30,projectionId),{code:'invalid_request'})
 assert.equal(graphs,0);assert.equal(evidence,0)
 const end=expectRecord(await store.detail(access,'graph',total,30,projectionId))
 assert.equal(end.text,'');assert.equal(end.complete,true)
})
it('checks an unknown detail length before evidence and remembers only the validated current length',async t=>{
 const env=await taskHost(t);await env.task('a');const store=env.service.tasks,access=present(store.current('session-a'))
 const projectionId=graphProjectionId(graphHash(JSON.stringify(graphInput(store.openTask(access),env.service.config))))
 let graphs=0,evidence=0;const detail=env.service.graph.detail.bind(env.service.graph),refresh=store.refreshEvidence.bind(store)
 env.service.graph.detail=async(...args)=>{graphs++;return detail(...args)}
 store.refreshEvidence=async(...args)=>{evidence++;return refresh(...args)}
 const invalid=()=>store.detail(access,'graph',env.service.config.graphMaxDetailBytes,30,projectionId)
 await assert.rejects(invalid(),{code:'invalid_request'})
 assert.equal(graphs,1);assert.equal(evidence,0)
 await assert.rejects(invalid(),{code:'invalid_request'})
 assert.equal(graphs,1);assert.equal(evidence,0)
})
it('does not use another task or projection length and refuses stale identities before graph work',async t=>{
 const env=await taskHost(t);await env.task('a');await env.task('b')
 const store=env.service.tasks,a=present(store.current('session-a')),b=present(store.current('session-b'))
 const first=expectRecord(await store.detail(a,'graph',0,30)),oldId=expectString(first.projectionId),offset=expectNumber(first.totalChars)+1
 await store.asset(a,'page',{documentToken:'next-document'})
 let graphs=0;const detail=env.service.graph.detail.bind(env.service.graph)
 env.service.graph.detail=async(...args)=>{graphs++;return detail(...args)}
 await assert.rejects(store.detail(a,'graph',offset,30,oldId),{code:'task_not_bound'})
 await assert.rejects(store.detail(b,'graph',offset,30,oldId),{code:'task_not_bound'});assert.equal(graphs,0)
 const newId=graphProjectionId(graphHash(JSON.stringify(graphInput(store.openTask(a),env.service.config))))
 const next=expectRecord(await store.detail(a,'graph',offset,30,newId))
 assert.equal(next.offset,offset);assert.ok(expectNumber(next.totalChars)>offset);assert.equal(graphs,1)
})
it('enforces the Host canonical UTF-8 detail capacity before publishing or checking evidence',async t=>{
 const env=await taskHost(t);await env.task('a');const store=env.service.tasks,access=present(store.current('session-a'))
 const detail=env.service.graph.detail.bind(env.service.graph);let evidence=0
 // The parser normally bounds the wire body; Host serialization must independently bound normalized output.
 env.service.graph.detail=async(...args)=>({...expectRecord(await detail(...args)),synthetic:'中😀'.repeat(15000)})
 store.graphConfig={...store.graphConfig,graphMaxFrameBytes:65536,graphMaxDetailBytes:65536}
 store.refreshEvidence=async()=>{evidence++}
 await assert.rejects(store.detail(access,'graph',0,30),/detail_capacity/);assert.equal(evidence,0)
})
it('continues a real scoped graph beyond two million characters without losing Chinese or emoji',async t=>{
 const env=await taskHost(t);await env.task('a',{goal:'中文😀 scoped continuation',origins:['https://a.example']})
 const store=env.service.tasks,access=present(store.current('session-a'))
 for(let i=0;i<6500;i++)await store.asset(access,'page',{documentToken:`${i}-`+'中文😀'.repeat(40)})
 const input=graphInput(store.openTask(access),env.service.config),expected=JSON.stringify(await env.service.graph.detail(input,'graph',()=>true))
 assert.ok(expected.length>2_000_001,`fixture must exceed two million characters: ${expected.length}`);assert.ok(Buffer.byteLength(expected)<env.service.config.graphMaxDetailBytes)
 const first=expectRecord(await store.detail(access,'graph',0,1_000_003)),projectionId=expectString(first.projectionId)
 let text=expectString(first.text)
 while(text.length<expected.length){
  const part=expectRecord(await store.detail(access,'graph',text.length,1_000_003,projectionId))
  assert.equal(part.projectionId,projectionId);assert.equal(part.totalChars,expected.length)
  text+=expectString(part.text)
 }
 assert.equal(text,expected)
 const tail=expectRecord(await store.detail(access,'graph',2_000_001,1000,projectionId))
 assert.equal(tail.text,expected.slice(2_000_001,2_001_001))
 const end=expectRecord(await store.detail(access,'graph',expected.length,1000,projectionId))
 assert.equal(end.text,'');assert.equal(end.complete,true)
})
it('assembles a detail larger than the default 8 MiB frame without losing members',async t=>{
 const config=resolveConfig({}),workers=new GraphWorkers(config,graphBinary);workers.attach(graphRuntime());t.after(()=>workers.close())
 const detail=expectRecord(await workers.detail(large(8000),'graph',()=>true))
 assert.ok(Buffer.byteLength(JSON.stringify(detail))>config.graphMaxFrameBytes)
 assert.equal(expectList(detail.nodes).filter(n=>expectRecord(n).kind!=='digest').length,16001)
})
it('reports detail capacity separately and keeps a healthy projection available',async t=>{
 assert.throws(()=>resolveConfig({graphMaxDetailBytes:65536}),/graphMaxDetailBytes/)
 const workers=new GraphWorkers(resolveConfig({graphMaxFrameBytes:65536,graphMaxDetailBytes:65536}),graphBinary);workers.attach(graphRuntime());t.after(()=>workers.close())
 const input=large(100)
 await assert.rejects(workers.detail(input,'graph',()=>true),/detail_capacity/)
 assert.ok((await workers.project(input,6000,()=>true)).active_context)
 await assert.rejects(workers.detail(input,'digest-missing',()=>true),/stale_reference/)
 assert.ok((await workers.project(input,8000,()=>true)).active_context)
})
it('rejects corrupt fragments and unowned complete JSON before returning detail',async t=>{
 const config=resolveConfig({}),real=new GraphWorkers(config,graphBinary);real.attach(graphRuntime());t.after(()=>real.close())
 const input=large(0),view=await real.project(input,6000,()=>true),detail=await real.detail(input,'graph',()=>true),serialized=Buffer.from(JSON.stringify(detail))
 for(const mode of ['offset','total','empty','duplicate','base64','utf8','json','foreign','limit','binding'] as const){
  const stdin=new PassThrough(),stdout=new PassThrough();let end!:()=>void;const done=new Promise<void>(resolve=>{end=resolve});let chunks=0
  const decoder=new Frames(config.graphMaxFrameBytes,raw=>{
   const q=expectRecord(raw);let value:unknown=q.op==='hello'?{kernelVersion:'4',rulesVersion:'structural-v1'}:view
   if(q.op==='detail'){
    chunks++;const offset=Number(q.offsetBytes??0),data=mode==='utf8'?Buffer.from([255]):mode==='json'?Buffer.from('{broken'):mode==='foreign'?Buffer.from('{"nodes":[],"edges":[],"digests":[]}'):serialized
    const count=chunks===1&&['total','duplicate'].includes(mode)?10:data.length-offset
    const part={ref:'graph',offsetBytes:offset,totalBytes:data.length,chunkBase64:data.subarray(offset,offset+count).toString('base64'),complete:offset+count===data.length}
    if(mode==='offset'||mode==='duplicate'&&chunks===2)part.offsetBytes++
    if(mode==='total'&&chunks===2)part.totalBytes++
    if(mode==='empty')part.chunkBase64=''
    if(mode==='base64')part.chunkBase64='!!!!'
    if(mode==='limit')part.totalBytes=config.graphMaxDetailBytes+1
    value=part
   }
   stdout.write(frame({protocolVersion:2,id:q.id,generation:q.generation,scope:mode==='binding'&&q.op==='detail'?{...expectRecord(q.scope),ownerSessionId:'foreign'}:q.scope,version:q.version,tailHash:q.tailHash,inputHash:q.inputHash,ok:true,value},config.graphMaxFrameBytes))
  });stdin.on('data',chunk=>decoder.push(chunk))
  const workers=new GraphWorkers(config,graphBinary);workers.attach({spawn(){return {stdin,stdout,done,terminate(){end()},async waitForExit(){await done;return true}}}})
  try{await assert.rejects(workers.detail(input,'graph',()=>true),mode==='binding'?/invalid_response/:/invalid_detail|invalid_projection|detail_capacity/)}finally{await workers.close()}
 }
})
it('overlays current page validity from Host control and reevaluates it after withdrawal',async t=>{
 const env=await taskHost(t);await env.task('a');await env.authorize('a')
 const store=env.service.tasks,access=present(store.current('session-a'))
 await store.asset(access,'page',{documentToken:'old-document'})
 await store.asset(access,'page',{documentToken:env.page('a').documentToken})
 await store.asset(access,'file',{})
 const view=await store.view(access,50000),assets=expectList(expectRecord(view.technical_law_index).assets).map(expectRecord)
 assert.equal(assets[0].validity,'historical');assert.equal(assets[1].validity,'current_authorized_document');assert.equal(assets[2].documentToken,undefined);assert.equal(assets[2].validity,undefined)
 assert.deepEqual(assets,expectRecord(view.active_context).recentAssets)
 await env.tool('a','browser_release')
 const after=await store.view(access,50000)
 assert.ok(expectList(expectRecord(after.technical_law_index).assets).filter(n=>expectRecord(n).kind==='page').every(n=>expectRecord(n).validity==='historical'))
})
