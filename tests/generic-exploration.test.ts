import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,readFile,rename,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {TaskStore} from '../src/task-store.ts'
import {explorationState,currentResources,assertExplorationCapacity} from '../src/task-exploration.ts'
import {graphInput} from '../src/task-projections.ts'
import {resolveConfig} from '../src/config.ts'
import {GraphWorkers} from '../src/graph/worker.ts'
import {graphRuntime,graphBinary} from './helpers/graph-process.ts'

async function setup(t:import('node:test').TestContext,criteria:string[]=[],graph=false){
 const root=await mkdtemp(join(tmpdir(),'bf-generic-')),config=resolveConfig(undefined),worker=graph?new GraphWorkers(config,graphBinary):undefined
 if(worker)worker.attach(graphRuntime())
 const store=new TaskStore(root,{name:'test',home:join(root,'home')},1000,worker,config)
 t.after(async()=>{await worker?.close();await store.close();await rm(root,{recursive:true,force:true})})
 let access=await store.create('owner',{goal:'Produce the requested outcome',origins:['https://generic.test'],criteria})
 let counter=0
 const run=(command:Record<string,unknown>,id='r-'+(++counter))=>store.explore(access,command,id,store.openTask(access).events.length)
 const start=async()=>{const made=await run({op:'add_intent',summary:'Inspect and establish the requested outcome'});await run({op:'claim_intent'});return (made.ids as string[])[0]}
 const observe=()=>store.asset(access,'page',{contextOnly:false,documentToken:'document-a',result:{status:'settled',items:['A','B']}},'host',{persistOriginal:true})
 const checked=async(ref:string)=>{const r=await run({op:'check_evidence',assertion:{op:'equals',left:{ref,path:['result','status']},right:{value:'settled'}}});return String(r.check_ref)}
 const record=async(ref:string,check:string)=>{const r=await run({op:'record_fact',summary:'Observed the requested outcome',confidence:'observed',evidence_refs:[ref],check_refs:[check],asset_ids:[...currentResources(store.openTask(access)).keys()]});return (r.ids as string[])[0]}
 return {root,store,get access(){return access},set access(a){access=a},run,start,observe,checked,record,worker,config}
}

