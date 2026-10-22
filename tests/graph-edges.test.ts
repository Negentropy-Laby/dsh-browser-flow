import assert from 'node:assert/strict'
import { it } from 'node:test'
import { GraphWorkers, graphHash } from '../src/graph/worker.ts'
import { validateDetail } from '../src/graph/validation.ts'
import { resolveConfig } from '../src/config.ts'
import type { GraphInput } from '../src/graph/protocol.ts'
import { graphRuntime, graphBinary } from './helpers/graph-process.ts'
import { TASK } from './helpers/task-scope.ts'
import { expectRecord, expectList } from './helpers/assertions.ts'
import { kernelFallbackDescriptor } from '../src/task-resources.ts'

function input():GraphInput{return {scope:TASK,version:2,tailHash:'h2',events:[{seq:1,hash:'h1',type:'created',run:TASK,goal:'Synthetic'},{seq:2,hash:'h2',type:'asset',run:TASK,id:'evidence-1',kind:'evidence',source:'host'}],goal:'Synthetic',constraints:[],criteria:[],protected:[],proofRef:'evidence-1',proofSeq:2,coldRounds:6,minGroup:2,liveDocumentToken:''}}
it('assigns a distinct proof edge to each synthetic passed criterion and validates full details',async t=>{
 const workers=new GraphWorkers(resolveConfig({}),graphBinary);workers.attach(graphRuntime());t.after(()=>workers.close())
 const value=input();value.criteria=['criterion-a','criterion-b'].map(id=>({id,label:id,status:'passed',source:'code_verified',validatorId:'synthetic',version:1}))
 const graph=expectRecord(await workers.detail(value,'graph',()=>true)),edges=expectList(graph.edges).map(expectRecord)
 assert.deepEqual(edges.map(e=>e.id),['proof-edge-2-criterion-a','proof-edge-2-criterion-b'])
 const hash=graphHash(JSON.stringify(value))
 for(const mode of ['missing','duplicate','foreign','forged'] as const){
  const changed=structuredClone(graph),rows=expectList(changed.edges)
  if(mode==='missing')rows.pop()
  if(mode==='duplicate')rows.push(rows[0])
  if(mode==='foreign')expectRecord(rows[0]).taskId='foreign'
  if(mode==='forged')expectRecord(rows[0]).from='goal-'+TASK.taskId+'-r1'
  assert.throws(()=>validateDetail(changed,'graph',value,hash),/invalid_projection/)
 }
})
it('matches replay-position edges while skipping forward and permanently dangling references',async t=>{
 const workers=new GraphWorkers(resolveConfig({}),graphBinary);workers.attach(graphRuntime());t.after(()=>workers.close())
 const value=input(),goal='goal-'+TASK.taskId+'-r1'
 value.events.splice(1,0,{seq:2,hash:'forward',type:'edge',run:TASK,id:'forward',from:goal,to:'evidence-1',relation:'yields'})
 value.events.push({seq:4,hash:'dangling',type:'edge',run:TASK,id:'dangling',from:goal,to:'never-created',relation:'yields'},
  {seq:5,hash:'backward',type:'edge',run:TASK,id:'backward',from:goal,to:'evidence-1',relation:'proves'})
 value.events.forEach((e,i)=>{e.seq=i+1});value.version=value.events.length;value.tailHash=value.events.at(-1)!.hash
 const graph=expectRecord(await workers.detail(value,'graph',()=>true)),edges=expectList(graph.edges).map(expectRecord)
 assert.deepEqual(edges.map(e=>e.id),['backward'])
 const changed=structuredClone(graph)
 expectList(changed.edges).push({...edges[0],id:'forward',sourceSeq:2,relation:'yields'})
 assert.throws(()=>validateDetail(changed,'graph',value,graphHash(JSON.stringify(value))),/invalid_projection/)
})

for(const [label,chars] of [['backspace','\b'],['formfeed','\f'],['all-ascii-controls',String.fromCharCode(...Array.from({length:32},(_,i)=>i))],['html-and-line-separators','<>&\u2028\u2029'],['unicode','中文😀']] as const)it(`matches direct Go fallback resources for ${label} without Host metadata`,async t=>{
 const workers=new GraphWorkers(resolveConfig({}),graphBinary);workers.attach(graphRuntime());t.after(()=>workers.close())
 const value=input(),run={...TASK,ownerSessionId:'synthetic-'+chars,workflowRef:'workflow-'+chars}
 value.scope=run;value.proofRef='';value.proofSeq=0
 value.events=value.events.map(e=>({...e,run,...(e.type==='asset'?{id:'asset-'+chars}:{})}))
 await workers.project(value,50000,()=>true)
 const assets=expectRecord(await workers.detail(value,'graph:assets',()=>true)),resource=expectRecord(expectList(assets.resources)[0])
 assert.equal(resource.id,kernelFallbackDescriptor(run,'evidence','asset-'+chars).id)
 assert.deepEqual(resource.run,run)
})
