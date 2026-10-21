import assert from 'node:assert/strict'
import { it } from 'node:test'
import { PassThrough } from 'node:stream'
import { GraphWorkers } from '../src/graph/worker.ts'
import { Frames, frame } from '../src/graph/protocol.ts'
import { resolveConfig } from '../src/config.js'
import { graphRuntime, graphBinary } from './helpers/graph-process.js'
import { TASK } from './helpers/task-scope.js'

const scope=TASK
function input(run=scope){return {scope:run,version:1,tailHash:'hash-1',goal:'中文 synthetic goal',constraints:[],criteria:[],events:[{seq:1,hash:'hash-1',type:'created',run,goal:'中文 synthetic goal'}],liveDocumentToken:'',protected:[],proofRef:'',proofSeq:0,coldRounds:6,minGroup:2}}
function setup(t,config={}){const runtime=graphRuntime(),workers=new GraphWorkers(resolveConfig(config),graphBinary);workers.attach(runtime);t.after(()=>workers.close());return {runtime,workers}}
it('decodes fragmented and coalesced UTF-8 frames and rejects oversize before body allocation',()=>{
 const got=[],decoder=new Frames(1000,v=>got.push(v)),bytes=Buffer.concat([frame({text:'北京'},1000),frame({text:'second'},1000)])
 for(const byte of bytes)decoder.push(Buffer.from([byte]))
 assert.deepEqual(got,[{text:'北京'},{text:'second'}]);assert.equal(decoder.incomplete,false)
 const prefix=Buffer.alloc(4);prefix.writeUInt32BE(1001);assert.throws(()=>decoder.push(prefix),/frame_limit/)
 const half=new Frames(1000,()=>{});half.push(Buffer.from([0,0]));assert.equal(half.incomplete,true)
})
it('reuses same-input projection, binds details and joins actual helper exit',async t=>{
 const {workers,runtime}=setup(t)
 const a=input(),value=await workers.project(a,8000,()=>true)
 assert.equal(value.procedural_law_index.goal.text,a.goal)
 const [left,right]=await Promise.all([workers.project(a,8000,()=>true),workers.project(a,8000,()=>true)])
 assert.deepEqual(left,right);assert.equal(runtime.handles.length,1)
 const detail=await workers.detail(a,'graph',()=>true)
 assert.equal(detail.nodes[0].taskId,a.scope.taskId)
 await workers.close();assert.ok(runtime.handles[0].child.exitCode!==null||runtime.handles[0].child.signalCode!==null)
})
it('keeps task, run and generation separate and never sends one task to another process',async t=>{
 const {workers,runtime}=setup(t)
 const a=input(),b=input({...scope,taskId:'task-22222222-2222-4222-8222-222222222222',ownerSessionId:'other'})
 await workers.project(a,8000,()=>true);const next=await workers.project(b,8000,()=>true)
 assert.equal(runtime.handles.length,2);assert.ok(!JSON.stringify(next).includes(a.scope.taskId))
 await workers.project(input({...scope,runId:'run-33333333-3333-4333-8333-333333333333'}),8000,()=>true)
 assert.ok(runtime.handles[0].child.exitCode!==null||runtime.handles[0].child.signalCode!==null);assert.equal(runtime.handles.length,3)
})
it('contains capacity, cancellation, stale snapshots and worker crashes to graph reads',async t=>{
 const {workers,runtime}=setup(t,{graphMaxWorkers:1})
 await workers.project(input(),8000,()=>true)
 await assert.rejects(workers.project(input({...scope,taskId:'task-22222222-2222-4222-8222-222222222222'}),8000,()=>true),/graph_capacity/)
 const controller=new AbortController();controller.abort();await assert.rejects(workers.project(input(),8000,()=>true,controller.signal),/stale_projection/)
 await assert.rejects(workers.project(input(),8000,()=>false),/stale_projection/)
 runtime.handles[0].child.kill();await runtime.handles[0].done
 await workers.project(input(),8000,()=>true);assert.equal(runtime.handles.length,2)
})
function heldRuntime(reply){
 const stdin=new PassThrough(),stdout=new PassThrough();let finish;const done=new Promise(resolve=>{finish=resolve});let terminated=false
 const decoder=new Frames(8*1024*1024,q=>reply(q,stdout));stdin.on('data',b=>decoder.push(b))
 return {get terminated(){return terminated},spawn(){return {stdin,stdout,done,terminate(){terminated=true;finish({})},async waitForExit(){await done;return true}}}}
}
it('rejects wrong identities, malformed frames and fake authority without replay',async t=>{
 for(const mode of ['owner','generation','version','malformed','authority']){
  let deliveries=0
  const runtime=heldRuntime((q,stdout)=>{deliveries++;const r={protocolVersion:1,id:q.id,generation:q.generation,scope:q.scope,version:q.version,tailHash:q.tailHash,inputHash:q.inputHash,ok:true,value:{kernelVersion:'1',rulesVersion:'structural-v1'}}
   if(mode==='owner')r.scope={...q.scope,ownerSessionId:'foreign'}
   if(mode==='generation')r.generation='old'
   if(mode==='version')r.protocolVersion=2
   if(mode==='malformed'){stdout.write(Buffer.from([255,255,255,255]));return}
   if(mode==='authority'&&q.op==='project')r.value={active_context:{businessVerdict:'import_confirmed'},procedural_law_index:{},technical_law_index:{},knowledge_graph:{}}
   stdout.write(frame(r,8*1024*1024))
  })
  const workers=new GraphWorkers(resolveConfig(),graphBinary);workers.attach(runtime)
  await assert.rejects(workers.project(input(),8000,()=>true));assert.equal(runtime.terminated,true);assert.equal(deliveries,mode==='authority'?2:1)
  await workers.close()
 }
})
it('service removal cancels an RPC at an explicit barrier and awaits quiescence',async()=>{
 let entered;const barrier=new Promise(resolve=>{entered=resolve})
 const runtime=heldRuntime(()=>entered());const workers=new GraphWorkers(resolveConfig(),graphBinary);const detach=workers.attach(runtime)
 const pending=workers.project(input(),8000,()=>true);const refused=assert.rejects(pending)
 await barrier;await detach();await refused
 assert.equal(runtime.terminated,true);await assert.rejects(workers.project(input(),8000,()=>true),/subprocess_unavailable/);await workers.close()
})
it('expires a held RPC using a controlled timer without sleeping or replaying',async t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 let entered;const barrier=new Promise(resolve=>{entered=resolve});let sent=0
 const runtime=heldRuntime(()=>{sent++;entered()});const workers=new GraphWorkers(resolveConfig(),graphBinary);workers.attach(runtime)
 const pending=workers.project(input(),8000,()=>true);const rejected=assert.rejects(pending,/graph_timeout/)
 await barrier;t.mock.timers.tick(5001);await rejected
 assert.equal(sent,1);assert.equal(runtime.terminated,true);await workers.close()
})
