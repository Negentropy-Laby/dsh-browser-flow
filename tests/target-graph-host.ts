import {expectOk,expectString,present,expectRecord,expectList,expectFailure} from './helpers/assertions.ts'
import type {HostRuntime} from './helpers/host-runtime.ts'
/** Explicit Windows target-artifact fixture. It does not establish real website acceptance. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, open, type FileHandle } from 'node:fs/promises'
import type {StatOptions} from 'node:fs'
import {mock} from 'node:test'
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
import type {TaskStore,TaskAccess} from '../lib/host/task-store.js'

function barrier(){let release=()=>{},entered=()=>{};const gate=new Promise<void>(r=>{release=r}),ready=new Promise<void>(r=>{entered=r});return {release,entered,gate,ready}}
async function boundedArtifacts(store:TaskStore,access:TaskAccess,checks:string[]){
 const data=store.openTask(access),path=join(data.dir,'evidence',access.run.runId,'bounded-synthetic.bin'),original=Buffer.alloc(4096,1)
 await writeFile(path,original)
 const ref=await store.artifact(access,path,'snapshot'),writer=await open(path,'r+'),prototype=Object.getPrototypeOf(writer) as FileHandle
 const identity=await writer.stat({bigint:true}),stat=prototype.stat,read=prototype.read
 try{
  for(const mode of ['grow32','grow128','ongoing','short'] as const){
   await writer.truncate(0);await writer.write(original,0,original.length,0)
   const seen=new Set<FileHandle>(),buffers=new Set<Buffer>();let total=0,closed=0,size=original.length
   try{
    mock.method(prototype,'stat',async function(this:FileHandle,options?:StatOptions){
     const value=await stat.call(this,options)
     if(this!==writer&&value.dev===identity.dev&&value.ino===identity.ino&&!seen.has(this)){
      seen.add(this);const close=this.close.bind(this)
      mock.method(this,'close',async()=>{try{await close()}finally{closed++}})
      if(mode==='grow32'||mode==='grow128')await writer.truncate((mode==='grow32'?32:128)*1024*1024)
     }
     return value
    })
    mock.method(prototype,'read',async function(this:FileHandle,buffer:Buffer,offset:number,length:number,position:number){
     if(!seen.has(this))return Reflect.apply(read,this,[buffer,offset,length,position])
     buffers.add(buffer)
     if(mode==='ongoing'){size+=1024*1024;await writer.truncate(size)}
     const result=expectRecord(await Reflect.apply(read,this,[buffer,offset,Math.min(length,mode==='short'||mode==='ongoing'?256:length),position]))
     assert.equal(result.buffer,buffer);total+=Number(result.bytesRead);return result
    })
    if(mode==='short')assert.deepEqual(await store.readArtifact(data,ref),original)
    else await assert.rejects(mode==='grow128'?store.artifact(access,path,'snapshot'):store.readArtifact(data,ref),/task-evidence-mismatch/)
    assert.equal(total,original.length+(mode==='short'?0:1));assert.equal(buffers.size,1)
    assert.ok([...buffers].every(buffer=>buffer.length===original.length+1));assert.equal(closed,1)
    assert.ok([...seen].every(handle=>handle.fd===-1))
   }finally{mock.restoreAll()}
  }
 }finally{await writer.close();await rm(path)}
 checks.push('Windows stat-after-growth reads and allocations bounded at initial size plus one','Windows ongoing growth, short reads, verify=false and handle closure')
}
async function snapshotRace(store:TaskStore,access:TaskAccess,id:string,checks:string[]){
 const data=store.openTask(access),version=data.events.length,hold=barrier(),sample=await open(join(data.dir,'manifest.json'),'r'),prototype=Object.getPrototypeOf(sample) as FileHandle
 await sample.close()
 const write=prototype.writeFile,sync=prototype.sync,read=store.readArtifact.bind(store),opened=store.openTask.bind(store);let fd=-2,reads=0;const versions:number[]=[]
 mock.method(prototype,'writeFile',function(this:FileHandle,...args:Parameters<FileHandle['writeFile']>){if(Buffer.isBuffer(args[0])&&args[0].includes(Buffer.from('late-windows-snapshot')))fd=this.fd;return Reflect.apply(write,this,args)})
 mock.method(prototype,'sync',async function(this:FileHandle){await sync.call(this);if(this.fd===fd){fd=-2;const close=this.close.bind(this);mock.method(this,'close',async()=>{await close();hold.entered();await hold.gate})}})
 const writing=store.asset(access,'page',{marker:'late-windows-snapshot'});void writing.catch(()=>{})
 try{
  await hold.ready
  store.openTask=(...args)=>{const value=opened(...args);if(reads===2)versions.push(value.events.length);return value}
  store.readArtifact=async(...args)=>{const bytes=await read(...args);if(++reads===2)hold.release();return bytes}
  await assert.rejects(store.detail(access,id,0,100),{code:'task_busy'});await writing
  assert.equal(versions[0],version);assert.equal(versions.at(-1),version+1)
 }finally{hold.release();await writing;store.openTask=opened;store.readArtifact=read;mock.restoreAll()}
 const stable=expectRecord(await store.detail(access,id,0,100));assert.equal(stable.contextVersion,version+1)
 checks.push('Windows synchronized append after inner evidence guard rejects mismatched original detail','Windows stable original detail reports its captured journal version')
}
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
  async function post(path:string,body:object){const response=await routes.get('/api/browser-flow/'+path).fetch(new Request('http://fixture.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion:4,...body})}));const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.value}
  const outputs:Record<string,unknown>={}
  for(const id of ['a','b'] as const){
   const sessionId='graph-'+id,instanceId='panel-'+id
   const page={lease:'synthetic-guest-'+id,partition:'synthetic-'+id,documentToken:'document-'+id,url:'https://'+id+'.example/fixture'}
   await post('hello',{kind:'hello',connectionGeneration:1,sessionId,panel:{instanceId,pages:[page]}})
   const task=await post('authorize',{instanceId,connectionGeneration:1,sessionId,taskOperation:'create',spec:{workflowRef:'generic',goal:'Synthetic graph '+id,origins:['https://'+id+'.example'],criteria:['A free criterion stays unverified']}})
   if(id==='a')firstScope=task.task
   await post('authorize',{instanceId,connectionGeneration:1,sessionId,...page})
   const result=await present(context.tools.get('browser_observe')).execute({view:'task'},{agent:agents.get(sessionId),signal:new AbortController().signal})
   assert.equal(result.ok,true);assert.equal(expectRecord(expectRecord(expectRecord(result.value).active_context).graph).status,'ready',JSON.stringify(result))
   assert.equal(expectRecord(expectRecord(expectRecord(result.value).active_context).graph).kernelVersion,'5')
   assert.equal(expectRecord(result.value).businessVerdict,'unverified');outputs[id]=result
   const exec={agent:agents.get(sessionId),signal:new AbortController().signal}
   for(const ref of ['graph:assets','graph:exploration','coverage']){
    const first=expectRecord(expectOk(await present(context.tools.get('browser_observe')).execute({view:'task',ref,offset:0},exec)))
    assert.equal(typeof first.projectionId,'string')
    assert.equal(expectFailure(await present(context.tools.get('browser_observe')).execute({view:'task',ref,offset:10},exec)).code,'task_not_bound')
    const next=expectRecord(expectOk(await present(context.tools.get('browser_observe')).execute({view:'task',ref,offset:10,projectionId:first.projectionId},exec)))
    assert.equal(next.offset,10)
    if(ref==='coverage'){const coverage=expectRecord(JSON.parse(expectString(first.text)));assert.equal(coverage.total,1);assert.equal(coverage.verified,0);assert.equal(coverage.ratio,0)}
   }
   const observing=present(context.tools.get('browser_observe')).execute({},exec)
   const polled=await post('poll',{instanceId,connectionGeneration:1,sessionId,pages:[page]}),command=polled.commands[0]
   assert.equal(polled.commands.length,1)
   await post('result',{kind:'result',task:command.task,id:command.id,leaseId:command.leaseId,instanceId,connectionGeneration:1,epoch:command.epoch,sequence:command.sequence,outcome:'ok',payload:{url:page.url,documentToken:page.documentToken,contextOnly:true,resourceIdentity:{version:1,key:'f'.repeat(64),basis:'document_instance',snapshotKind:'context'}}})
   assert.equal(expectRecord(expectOk(await observing)).contextOnly,false)
   const observedTask=expectRecord(expectOk(await present(context.tools.get('browser_observe')).execute({view:'task'},exec)))
   const observedAsset=expectRecord(expectList(expectRecord(observedTask.technical_law_index).assets).find(row=>expectRecord(row).kind==='page'))
   const original=expectRecord(JSON.parse(expectString(expectRecord(expectOk(await present(context.tools.get('browser_observe')).execute({view:'task',ref:observedAsset.id},exec))).text)))
   assert.equal(expectRecord(original.data).contextOnly,false)
   assert.equal(expectRecord(expectRecord(original.data).resourceIdentity).snapshotKind,'observation')
   checks.push(`Windows ${id} Host owns ordinary observation flags in results and original snapshots`)
   assert.equal((await present(context.tools.get('browser_release')).execute({},exec)).ok,true)
   assert.equal(expectFailure(await present(context.tools.get('browser_observe')).execute({},exec)).code,'not_authorized')
   assert.equal(expectFailure(await present(context.tools.get('browser_act')).execute({action:'click',documentToken:page.documentToken,elementRef:'synthetic-element'},exec)).code,'not_authorized')
   const waiting=await present(context.tools.get('browser_act')).execute({action:'await_user',wait:{kind:'other_user_input',reason:'Synthetic wait '+id,resumeCondition:'An actual new user response'}},{agent:agents.get(sessionId),signal:new AbortController().signal})
   assert.equal(waiting.ok,true)
   const view=await present(context.tools.get('browser_observe')).execute({view:'task'},{agent:agents.get(sessionId),signal:new AbortController().signal})
   assert.equal(expectRecord(expectRecord(expectRecord(expectOk(view)).active_context).waiting).reason,'Synthetic wait '+id)
  }
  assert.ok(!JSON.stringify(outputs.b).includes(firstScope.taskId));checks.push('actual Windows managed Go workers','task isolation','Host criteria remain unverified','Agent tool waits','release independent of graph','released synthetic binding rejects reads and writes')
  checks.push('both dual views and Host coverage through mounted Windows tools','new detail continuations require projection identity')
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
   const access=await store.create('synthetic-evidence',{definitionId:'synthetic',workflowRef:'navigation',goal:'Synthetic evidence invalidation',criteria:['Free text A','Free text B']})
   const {pageIdentity}=await import('../lib/host/task-resources.js')
   const guest={connectionInstanceId:'synthetic-panel',connectionGeneration:1,lease:'synthetic-guest',partition:'synthetic-partition',documentToken:'synthetic-document'}
   const pageRef=await store.asset(access,'page',{url:'https://fuwu.rsj.beijing.gov.cn/zhrs/yltc/information-third-new/imp',documentToken:guest.documentToken,resourceIdentity:pageIdentity(access.run,guest,'observation'),nodes:['模板下载','上传申报信息','批量增员','批量修改','批量减员'].map(text=>({text}))})
   const repeated=await store.asset(access,'page',{documentToken:guest.documentToken,resourceIdentity:pageIdentity(access.run,guest,'observation')})
   const proofRef=await store.proof(access,{schemaVersion:1,kind:'navigation',run:access.run,pageRef})
   await store.relate(access,proofRef,pageRef,'observed_on')
   assert.equal(await store.verdict(access,{verdict:'entry_reached'},proofRef),'entry_reached')
   const readDetail=async(ref:string)=>expectRecord(JSON.parse(expectString(expectRecord(await store.detail(access,ref,0,100000)).text)))
   const assetGraph=await readDetail('graph:assets'),explorationGraph=await readDetail('graph:exploration')
   assert.deepEqual(assetGraph.anchors,explorationGraph.anchors)
   const resource=expectRecord(expectList(assetGraph.resources).find(r=>expectList(expectRecord(r).snapshots).includes(pageRef)))
   assert.deepEqual(resource.snapshots,[pageRef,repeated])
   assert.deepEqual((await readDetail(expectString(resource.id))).evidenceRefs,[proofRef])
   const coverage=await readDetail('coverage');assert.equal(coverage.total,3);assert.equal(coverage.verified,1);assert.equal(coverage.ratio,1/3)
   checks.push('Windows document-instance grouping preserves exact snapshots','Windows cross-plane anchors and reverse proof trace','Windows trusted coverage is 1/3 with two unverified free-text criteria')
   const before=await store.view(access,8000);assert.equal(before.active_context.businessVerdict,'entry_reached')
   const artifact=expectRecord(present(store.openTask(access).events.find(e=>e.type==='asset'&&e.data.id===proofRef)).data.data)
   const first=expectRecord(await store.detail(access,'graph',0,100)),projectionId=expectString(first.projectionId),totalChars=Number(first.totalChars)
   let graphs=0,evidence=0,reads=0
   const detail=evidenceGraph.detail.bind(evidenceGraph),refresh=store.refreshEvidence.bind(store),read=store.readArtifact.bind(store)
   evidenceGraph.detail=async(...args)=>{graphs++;return detail(...args)}
   store.refreshEvidence=async(...args)=>{evidence++;return refresh(...args)}
   store.readArtifact=async(...args)=>{reads++;return read(...args)}
   for(const ref of [pageRef,proofRef,'criteria','goal','waiting','instructions/steps.md','graph','digest-synthetic']){
    await assert.rejects(store.detail(access,ref,Number.MAX_SAFE_INTEGER,100,projectionId),{code:'invalid_request'})
    assert.equal(expectFailure(await present(context.tools.get('browser_observe')).execute({view:'task',ref,offset:Number.MAX_SAFE_INTEGER},{agent:agents.get('graph-a'),signal:new AbortController().signal})).code,'invalid_request')
   }
   await assert.rejects(store.detail(access,'graph',totalChars+1,100,projectionId),{code:'invalid_request'})
   assert.equal(graphs,0);assert.equal(evidence,0);assert.equal(reads,0)
   const end=expectRecord(await store.detail(access,'graph',totalChars,100,projectionId));assert.equal(end.text,'');assert.equal(end.complete,true)
   assert.equal(reads,2);checks.push('scoped offset preflight skips Windows graph and evidence reads','two-phase unique original verification and exact-end continuation')
   checks.push('all original and derived offsets reject before evidence I/O; normal Host tool boundary rejects extreme offsets')
   store.readArtifact=read;store.refreshEvidence=refresh
   await boundedArtifacts(store,access,checks)
   await snapshotRace(store,access,pageRef,checks)
   const large=await store.asset(access,'file',{text:'中😀'.repeat(10000)}),config=store.graphConfig
   store.graphConfig={...config,graphMaxFrameBytes:65536,graphMaxDetailBytes:65536}
   await assert.rejects(store.detail(access,large,0,100),/detail_capacity/)
   store.graphConfig=config
   checks.push('Windows original detail enforces UTF-8 byte capacity')
   await store.detail(access,'graph',0,100)
   const ref={role:'proof',path:expectString(artifact.artifact),sha256:expectString(artifact.sha256),bytes:Number(artifact.bytes)},state=store.artifactState.bind(store),data=store.openTask(access),fixed=await state(data,ref)
   reads=0
   store.artifactState=async(owner,item)=>item.path===ref.path?fixed:state(owner,item)
   store.readArtifact=async(...args)=>{reads++;const bytes=await read(...args);if(reads===1)await writeFile(join(data.dir,ref.path),Buffer.alloc(bytes.length,32));return bytes}
   const after=await store.view(access,8000);assert.equal(after.active_context.businessVerdict,'unverified');assert.equal(after.active_context.graph.reason,'stale_projection')
   assert.equal(after.active_context.coverage.verified,0)
   assert.equal(reads,2);assert.equal(data.checkedProofs?.has(proofRef),false)
   store.artifactState=state;store.readArtifact=read
   const details=expectRecord(await store.detail(access,'criteria',0,8000))
   assert.ok(expectList(JSON.parse(expectString(details.text))).every(c=>expectRecord(c).status!=='passed'))
   checks.push('changed bytes with fixed reported metadata invalidate Host proof and stale graph','fact detail independently rechecks evidence')
  }finally{await store.close();await detachEvidence();await evidenceGraph.close()}
  // Exercise generation 2 through the mounted Windows Host tool runtime.
  const genericFacts:string[]=[]
  for(const suffix of ['one','two']){
   const sessionId='generic-'+suffix,instanceId='generic-panel-'+suffix,agent={id:sessionId}
   agents.set(sessionId,agent)
   const page={lease:'generic-guest-'+suffix,partition:'generic-partition-'+suffix,documentToken:'generic-document-'+suffix,url:'https://'+suffix+'.example/neutral'}
   await post('hello',{kind:'hello',connectionGeneration:1,sessionId,panel:{instanceId,pages:[page]}})
   await post('authorize',{instanceId,connectionGeneration:1,sessionId,taskOperation:'create',spec:{goal:'Establish a synthetic outcome',origins:['https://'+suffix+'.example']}})
   await post('authorize',{instanceId,connectionGeneration:1,sessionId,...page})
   const exec={agent,signal:new AbortController().signal}
   const tool=async(name:string,args:Record<string,unknown>)=>expectRecord(expectOk(await present(context.tools.get(name)).execute(args,exec)))
   let request=0
   const explore=async(command:Record<string,unknown>)=>{const summary=await tool('browser_observe',{view:'task'});return tool('browser_act',{action:'explore',explore:command,requestId:'windows-'+(++request),expectedVersion:summary.contextVersion})}
   await explore({op:'add_intent',summary:'Inspect the actual synthetic outcome'})
   await explore({op:'claim_intent'})
   const observing=present(context.tools.get('browser_observe')).execute({view:'table'},exec)
   const polled=await post('poll',{instanceId,connectionGeneration:1,sessionId,pages:[page]}),command=polled.commands[0]
   assert.equal(command.op.view,'table')
   await post('result',{kind:'result',task:command.task,id:command.id,leaseId:command.leaseId,instanceId,connectionGeneration:1,epoch:command.epoch,sequence:command.sequence,outcome:'ok',payload:{url:page.url,documentToken:page.documentToken,title:'neutral-'+suffix,tables:[],domComplete:true,datasetComplete:false}})
   const observation=expectRecord(expectOk(await observing)),ref=expectString(observation.assetRef)
   const check=await explore({op:'check_evidence',assertion:{op:'equals',left:{ref,path:['title']},right:{value:observation.title}}})
   const fact=await explore({op:'record_fact',summary:'Observed and checked a synthetic result',confidence:'observed',evidence_refs:[ref],check_refs:[check.check_ref],asset_ids:[observation.resourceRef]})
   genericFacts.push(expectString(expectList(fact.ids)[0]))
   await explore({op:'finish_intent'})
   const overview=await tool('browser_observe',{view:'task',query:{op:'graph_overview'}}),goal=expectRecord(expectList(expectRecord(overview.value).goals)[0])
   const completed=await explore({op:'prove_goal',goal_id:goal.id,evidence_id:genericFacts.at(-1),reason:'The original snapshot satisfies the source-backed synthetic assertion'})
   assert.equal(completed.state,'completed');assert.equal(completed.proofSource,'agent')
   const view=await tool('browser_observe',{view:'task'});assert.equal(view.state,'completed');assert.equal(expectRecord(expectRecord(view.active_context).graph).status,'ready');assert.equal(expectRecord(view.active_context).pageControl,'unavailable')
   const detail=await tool('browser_observe',{view:'task',ref:'graph:exploration'})
   assert.ok(expectString(detail.text).includes('fact'))
   if(suffix==='two')assert.equal(expectFailure(await present(context.tools.get('browser_observe')).execute({view:'task',query:{op:'node_detail',id:genericFacts[0]}},exec)).code,'task_not_bound')
  }
  checks.push('Windows generation-2 goals/intents/facts and source-backed assertions through mounted tools','Windows completion revokes control and remains readable without claiming trusted business verdict','Windows generation-2 semantic and resource isolation')
  await context.fiber.dispose();assert.ok((await Promise.all(owned.map(handle=>handle.waitForExit()))).every(Boolean));assert.equal(context.tools?.schemas().filter((row)=>row.name.startsWith('browser_')).length??0,0);checks.push('awaited provider and plugin disposal')
  const manifest=JSON.parse(await readFile(new URL('../lib/native/manifest.json',import.meta.url),'utf8'))
  const result={recordedAt:new Date().toISOString(),status:'PASS',kind:'target-artifact fixture; synthetic task calls, not normal Agent or website acceptance',target:sha,node:process.version,platform:process.platform,checks,timings,native:manifest,hostSha256:createHash('sha256').update(await readFile(new URL('../lib/host/index.js',import.meta.url))).digest('hex')}
  await writeFile(resolve(receipt),JSON.stringify(result,null,2)+'\n',{flag:'wx'})
  process.stdout.write(JSON.stringify({status:result.status,checks:checks.length,target:sha})+'\n')
 }finally{await context.fiber.dispose();restoreSpawn();await rm(scratch,{recursive:true,force:true})}
}
main().catch(error=>{process.stderr.write(String(error.stack??error)+'\n');process.exitCode=1})
