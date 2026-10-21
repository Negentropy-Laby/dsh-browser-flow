import {expectRecord,present,expectList} from './helpers/assertions.ts'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { PassThrough } from 'node:stream'
import { GraphWorkers } from '../src/graph/worker.ts'
import { Frames, frame } from '../src/graph/protocol.ts'
import { resolveConfig } from '../src/config.ts'
import { graphRuntime, graphBinary } from './helpers/graph-process.ts'
import { TASK, runScope } from './helpers/task-scope.ts'

const scope=TASK
function input(run:import('../src/task-scope.ts').RunScope=scope){return {scope:run,version:1,tailHash:'hash-1',goal:'中文 synthetic goal',constraints:[],criteria:[],events:[{seq:1,hash:'hash-1',type:'created',run,goal:'中文 synthetic goal'}],liveDocumentToken:'',protected:[],proofRef:'',proofSeq:0,coldRounds:6,minGroup:2}}
function setup(t:import('node:test').TestContext,config={}){const runtime=graphRuntime(),workers=new GraphWorkers(resolveConfig(config),graphBinary);workers.attach(runtime);t.after(()=>workers.close());return {runtime,workers}}
it('decodes fragmented and coalesced UTF-8 frames and rejects oversize before body allocation',()=>{
 const got:unknown[]=[],decoder=new Frames(1000,v=>got.push(v)),bytes=Buffer.concat([frame({text:'北京'},1000),frame({text:'second'},1000)])
 for(const byte of bytes)decoder.push(Buffer.from([byte]))
 assert.deepEqual(got,[{text:'北京'},{text:'second'}]);assert.equal(decoder.incomplete,false)
 const prefix=Buffer.alloc(4);prefix.writeUInt32BE(1001);assert.throws(()=>decoder.push(prefix),/frame_limit/)
 const half=new Frames(1000,()=>{});half.push(Buffer.from([0,0]));assert.equal(half.incomplete,true)
})
it('reuses same-input projection, binds details and joins actual helper exit',async t=>{
 const {workers,runtime}=setup(t)
 const a=input(),value=await workers.project(a,8000,()=>true)
 assert.equal(expectRecord(expectRecord(value.procedural_law_index).goal).text,a.goal)
 const [left,right]=await Promise.all([workers.project(a,8000,()=>true),workers.project(a,8000,()=>true)])
 assert.deepEqual(left,right);assert.equal(runtime.handles.length,1)
 const detail=await workers.detail(a,'graph',()=>true)
 assert.equal(expectRecord(expectList(expectRecord(detail).nodes)[0]).taskId,a.scope.taskId)
 await workers.close();assert.ok(runtime.handles[0].child.exitCode!==null||runtime.handles[0].child.signalCode!==null)
})
it('shares preparation across concurrent view budgets and detail reads',async t=>{
 const {workers,runtime}=setup(t);const a=input()
 const [summary,detail,expanded]=await Promise.all([workers.project(a,6000,()=>true),workers.detail(a,'graph',()=>true),workers.project(a,8000,()=>true)])
 assert.ok(summary.active_context);assert.ok(expanded.active_context);assert.ok(expectList(expectRecord(detail).nodes).length)
 assert.equal(runtime.handles.length,1)
})
it('keeps task, run and generation separate and never sends one task to another process',async t=>{
 const {workers,runtime}=setup(t)
 const a=input(),b=input(runScope({...scope,taskId:'task-22222222-2222-4222-8222-222222222222',ownerSessionId:'other'}))
 await workers.project(a,8000,()=>true);const next=await workers.project(b,8000,()=>true)
 assert.equal(runtime.handles.length,2);assert.ok(!JSON.stringify(next).includes(a.scope.taskId))
 await workers.project(input(runScope({...scope,runId:'run-33333333-3333-4333-8333-333333333333'})),8000,()=>true)
 assert.ok(runtime.handles[0].child.exitCode!==null||runtime.handles[0].child.signalCode!==null);assert.equal(runtime.handles.length,3)
})
it('contains capacity, cancellation, stale snapshots and worker crashes to graph reads',async t=>{
 const {workers,runtime}=setup(t,{graphMaxWorkers:1})
 await workers.project(input(),8000,()=>true)
 await assert.rejects(workers.project(input(runScope({...scope,taskId:'task-22222222-2222-4222-8222-222222222222'})),8000,()=>true),/graph_capacity/)
 const controller=new AbortController();controller.abort();await assert.rejects(workers.project(input(),8000,()=>true,controller.signal),/stale_projection/)
 await assert.rejects(workers.project(input(),8000,()=>false),/stale_projection/)
 runtime.handles[0].child.kill();await runtime.handles[0].done;await workers.retire(scope.taskId)
 await workers.project(input(),8000,()=>true);assert.equal(runtime.handles.length,2)
})
function heldRuntime(reply:(request:Record<string,unknown>,stdout:PassThrough)=>void){
 const stdin=new PassThrough(),stdout=new PassThrough();let finish!:(value:object)=>void;const done=new Promise<object>(resolve=>{finish=resolve});let terminated=false
 const decoder=new Frames(8*1024*1024,q=>reply(expectRecord(q),stdout));stdin.on('data',b=>decoder.push(b))
 return {get terminated(){return terminated},spawn(){return {stdin,stdout,done,terminate(){terminated=true;finish({})},async waitForExit(){await done;return true}}}}
}
it('rejects wrong identities, malformed frames and fake authority without replay',async t=>{
 for(const mode of ['owner','generation','version','malformed','authority'] as const){
  let deliveries=0
  const runtime=heldRuntime((q,stdout)=>{deliveries++;const r={protocolVersion:2,id:q.id,generation:q.generation,scope:q.scope,version:q.version,tailHash:q.tailHash,inputHash:q.inputHash,ok:true,value:{kernelVersion:'2',rulesVersion:'structural-v1'} as Record<string,unknown>}
   if(mode==='owner')r.scope={...expectRecord(q.scope),ownerSessionId:'foreign'}
   if(mode==='generation')r.generation='old'
   if(mode==='version')r.protocolVersion=1
   if(mode==='malformed'){stdout.write(Buffer.from([255,255,255,255]));return}
   if(mode==='authority'&&q.op==='project')r.value={active_context:{businessVerdict:'import_confirmed'},procedural_law_index:{},technical_law_index:{},knowledge_graph:{}}
   stdout.write(frame(r,8*1024*1024))
  })
  const workers=new GraphWorkers(resolveConfig({}),graphBinary);workers.attach(runtime)
  await assert.rejects(workers.project(input(),8000,()=>true));assert.equal(runtime.terminated,true);assert.equal(deliveries,mode==='authority'?2:1)
  await workers.close()
 }
})
it('service removal cancels an RPC at an explicit barrier and awaits quiescence',async()=>{
 let entered!:()=>void;const barrier=new Promise<void>(resolve=>{entered=resolve})
 const runtime=heldRuntime(()=>entered());const workers=new GraphWorkers(resolveConfig({}),graphBinary);const detach=workers.attach(runtime)
 const pending=workers.project(input(),8000,()=>true);const refused=assert.rejects(pending)
 await barrier;await detach();await refused
 assert.equal(runtime.terminated,true);await assert.rejects(workers.project(input(),8000,()=>true),/subprocess_unavailable/);await workers.close()
})
it('detaches business listeners on failed exit observation, retains capacity and can reclaim later',async()=>{
 const runtime=graphRuntime(),workers=new GraphWorkers(resolveConfig({graphMaxWorkers:1}),graphBinary);workers.attach(runtime)
 try{
  await workers.project(input(),8000,()=>true)
  const handle=runtime.handles[0],wait=handle.waitForExit
  handle.waitForExit=async()=>{throw new Error('observation unavailable')}
  await assert.rejects(workers.retire(scope.taskId),/cleanup_failed/)
  assert.equal(handle.stdout?.listenerCount('data'),0)
  await assert.rejects(workers.project(input(),8000,()=>true),/cleanup_failed|cleanup_pending/)
  assert.equal(runtime.handles.length,1)
  handle.waitForExit=wait;await handle.done;await workers.retire(scope.taskId)
  await workers.project(input(),8000,()=>true);assert.equal(runtime.handles.length,2)
 }finally{await workers.close()}
})
it('can retry retirement after the provider throws synchronously while terminating',async()=>{
 const runtime=graphRuntime(),workers=new GraphWorkers(resolveConfig({}),graphBinary);workers.attach(runtime)
 await workers.project(input(),6000,()=>true)
 const handle=runtime.handles[0],terminate=handle.terminate
 try{
  handle.terminate=()=>{throw new Error('termination observation failed')}
  await assert.rejects(workers.retire(scope.taskId),/cleanup_failed/)
  handle.terminate=terminate;await workers.retire(scope.taskId)
  assert.equal(workers.cleanup(scope.taskId),undefined)
 }finally{handle.terminate=terminate;handle.terminate();await handle.done;await workers.close()}
})
it('expires a held RPC using a controlled timer without sleeping or replaying',async t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 let entered!:()=>void;const barrier=new Promise<void>(resolve=>{entered=resolve});let sent=0
 const runtime=heldRuntime(()=>{sent++;entered()});const workers=new GraphWorkers(resolveConfig({}),graphBinary);workers.attach(runtime)
 const pending=workers.project(input(),8000,()=>true);const rejected=assert.rejects(pending,/graph_timeout/)
 await barrier;t.mock.timers.tick(5001);await rejected
 assert.equal(sent,1);assert.equal(runtime.terminated,true);await workers.close()
})
it('bounds a stuck same-task replacement and lets an independent task progress',async t=>{
 const runtime=graphRuntime();let now=0
 const workers=new GraphWorkers(resolveConfig({}),graphBinary,()=>now);workers.attach(runtime)
 let release!:()=>void,entered!:()=>void;const held=new Promise<void>(resolve=>{release=resolve}),barrier=new Promise<void>(resolve=>{entered=resolve})
 try{
  await workers.project(input(),8000,()=>true)
  const original=runtime.handles[0].waitForExit
  runtime.handles[0].waitForExit=async()=>{entered();await held;return original()}
  t.mock.timers.enable({apis:['setTimeout']})
  let replacementOutcome,independentOutcome
  const replacement=workers.project(input(runScope({...scope,runId:'run-33333333-3333-4333-8333-333333333333'})),8000,()=>true).then(()=>{replacementOutcome='ready'},e=>{replacementOutcome=e.code})
  await barrier
  const independent=workers.project(input(runScope({...scope,taskId:'task-22222222-2222-4222-8222-222222222222',ownerSessionId:'independent'})),8000,()=>true).then(()=>{independentOutcome='ready'},e=>{independentOutcome=e.code})
  // Flush the admission microtasks; no elapsed-time condition admits the task.
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(runtime.handles.length,2,'an unrelated task must not queue behind replacement cleanup')
  // Wait for the real helper response without using elapsed time as evidence.
  await independent;assert.equal(independentOutcome,'ready')
  now=6000;t.mock.timers.tick(6000);await new Promise(resolve=>setImmediate(resolve))
  assert.equal(replacementOutcome,'graph_timeout')
  release();await replacement
 }finally{release();await workers.close()}
})
it('returns a timed-out RPC before cleanup finishes while retaining cleanup ownership',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0,entered!:()=>void,release!:()=>void
 const barrier=new Promise<void>(resolve=>{entered=resolve}),cleanup=new Promise<void>(resolve=>{release=resolve})
 const runtime=heldRuntime(()=>entered()),spawn=runtime.spawn
 runtime.spawn=()=>{const h=spawn();h.waitForExit=async()=>{await cleanup;await h.done;return true};return h}
 const workers=new GraphWorkers(resolveConfig({}),graphBinary,()=>now);workers.attach(runtime)
 try{
  const pending=workers.project(input(),8000,()=>true),rejected=assert.rejects(pending,/graph_timeout/)
  await barrier;now=6000;t.mock.timers.tick(6000);await rejected
  assert.equal(runtime.terminated,true)
  let closed=false;const closing=workers.close().then(()=>{closed=true})
  await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false,'cleanup ownership must outlive the expired read')
  release();await closing;assert.equal(closed,true)
 }finally{release();await workers.close()}
})
it('does not lose the replacement worker when retiring its predecessor races with a read',async t=>{
 const {workers,runtime}=setup(t)
 t.after(async()=>{for(const h of runtime.handles){h.terminate();await h.done}})
 await workers.project(input(),8000,()=>true)
 let entered!:()=>void,release!:()=>void;const barrier=new Promise<void>(resolve=>{entered=resolve}),cleanup=new Promise<void>(resolve=>{release=resolve}),first=runtime.handles[0],wait=first.waitForExit
 first.waitForExit=async()=>{entered();await cleanup;return wait()}
 try{
  const replacement=workers.project(input(runScope({...scope,runId:'run-33333333-3333-4333-8333-333333333333'})),8000,()=>true)
  await barrier;const retiring=workers.retire(scope.taskId);release()
  await Promise.all([replacement,retiring]);assert.equal(runtime.handles.length,2)
  await workers.close()
  assert.ok(runtime.handles.every(h=>h.child.exitCode!==null||h.child.signalCode!==null),'all replacement processes must stay owned through disposal')
 }finally{release()}
})
