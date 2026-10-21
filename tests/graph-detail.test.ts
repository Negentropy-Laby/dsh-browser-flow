import assert from 'node:assert/strict'
import {it} from 'node:test'
import {GraphWorkers} from '../src/graph/worker.ts'
import {resolveConfig} from '../src/config.ts'
import type {GraphInput} from '../src/graph/protocol.ts'
import {graphRuntime,graphBinary} from './helpers/graph-process.ts'
import {TASK} from './helpers/task-scope.ts'
import {expectRecord,expectList,present} from './helpers/assertions.ts'
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
it('pins outer continuations to the same projection and rejects offsets beyond the detail',async t=>{
 const env=await taskHost(t);await env.task('a');const access=present(env.service.tasks.current('session-a')),store=env.service.tasks
 const first=expectRecord(await store.detail(access,'graph',0,30))
 assert.equal(typeof first.projectionId,'string')
 await assert.rejects(store.detail(access,'graph',30,30),/projection/)
 const next=expectRecord(await store.detail(access,'graph',30,30,String(first.projectionId)))
 assert.equal(next.offset,30)
 await store.asset(access,'page',{documentToken:'new-document'})
 await assert.rejects(store.detail(access,'graph',30,30,String(first.projectionId)),/projection/)
 await assert.rejects(store.detail(access,'graph',Number.MAX_SAFE_INTEGER,30,String(first.projectionId)))
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
   const q=expectRecord(raw);let value:unknown=q.op==='hello'?{kernelVersion:'2',rulesVersion:'structural-v1'}:view
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
