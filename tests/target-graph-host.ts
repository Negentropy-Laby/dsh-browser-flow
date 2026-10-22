import {expectOk,expectString,present,expectRecord,expectList,expectFailure} from './helpers/assertions.ts'
import type {HostRuntime} from './helpers/host-runtime.ts'
/** Explicit Windows target-artifact fixture. It does not establish real website acceptance. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {GraphWorkers} from '../lib/host/graph/worker.js'
import {resolveConfig} from '../src/config.ts'
import type {GraphInput} from '../src/graph/protocol.ts'
import {TASK} from './helpers/task-scope.ts'
import {syntheticDefinition} from './helpers/task-definition.ts'

function barrier(){let release=()=>{},entered=()=>{};const gate=new Promise<void>(r=>{release=r}),ready=new Promise<void>(r=>{entered=r});return {release,entered,gate,ready}}
async function main(){
 if(process.platform!=='win32'||process.arch!=='x64')throw new Error('NOT_RUN: this fixture requires Windows x64')
 const checkout=process.env.DSH_CHECKOUT??process.argv[2],receipt=process.env.DSH_BF_GRAPH_RECEIPT??process.argv[3]
 if(!checkout||!receipt)throw new Error('Set explicit DSH_CHECKOUT and private DSH_BF_GRAPH_RECEIPT')
 const expected='687f282e8625c6b8d11ff58211a90524be2e4317'
 const sha=execFileSync(process.env.DSH_GIT??process.argv[4]??'git',['-C',checkout,'rev-parse','HEAD'],{encoding:'utf8'}).trim()
 assert.equal(sha,expected)
 assert.equal(execFileSync(process.env.DSH_GIT??process.argv[4]??'git',['-C',checkout,'status','--porcelain','-uno'],{encoding:'utf8'}).trim(),'')
 const load=(path:string)=>import(pathToFileURL(join(checkout,path)).href)
 const {Context}=await load('vendor/cordis/lib/index.js'),toolsModule=await load('packages/core/tools/lib/index.js'),provider=await load('packages/subprocess/subprocess-local/lib/index.js')
 const plugin=await import('../lib/host/index.js'),scratch=await mkdtemp(join(tmpdir(),'bf-target-graph-'))
 const context:HostRuntime=new Context();const agents=new Map(['a','b'].map(id=>['graph-'+id,{id:'graph-'+id}])),routes=new Map()
 const checks=[];let firstScope;let restoreSpawn=()=>{};const owned:import('../src/graph/protocol.ts').ProcessHandle[]=[]
 try{
  context.provide('profileContext',{name:'qualification',home:scratch});context.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{}})
  await context.plugin(toolsModule.default??toolsModule.ToolRuntime)
  await context.plugin(provider.default)
  const runtime=context.subprocess,original=runtime.spawn
  runtime.spawn=function(spec:Parameters<import('../src/graph/protocol.ts').SubprocessPort['spawn']>[0]){const handle=original.call(this,spec);owned.push(handle);return handle}
  restoreSpawn=()=>{Reflect.deleteProperty(runtime,'spawn')}
  context.provide('agents',{get:(id:string)=>agents.get(id)})
  context.provide('connection',{fetch:{register:(route:import('../src/index.ts').FetchRoute)=>{routes.set(route.path,route);return()=>routes.delete(route.path)}}})
  await context.plugin({inject:plugin.inject,apply:(ctx:import('../src/index.ts').HostContext)=>plugin.apply(ctx,{localTasksDir:join(scratch,'tasks')})})
  assert.equal(context.tools.schemas().filter((row)=>row.name.startsWith('browser_')).length,6);assert.equal(routes.size,7);checks.push('six tools and seven routes')
  async function post(path:string,body:object){const response=await routes.get('/api/browser-flow/'+path).fetch(new Request('http://fixture.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion:3,...body})}));const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.value}
  const outputs:Record<string,unknown>={}
  for(const id of ['a','b'] as const){
   const sessionId='graph-'+id,instanceId='panel-'+id
   const page={lease:'synthetic-guest-'+id,partition:'synthetic-'+id,documentToken:'document-'+id,url:'https://'+id+'.example/fixture'}
   await post('hello',{kind:'hello',connectionGeneration:1,sessionId,panel:{instanceId,pages:[page]}})
   const task=await post('authorize',{instanceId,connectionGeneration:1,sessionId,taskOperation:'create',spec:{goal:'Synthetic graph '+id,origins:['https://'+id+'.example'],criteria:['A free criterion stays unverified']}})
   if(id==='a')firstScope=task.task
   await post('authorize',{instanceId,connectionGeneration:1,sessionId,...page})
   const result=await present(context.tools.get('browser_observe')).execute({view:'task'},{agent:agents.get(sessionId),signal:new AbortController().signal})
   assert.equal(result.ok,true);assert.equal(expectRecord(expectRecord(expectRecord(result.value).active_context).graph).status,'ready',JSON.stringify(result))
   assert.equal(expectRecord(expectRecord(expectRecord(result.value).active_context).graph).kernelVersion,'3')
   assert.equal(expectRecord(result.value).businessVerdict,'unverified');outputs[id]=result
   const exec={agent:agents.get(sessionId),signal:new AbortController().signal}
   assert.equal((await present(context.tools.get('browser_release')).execute({},exec)).ok,true)
   assert.equal(expectFailure(await present(context.tools.get('browser_observe')).execute({},exec)).code,'not_authorized')
   assert.equal(expectFailure(await present(context.tools.get('browser_act')).execute({action:'click',documentToken:page.documentToken,elementRef:'synthetic-element'},exec)).code,'not_authorized')
   const waiting=await present(context.tools.get('browser_act')).execute({action:'await_user',wait:{kind:'other_user_input',reason:'Synthetic wait '+id,resumeCondition:'An actual new user response'}},{agent:agents.get(sessionId),signal:new AbortController().signal})
   assert.equal(waiting.ok,true)
   const view=await present(context.tools.get('browser_observe')).execute({view:'task'},{agent:agents.get(sessionId),signal:new AbortController().signal})
   assert.equal(expectRecord(expectRecord(expectRecord(expectOk(view)).active_context).waiting).reason,'Synthetic wait '+id)
  }
  assert.ok(!JSON.stringify(outputs.b).includes(firstScope.taskId));checks.push('actual Windows managed Go workers','task isolation','Host criteria remain unverified','Agent tool waits','release independent of graph','released synthetic binding rejects reads and writes')
  const readA=()=>present(context.tools.get('browser_observe')).execute({view:'task'},{agent:agents.get('graph-a'),signal:new AbortController().signal})
  const before=await readA(),count=owned.length
  owned[0].terminate();assert.equal(await owned[0].waitForExit(),true);await owned[0].done
  assert.equal(owned.length,count,'a crashed worker must not restart automatically')
  const after=await readA();assert.equal(expectRecord(expectRecord(expectRecord(expectOk(after)).active_context).graph).status,'ready')
  assert.equal(expectRecord(expectRecord(expectRecord(expectOk(after)).active_context).graph).projectionId,expectRecord(expectRecord(expectRecord(expectOk(before)).active_context).graph).projectionId)
  assert.equal(expectRecord(expectRecord(expectRecord(expectOk(after)).active_context).waiting).reason,'Synthetic wait a');assert.equal(expectRecord(expectRecord(expectOk(after)).active_context).pageControl,'unavailable')
  assert.equal(owned.length,count+1);checks.push('actual worker crash without automatic replay','deterministic reconstruction without restored control')
  function sequential(n:number):GraphInput{
   const events:GraphInput['events']=[{seq:1,hash:'hash-1',type:'created',run:TASK,goal:'Synthetic 中文😀'}]
   for(let i=0;i<n;i++)for(const type of ['attempt','receipt'] as const){const seq=events.length+1;events.push({seq,hash:'hash-'+seq,type,run:TASK,id:'intent-'+i,...(type==='attempt'?{action:'click'}:{outcome:'executed'})})}
   return {scope:TASK,version:events.length,tailHash:events.at(-1)!.hash,events,goal:'Synthetic 中文😀',constraints:[],criteria:[],protected:[],proofRef:'',proofSeq:0,coldRounds:6,minGroup:2,liveDocumentToken:''}
  }
  const timings=[]
  for(const [frameLimit,size]of [[65536,80],[8388608,8000]]){
   const probe=new GraphWorkers(resolveConfig({graphMaxFrameBytes:frameLimit})),detach=probe.attach(runtime)
   try{
    const input=sequential(size),started=performance.now()
    await probe.project(input,6000,()=>true)
    const projectMs=performance.now()-started,value=expectRecord(await probe.detail(input,'graph',()=>true)),bytes=Buffer.byteLength(JSON.stringify(value))
    assert.ok(bytes>frameLimit);assert.equal(expectList(value.nodes).filter(row=>expectRecord(row).kind!=='digest').length,2*size+1)
    timings.push({events:input.events.length,projectMs,frameLimit,detailBytes:bytes,defaultDeadlineMs:5000})
   }finally{await detach();await probe.close()}
  }
  checks.push('complete detail over 64 KiB frames','16001 events within default request budget','complete detail over 8 MiB frame')
  const retirement=new GraphWorkers(resolveConfig({})),hold=barrier();let retiredHandle:import('../src/graph/protocol.ts').ProcessHandle|undefined
  const detachRetirement=retirement.attach({spawn(spec){const handle=runtime.spawn(spec);retiredHandle=handle;return handle}})
  try{
   await retirement.project(sequential(0),6000,()=>true)
   const handle=present(retiredHandle),wait=handle.waitForExit.bind(handle)
   handle.waitForExit=async()=>{hold.entered();await hold.gate;return wait()}
   const retiring=retirement.retire(TASK.taskId);await hold.ready
   const count=owned.length;let completed=false
   const reading=retirement.project(sequential(0),6000,()=>true).then(value=>{completed=true;return value})
   const outcome=Promise.allSettled([reading])
   await new Promise(resolve=>setImmediate(resolve))
   assert.equal(completed,false);assert.equal(owned.length,count)
   hold.release();await retiring
   assert.equal((await outcome)[0].status,'fulfilled');assert.equal(owned.length,count+1)
   checks.push('same-scope read waits for actual owned Windows worker exit before replacement')
  }finally{hold.release();await detachRetirement();await retirement.close()}
  let clock=0,idleHandle:import('../src/graph/protocol.ts').ProcessHandle|undefined
  const idle=new GraphWorkers(resolveConfig({graphIdleMs:1000}),undefined,()=>clock)
  const detachIdle=idle.attach({spawn(spec){const h=runtime.spawn(spec);idleHandle=h;clock=6000;return h}})
  try{
   await assert.rejects(idle.project(sequential(0),6000,()=>true),/graph_timeout/)
   await present(idleHandle).done
   assert.equal(await present(idleHandle).waitForExit(),true)
   checks.push('actual pre-RPC idle worker exit after acquisition timeout')
  }finally{await detachIdle();await idle.close()}
  const {TaskStore}=await import('../lib/host/task-store.js'),root=join(scratch,'evidence-tasks'),definition=syntheticDefinition({root})
  await writeFile(join(definition.dir,'definition.json'),JSON.stringify({...definition.definition,adapter:'bjrsj',origins:['https://fuwu.rsj.beijing.gov.cn'],workflows:definition.definition.workflows.map(w=>({...w,id:'navigation',stopBoundary:'before_file_selection'}))}))
  const evidenceGraph=new GraphWorkers(resolveConfig({})),detachEvidence=evidenceGraph.attach(runtime),store=new TaskStore(root,{name:'evidence',home:scratch},100,evidenceGraph)
  try{
   const access=await store.create('synthetic-evidence',{definitionId:'synthetic',workflowRef:'navigation',goal:'Synthetic evidence invalidation'})
   const pageRef=await store.asset(access,'page',{url:'https://fuwu.rsj.beijing.gov.cn/zhrs/yltc/information-third-new/imp',documentToken:'synthetic-document',nodes:['模板下载','上传申报信息','批量增员','批量修改','批量减员'].map(text=>({text}))})
   const proofRef=await store.proof(access,{schemaVersion:1,kind:'navigation',run:access.run,pageRef})
   assert.equal(await store.verdict(access,{verdict:'entry_reached'},proofRef),'entry_reached')
   const before=await store.view(access,8000);assert.equal(before.active_context.businessVerdict,'entry_reached')
   const artifact=expectRecord(present(store.openTask(access).events.find(e=>e.type==='asset'&&e.data.id===proofRef)).data.data)
   const first=expectRecord(await store.detail(access,'graph',0,100)),projectionId=expectString(first.projectionId),totalChars=Number(first.totalChars)
   let graphs=0,evidence=0,reads=0
   const detail=evidenceGraph.detail.bind(evidenceGraph),refresh=store.refreshEvidence.bind(store),read=store.readArtifact.bind(store)
   evidenceGraph.detail=async(...args)=>{graphs++;return detail(...args)}
   store.refreshEvidence=async(...args)=>{evidence++;return refresh(...args)}
   store.readArtifact=async(...args)=>{reads++;return read(...args)}
   await assert.rejects(store.detail(access,'graph',Number.MAX_SAFE_INTEGER,100,projectionId),{code:'invalid_request'})
   await assert.rejects(store.detail(access,'graph',totalChars+1,100,projectionId),{code:'invalid_request'})
   assert.equal(graphs,0);assert.equal(evidence,0);assert.equal(reads,0)
   const end=expectRecord(await store.detail(access,'graph',totalChars,100,projectionId));assert.equal(end.text,'');assert.equal(end.complete,true)
   assert.equal(reads,2);checks.push('scoped offset preflight skips Windows graph and evidence reads','two-phase unique original verification and exact-end continuation')
   const ref={role:'proof',path:expectString(artifact.artifact),sha256:expectString(artifact.sha256),bytes:Number(artifact.bytes)},state=store.artifactState.bind(store),data=store.openTask(access),fixed=await state(data,ref)
   reads=0
   store.artifactState=async(owner,item)=>item.path===ref.path?fixed:state(owner,item)
   store.readArtifact=async(...args)=>{reads++;const bytes=await read(...args);if(reads===1)await writeFile(join(data.dir,ref.path),Buffer.alloc(bytes.length,32));return bytes}
   const after=await store.view(access,8000);assert.equal(after.active_context.businessVerdict,'unverified');assert.equal(after.active_context.graph.reason,'stale_projection')
   assert.equal(reads,2);assert.equal(data.checkedProofs?.has(proofRef),false)
   store.artifactState=state;store.readArtifact=read
   const details=expectRecord(await store.detail(access,'criteria',0,8000))
   assert.ok(expectList(JSON.parse(expectString(details.text))).every(c=>expectRecord(c).status!=='passed'))
   checks.push('changed bytes with fixed reported metadata invalidate Host proof and stale graph','fact detail independently rechecks evidence')
  }finally{await store.close();await detachEvidence();await evidenceGraph.close()}
  await context.fiber.dispose();assert.ok((await Promise.all(owned.map(handle=>handle.waitForExit()))).every(Boolean));assert.equal(context.tools?.schemas().filter((row)=>row.name.startsWith('browser_')).length??0,0);checks.push('awaited provider and plugin disposal')
  const manifest=JSON.parse(await readFile(new URL('../lib/native/manifest.json',import.meta.url),'utf8'))
  const result={recordedAt:new Date().toISOString(),status:'PASS',kind:'target-artifact fixture; synthetic task calls, not normal Agent or website acceptance',target:sha,node:process.version,platform:process.platform,checks,timings,native:manifest,hostSha256:createHash('sha256').update(await readFile(new URL('../lib/host/index.js',import.meta.url))).digest('hex')}
  await writeFile(resolve(receipt),JSON.stringify(result,null,2)+'\n',{flag:'wx'})
  process.stdout.write(JSON.stringify({status:result.status,checks:checks.length,target:sha})+'\n')
 }finally{await context.fiber.dispose();restoreSpawn();await rm(scratch,{recursive:true,force:true})}
}
main().catch(error=>{process.stderr.write(String(error.stack??error)+'\n');process.exitCode=1})