test('new generic task uses generation 2 and preserves original goals and conditions',async t=>{
 const h=await setup(t,['Every item accounted for'])
 const data=h.store.openTask(h.access),state=explorationState(data)
 assert.equal(data.manifest.schemaVersion,2);assert.equal(data.manifest.workflowRef,'exploration')
 assert.equal([...state.nodes.values()].filter(n=>n.kind==='goal').length,2)
 await h.run({op:'set_goals',goals:[{text:'Additional result'}]})
 assert.equal([...explorationState(data).nodes.values()].filter(n=>n.kind==='goal'&&n.data.original).length,2)
 const read=await h.store.queryExploration(h.access,{op:'graph_overview'})
 assert.equal((read.value as any).phase,'planner')
})
test('one semantic intent contains several durable attempts and requires result writeback',async t=>{
 const h=await setup(t),intent=await h.start()
 for(const action of ['click','select']){const id=await h.store.beginAttempt(h.access,action);await h.store.receipt(h.access,id,'executed')}
 const attempts=h.store.openTask(h.access).events.filter(e=>e.type==='attempt')
 assert.deepEqual(attempts.map(e=>e.data.intentId),[intent,intent])
 await assert.rejects(h.run({op:'add_intent',summary:'Another direction'}),/finish/)
 await assert.rejects(h.run({op:'finish_intent'}),/record/)
 const ref=await h.observe(),check=await h.checked(ref)
 await h.record(ref,check);await h.run({op:'finish_intent'})
 assert.equal(explorationState(h.store.openTask(h.access)).phase,'planner')
 assert.equal(explorationState(h.store.openTask(h.access)).round,1)
})
test('goal proof is Agent-authored, source checked, closes once and blocks future actions',async t=>{
 const h=await setup(t);await h.start();const ref=await h.observe(),check=await h.checked(ref),fact=await h.record(ref,check)
 await h.run({op:'finish_intent'})
 let withdrawn=0
 const goal=[...explorationState(h.store.openTask(h.access)).nodes.values()].find(n=>n.kind==='goal')!
 const version=h.store.openTask(h.access).events.length,cmd={op:'prove_goal',goal_id:goal.id,evidence_id:fact,reason:'The observed values establish the requested result'}
 const done=await h.store.explore(h.access,cmd,'complete',version,c=>{if(c)withdrawn++})
 assert.equal(done.state,'completed');assert.equal(done.proofSource,'agent');assert.equal(withdrawn,1)
 assert.equal(h.store.openTask(h.access).state,'completed')
 const before=h.store.openTask(h.access).events.length
 assert.equal((await h.store.explore(h.access,cmd,'complete',version)).replayed,true)
 assert.equal(h.store.openTask(h.access).events.length,before)
 await assert.rejects(h.store.beginAttempt(h.access,'click'),/ended/)
})
test('inferred facts and context-only assets cannot become business proofs',async t=>{
 const h=await setup(t);await h.start()
 const context=await h.store.asset(h.access,'page',{documentToken:'doc',contextOnly:true})
 await assert.rejects(h.run({op:'check_evidence',assertion:{op:'exists',left:{ref:context,path:[]}}}),/snapshot/)
 await h.run({op:'record_fact',summary:'A possible outcome',confidence:'inferred'})
 await h.run({op:'finish_intent'})
 const state=explorationState(h.store.openTask(h.access)),fact=[...state.nodes.values()].find(n=>n.kind==='fact'&&n.data.confidence==='inferred')!,goal=[...state.nodes.values()].find(n=>n.kind==='goal')!
 await assert.rejects(h.run({op:'prove_goal',goal_id:goal.id,evidence_id:fact.id,reason:'Guess'}),/observed fact/)
 assert.equal(h.store.openTask(h.access).state,'active')
})
test('tampered original invalidates checks and cannot close remaining original condition',async t=>{
 const h=await setup(t,['Second condition']);await h.start();const ref=await h.observe(),check=await h.checked(ref),fact=await h.record(ref,check)
 await h.run({op:'finish_intent'})
 const goals=[...explorationState(h.store.openTask(h.access)).nodes.values()].filter(n=>n.kind==='goal')
 await h.run({op:'prove_goal',goal_id:goals[0].id,evidence_id:fact,reason:'Observed'})
 const data=h.store.openTask(h.access),row=data.events.find(e=>e.data.id===ref)!,original=(row.data.data as any).original
 await writeFile(join(data.dir,original.path),'tampered')
 await assert.rejects(h.run({op:'prove_goal',goal_id:goals[1].id,evidence_id:fact,reason:'Observed'}),/passing/)
 const result=await h.store.queryExploration(h.access,{op:'node_detail',id:goals[0].id})
 assert.equal((result.value as any).evidenceVerification,'unavailable')
 assert.equal(data.state,'active')
})
test('cross-run originals and stale command versions are rejected',async t=>{
 const h=await setup(t);await h.start();const ref=await h.observe(),old=h.access
 h.access=await h.store.revise(h.access,{goal:'Revised result'})
 await assert.rejects(h.store.explore(h.access,{op:'add_hint',text:'stale'},'stale',1),/task changed/)
 await assert.rejects(h.run({op:'check_evidence',assertion:{op:'exists',left:{ref,path:[]}}}),/snapshot/)
 await assert.rejects(h.store.explore(old,{op:'add_hint',text:'old'},'old',1),/no longer current/)
})
test('unknown write blocks bookkeeping completion without disabling owned reads',async t=>{
 const h=await setup(t);await h.start();const attempt=await h.store.beginAttempt(h.access,'click');await h.store.receipt(h.access,attempt,'unknown_outcome')
 await assert.rejects(h.run({op:'finish_intent',state:'blocked',reason:'Uncertain write'}),/unknown write/)
 assert.equal((await h.store.queryExploration(h.access,{op:'graph_overview'})).contextVersion,h.store.openTask(h.access).events.length)
})
test('generation 2 recovery preserves phase, facts and source checks without replay',async t=>{
 const h=await setup(t);await h.start();const ref=await h.observe(),check=await h.checked(ref);await h.record(ref,check)
 const before=await readFile(join(h.store.openTask(h.access).dir,'basic_law_index/events.jsonl'))
 await h.store.close()
 const recovered=new TaskStore(h.root,{name:'test',home:join(h.root,'home')},1000);t.after(()=>recovered.close())
 const access=await recovered.forSession('owner'),data=recovered.openTask(access)
 assert.equal(data.readOnly,false);assert.equal(explorationState(data).phase,'worker')
 assert.equal(recovered.checkPassed(data,check,[ref]),true)
 assert.deepEqual(await readFile(join(data.dir,'basic_law_index/events.jsonl')),before)
})
test('kernel v5 projects semantic intent, separate attempts, facts and bidirectional resource anchors',async t=>{
 const h=await setup(t,[],true);await h.start();const ref=await h.observe(),check=await h.checked(ref);await h.record(ref,check)
 const id=await h.store.beginAttempt(h.access,'click');await h.store.receipt(h.access,id,'executed')
 const input=graphInput(h.store.openTask(h.access),h.config)
 assert.equal(input.exploration,true)
 const view=await h.store.view(h.access,50000)
 assert.equal(view.active_context.graph.status,'ready')
 const detail=JSON.parse((await h.store.detail(h.access,'graph:exploration',0,100000) as any).text)
 assert.equal(detail.nodes.filter((n:any)=>n.kind==='intent').length,1)
 assert.equal(detail.nodes.filter((n:any)=>n.kind==='attempt').length,1)
 assert.ok(detail.nodes.some((n:any)=>n.kind==='fact'))
 assert.ok(detail.anchors.some((e:any)=>e.from===ref||e.to===ref))
})

test('a failed assertion is reported explicitly and cannot be attached as a passing proof',async t=>{
 const h=await setup(t);await h.start();const ref=await h.observe()
 const check=await h.run({op:'check_evidence',assertion:{op:'equals',left:{ref,path:['result','status']},right:{value:'different'}}})
 assert.equal(check.status,'failed');assert.equal(check.ruleSource,'agent')
 await assert.rejects(h.record(ref,String(check.check_ref)),/failed/)
})
test('mandatory earlier goal evidence is rechecked before the final completion',async t=>{
 const h=await setup(t,['Another result']);await h.start()
 const first=await h.observe(),firstCheck=await h.checked(first),firstFact=await h.record(first,firstCheck)
 const second=await h.observe(),secondCheck=await h.checked(second),secondFact=await h.record(second,secondCheck)
 await h.run({op:'finish_intent'})
 const goals=[...explorationState(h.store.openTask(h.access)).nodes.values()].filter(n=>n.kind==='goal')
 await h.run({op:'prove_goal',goal_id:goals[0].id,evidence_id:firstFact,reason:'First result'})
 const data=h.store.openTask(h.access),row=data.events.find(e=>e.data.id===first)!
 await writeFile(join(data.dir,(row.data.data as any).original.path),'changed')
 await assert.rejects(h.run({op:'prove_goal',goal_id:goals[1].id,evidence_id:secondFact,reason:'Second result'}),/earlier goal proof/)
 assert.equal(data.state,'active')
})
test('task completion withdraws control before a real journal failure and never returns success',async t=>{
 const h=await setup(t);await h.start();const ref=await h.observe(),check=await h.checked(ref),fact=await h.record(ref,check)
 await h.run({op:'finish_intent'})
 const data=h.store.openTask(h.access),goal=[...explorationState(data).nodes.values()].find(n=>n.kind==='goal')!,path=join(data.dir,'basic_law_index/events.jsonl')
 await rename(path,path+'.preserved');await mkdir(path)
 let revoked=false
 await assert.rejects(h.store.explore(h.access,{op:'prove_goal',goal_id:goal.id,evidence_id:fact,reason:'Observed result'},'complete-failure',data.events.length,c=>{if(c)revoked=true}),/could not be synchronized/)
 assert.equal(revoked,true);assert.notEqual(data.state,'completed');assert.equal(data.blocked,true)
})
test('fact list cursors retain batch members and reject changed projections',async t=>{
 const h=await setup(t);await h.start()
 await h.run({op:'record_fact',facts:[{summary:'First inference',confidence:'inferred'},{summary:'Second inference',confidence:'inferred'}]})
 const first=await h.store.queryExploration(h.access,{op:'list_facts',limit:1}),a=first.value as any
 const second=await h.store.queryExploration(h.access,{op:'list_facts',limit:1,before:a.next_before,projectionId:first.projectionId}),b=second.value as any
 assert.notEqual(a.items[0].id,b.items[0].id)
 await h.run({op:'add_hint',text:'New information'})
 await assert.rejects(h.store.queryExploration(h.access,{op:'list_facts',limit:1,before:b.next_before,projectionId:first.projectionId}),/projection changed/)
})
test('new exploration tasks reject empty goals, empty conditions and unknown workflows',async t=>{
 const h=await setup(t)
 for(const spec of [{goal:' '},{goal:'Valid',criteria:[' ']},{goal:'Valid',workflowRef:'unrecognized'}])await assert.rejects(h.store.create('empty-'+JSON.stringify(spec),{origins:['https://generic.test'],...spec}),/blank|choose/)
})

test('every semantic overview and query is lossless JSON for the actual Host tool runtime',async t=>{
 const h=await setup(t),data=h.store.openTask(h.access)
 const lossless=(value:unknown)=>assert.deepEqual(value,JSON.parse(JSON.stringify(value)))
 const {taskView}=await import('../src/task-projections.ts')
 lossless(taskView(data,8000,undefined,'not_requested',true))
 for(const op of ['graph_overview','list_goals','list_facts','list_assets'])lossless(await h.store.queryExploration(h.access,{op}))
 await h.start();const ref=await h.observe(),check=await h.checked(ref),fact=await h.record(ref,check)
 for(const op of ['graph_overview','list_goals','list_facts','list_assets'])lossless(await h.store.queryExploration(h.access,{op}))
 lossless(await h.store.queryExploration(h.access,{op:'node_detail',id:fact},200))
 const {explorationOverview}=await import('../src/task-exploration.ts');lossless(explorationOverview(data))
 const {taskHost}=await import('./helpers/task-host.ts'),host=await taskHost(t)
 await host.task('a',{goal:'Generic JSON contract',origins:['https://a.example']})
 lossless(await host.tool('a','browser_observe',{view:'task'}))
})

test('exact snapshot anchors participate in resource neighbors and exploration coverage without duplicate asset_ids',async t=>{
 const h=await setup(t);await h.start();const ref=await h.observe(),check=await h.checked(ref)
 const fact=await h.run({op:'record_fact',summary:'Observed result from its exact original',confidence:'observed',evidence_refs:[ref],check_refs:[check]})
 const resource=[...currentResources(h.store.openTask(h.access)).values()][0]
 const neighbors=await h.store.queryExploration(h.access,{op:'asset_neighbors',id:resource.id})
 assert.ok((neighbors.value as {nodes:{id:string}[]}).nodes.some(n=>n.id===(fact.ids as string[])[0]))
 const assets=await h.store.queryExploration(h.access,{op:'list_assets'}),evidence=(assets.value as {items:{id:string;kind:string}[]}).items.find(n=>n.kind==='evidence')
 assert.ok(evidence,'the existing evidence resources are also discoverable through ARTEX asset queries')
 const proofNeighbors=await h.store.queryExploration(h.access,{op:'asset_neighbors',id:evidence.id})
 assert.ok((proofNeighbors.value as {nodes:{id:string}[]}).nodes.some(n=>n.id===(fact.ids as string[])[0]))
 const overview=await h.store.queryExploration(h.access,{op:'graph_overview'})
 assert.deepEqual((overview.value as {assetCoverage:{denominator:number;tested:number}}).assetCoverage.tested,1)
 assert.equal((overview.value as {assetCoverage:{denominator:number}}).assetCoverage.denominator,1,'checks and evidence stay outside exploration coverage')
})

for(const terminal of ['completed','cancelled','handed_off'])test(`generation 2 ${terminal} cannot be revised or overwritten, including after recovery`,async t=>{
 const h=await setup(t)
 if(terminal==='completed'){
  await h.start();const ref=await h.observe(),check=await h.checked(ref),fact=await h.record(ref,check);await h.run({op:'finish_intent'})
  const goal=[...explorationState(h.store.openTask(h.access)).nodes.values()].find(n=>n.kind==='goal')!
  await h.run({op:'prove_goal',goal_id:goal.id,evidence_id:fact,reason:'Observed result'})
 }else await h.store.end(h.access,terminal)
 const data=h.store.openTask(h.access),count=data.events.length
 await assert.rejects(h.store.revise(h.access,{goal:'Another result'}),{code:'task_write_blocked'})
 await h.store.end(h.access,'cancelled');await h.store.end(h.access,'handed_off')
 assert.equal(data.state,terminal);assert.equal(data.events.length,count)
 await assert.rejects(h.store.beginAttempt(h.access,'click'),{code:'task_write_blocked'})
 await assert.rejects(h.run({op:'add_hint',text:'New write'}),{code:'task_write_blocked'})
 await h.store.close()
 const restored=new TaskStore(h.root,{name:'test',home:join(h.root,'home')},1000);t.after(()=>restored.close())
 const access=await restored.forSession('owner')
 assert.equal(restored.openTask(access).state,terminal)
 await assert.rejects(restored.revise(access,{newRun:true}),{code:'task_write_blocked'})
})
test('cancellation permits only settlement of the already registered pending attempt',async t=>{
 const h=await setup(t);await h.start();const id=await h.store.beginAttempt(h.access,'click')
 await h.store.end(h.access,'cancelled');await h.store.receipt(h.access,id,'unknown_outcome')
 const data=h.store.openTask(h.access)
 assert.equal(data.state,'cancelled');assert.equal(data.pendingWrite,undefined);assert.equal(data.blocked,true)
 await assert.rejects(h.store.receipt(h.access,id,'executed'),{code:'invalid_request'})
})
test('recovery retains a terminal prefix and diagnoses a hash-valid resurrection without rewriting bytes',async t=>{
 const h=await setup(t);await h.store.end(h.access,'cancelled')
 const data=h.store.openTask(h.access),last=data.events.at(-1)!,path=join(data.dir,'basic_law_index/events.jsonl')
 const {createHash,randomUUID}=await import('node:crypto')
 const unsigned={schemaVersion:2,seq:last.seq+1,prev:last.hash,type:'revise',data:{manifest:{...data.manifest,scope:{...data.manifest.scope,scopeRevision:2},runId:'run-'+randomUUID()}}}
 const bytes=Buffer.concat([await readFile(path),Buffer.from(JSON.stringify({...unsigned,hash:createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')})+'\n')])
 await writeFile(path,bytes);await h.store.close()
 const restored=new TaskStore(h.root,{name:'test',home:join(h.root,'home')},1000);t.after(()=>restored.close())
 const access=await restored.forSession('owner'),recovered=restored.openTask(access)
 assert.equal(recovered.state,'cancelled');assert.equal(recovered.unhealthy,true)
 assert.match(recovered.storageIssue!,new RegExp(`seq=${last.seq+1}$`));assert.deepEqual(await readFile(path),bytes)
})
test('normal tools replay a lost completion acknowledgement without reacquiring control or writing',async t=>{
 const {taskHost}=await import('./helpers/task-host.ts'),h=await taskHost(t)
 await h.task('a',{goal:'Synthetic requested result',origins:['https://a.example']});await h.authorize('a')
 const store=h.service.tasks,access=await store.forSession('session-a'),data=store.openTask(access)
 let request=0
 const run=async(explore:Record<string,unknown>)=>{
  const result=await h.tool('a','browser_act',{action:'explore',explore,requestId:'request-'+(++request),expectedVersion:data.events.length}) as any
  assert.equal(result.ok,true,JSON.stringify(result));return result.value
 }
 await run({op:'add_intent',summary:'Inspect result'});await run({op:'claim_intent'})
 const ref=await store.asset(access,'page',{contextOnly:false,result:'ok'},'host',{persistOriginal:true})
 const check=await run({op:'check_evidence',assertion:{op:'equals',left:{ref,path:['result']},right:{value:'ok'}}})
 const fact=await run({op:'record_fact',summary:'Observed result',confidence:'observed',evidence_refs:[ref],check_refs:[check.check_ref]})
 await run({op:'finish_intent'})
 const goal=[...explorationState(data).nodes.values()].find(n=>n.kind==='goal')!
 const args={action:'explore',explore:{op:'prove_goal',goal_id:goal.id,evidence_id:fact.ids[0],reason:'Observed result'},requestId:'completion',expectedVersion:data.events.length}
 assert.equal((await h.tool('a','browser_act',args) as any).value.state,'completed')
 const count=data.events.length
 for(let retry=0;retry<2;retry++)assert.equal((await h.tool('a','browser_act',args) as any).value.replayed,true)
 assert.equal(data.events.length,count);assert.equal(h.service.state.leaseCountForSession('session-a'),0)
 assert.equal((await h.tool('a','browser_act',{...args,expectedVersion:args.expectedVersion+1}) as any).error.code,'invalid_request')
 assert.equal((await h.tool('a','browser_act',{...args,requestId:'new'}) as any).error.code,'task_write_blocked')
 assert.equal((await h.tool('b','browser_act',args) as any).ok,false)
 const binding={instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a'}
 assert.equal((await h.post('authorize',{...binding,taskOperation:'revise',spec:{goal:'New'}})).body.error.code,'task_write_blocked')
 assert.equal((await h.post('authorize',{...binding,taskOperation:'cancel'})).body.value.state,'completed')
 assert.equal((await h.authorize('a')).body.error.code,'task_write_blocked')
 assert.equal(data.events.length,count)
})

for(const count of [32,33,64])test(`${count} original sources support check, fact and final goal proof`,async t=>{
 const h=await setup(t);await h.start();const refs:string[]=[]
 for(let i=0;i<count;i++)refs.push(await h.observe())
 const checks=[]
 for(let i=0;i<count;i+=2)checks.push({op:'equals',left:{ref:refs[i],path:['result','status']},right:i+1<count?{ref:refs[i+1],path:['result','status']}:{value:'settled'}})
 const check=await h.run({op:'check_evidence',assertion:{op:'all',checks}})
 assert.equal(check.status,'passed')
 const fact=await h.run({op:'record_fact',summary:'All sources agree',confidence:'observed',evidence_refs:refs,check_refs:[check.check_ref]})
 await h.run({op:'finish_intent'})
 const goal=[...explorationState(h.store.openTask(h.access)).nodes.values()].find(n=>n.kind==='goal')!
 assert.equal((await h.run({op:'prove_goal',goal_id:goal.id,evidence_id:(fact.ids as string[])[0],reason:'Checked all sources'})).state,'completed')
})
test('batch edge and expanded payload limits reject atomically before evidence IO',async t=>{
 const h=await setup(t);await h.start();const refs:string[]=[]
 for(let i=0;i<29;i++)refs.push(await h.observe())
 const data=h.store.openTask(h.access),anchors=[...currentResources(data).keys()]
 let reads=0;const refresh=h.store.refreshEvidence.bind(h.store)
 h.store.refreshEvidence=async(...args)=>{reads++;return refresh(...args)}
 const before=await readFile(join(data.dir,'basic_law_index/events.jsonl'))
 const fact={summary:'Observed',confidence:'observed',evidence_refs:refs,check_refs:refs,asset_ids:anchors}
 await assert.rejects(h.run({op:'record_fact',facts:[fact,fact,fact]}),/264 edges; maximum 256; split/)
 const large={summary:'s'.repeat(2000),detail:'d'.repeat(8000),evidence:'e'.repeat(2000),confidence:'observed',evidence_refs:refs.slice(0,4),asset_ids:[anchors[0]]}
 await assert.rejects(h.run({op:'record_fact',facts:Array(8).fill(large)}),/exploration event has .* maximum 200000; split/)
 assert.equal(reads,0);assert.deepEqual(await readFile(join(data.dir,'basic_law_index/events.jsonl')),before)
})
test('aggregate edge and payload capacities include the entire serialized event',()=>{
 const changes={nodes:[],edges:Array(256).fill({id:'e',from:'a',to:'b',relation:'yields'}),updates:[],round:false,completed:false}
 assert.doesNotThrow(()=>assertExplorationCapacity({changes}))
 assert.throws(()=>assertExplorationCapacity({changes:{...changes,edges:[...changes.edges,changes.edges[0]]}}),/257 edges/)
 const row={changes:{...changes,edges:[]},padding:''};row.padding='x'.repeat(200000-JSON.stringify(row).length)
 assert.doesNotThrow(()=>assertExplorationCapacity(row))
 assert.throws(()=>assertExplorationCapacity({...row,padding:row.padding+'x'}),/200001 characters/)
})

test('semantic append and recovery reject missing and foreign endpoints at the valid prefix',async t=>{
 const h=await setup(t),old=await h.observe();h.access=await h.store.revise(h.access,{newRun:true});await h.start()
 const data=h.store.openTask(h.access),intent=explorationState(data).currentIntent!,base={requestId:'bad',expectedVersion:data.events.length,command:{op:'add_hint',text:'hint'},changes:{nodes:[],edges:[],updates:[],round:false,completed:false},result:{},run:h.access.run}
 const path=join(data.dir,'basic_law_index/events.jsonl'),before=await readFile(path)
 for(const endpoint of ['asset-missing',old,'missing-node'])for(const reverse of [false,true]){
  const payload={...base,changes:{...base.changes,edges:[{id:'edge-bad',from:reverse?endpoint:intent.id,to:reverse?intent.id:endpoint,relation:'observed_on'}]}}
  await assert.rejects(h.store.append(h.access,'exploration',payload),/endpoint/)
 }
 assert.deepEqual(await readFile(path),before)
 const {createHash}=await import('node:crypto'),last=data.events.at(-1)!
 const unsigned={schemaVersion:2,seq:last.seq+1,prev:last.hash,type:'exploration',data:{...base,changes:{...base.changes,edges:[{id:'bad',from:intent.id,to:'asset-missing',relation:'yields'}]}}}
 const bytes=Buffer.concat([before,Buffer.from(JSON.stringify({...unsigned,hash:createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')})+'\n')]);await writeFile(path,bytes);await h.store.close()
 const restored=new TaskStore(h.root,{name:'test',home:join(h.root,'home')},1000);t.after(()=>restored.close())
 const recovered=restored.openTask(await restored.forSession('owner'))
 assert.equal(recovered.events.length,last.seq);assert.equal(recovered.unhealthy,true);assert.match(recovered.storageIssue!,/seq=/)
 assert.deepEqual(await readFile(path),bytes)
})

test('origin is separately addressable and fact counts agree before and after recording',async t=>{
 const h=await setup(t),overview=await h.store.queryExploration(h.access,{op:'graph_overview'}) as any
 const facts=await h.store.queryExploration(h.access,{op:'list_facts'}) as any
 assert.equal(overview.value.facts_total,0);assert.equal(facts.value.total,0)
 assert.equal((JSON.parse((await h.store.detail(h.access,overview.value.originRef,0,8000) as any).text)).state,'origin')
 await h.start();await h.run({op:'record_fact',summary:'Potential method',confidence:'inferred'})
 assert.equal((await h.store.queryExploration(h.access,{op:'list_facts'}) as any).value.total,1)
 assert.equal((await h.store.queryExploration(h.access,{op:'graph_overview'}) as any).value.facts_total,1)
})
test('truncated semantic query preserves context and supplies a complete projection-bound continuation',async t=>{
 const h=await setup(t);await h.start()
 const r=await h.run({op:'record_fact',summary:'Summary retained',detail:'中文😀'.repeat(1200),confidence:'inferred'}),id=(r.ids as string[])[0]
 const query=await h.store.queryExploration(h.access,{op:'node_detail',id},1200) as any
 assert.equal(query.value.truncated,true);assert.equal(query.value.data.confidence,'inferred');assert.equal(query.value.data.summary,'Summary retained')
 assert.equal(query.value.relationCount,1);assert.equal(query.value.relations[0].relation,'yields')
 let text='',offset=query.value.continuation.offset,complete=false
 while(!complete){const part=await h.store.detail(h.access,id,offset,600,query.value.continuation.projectionId) as any;text+=part.text;offset+=part.text.length;complete=part.complete}
 assert.equal(JSON.parse(text).data.detail,'中文😀'.repeat(1200));assert.equal(JSON.parse(text).relations.length,1)
 await h.run({op:'add_hint',text:'Changed input'})
 await assert.rejects(h.store.detail(h.access,id,offset,600,query.value.continuation.projectionId),/changed/)
})
test('all goal readers report the same proof validity and ordinary edges cannot add authority',async t=>{
 const h=await setup(t,['Another goal']);await h.start();const ref=await h.observe(),check=await h.checked(ref),fact=await h.record(ref,check)
 await h.run({op:'finish_intent'});const data=h.store.openTask(h.access),goal=[...explorationState(data).nodes.values()].find(n=>n.kind==='goal')!
 await h.run({op:'prove_goal',goal_id:goal.id,evidence_id:fact,reason:'Observed'})
 for(const expected of ['host_checked','unavailable']){
  const overview=(await h.store.queryExploration(h.access,{op:'graph_overview'}) as any).value.goals.find((n:any)=>n.id===goal.id)
  const detail=(await h.store.queryExploration(h.access,{op:'node_detail',id:goal.id}) as any).value
  const refDetail=JSON.parse((await h.store.detail(h.access,goal.id,0,8000) as any).text)
  for(const value of [overview,detail,refDetail])assert.equal(value.evidenceVerification,expected)
  if(expected==='host_checked'){
   const row=data.events.find(e=>e.data.id===ref)!;await writeFile(join(data.dir,(row.data.data as any).original.path),'changed')
   await h.store.relate(h.access,fact,goal.id,'proves')
  }
 }
})
test('page originals require an explicit Host option and context snapshots never persist originals',async t=>{
 const h=await setup(t),ref=await h.store.asset(h.access,'page',{contextOnly:false,result:'unregistered'})
 await assert.rejects(h.checked(ref),/original snapshot/)
 await assert.rejects(h.store.asset(h.access,'page',{contextOnly:true},'host',{persistOriginal:true}),/ordinary page observation/)
})
