import assert from 'node:assert/strict'
import {it} from 'node:test'
import {writeFile,open,type FileHandle} from 'node:fs/promises'
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

function barrier(){let release=()=>{},entered=()=>{};const gate=new Promise<void>(r=>{release=r}),ready=new Promise<void>(r=>{entered=r});return {release,entered,gate,ready}}
it('rejects a raw detail if an append commits during evidence I/O',async t=>{
 const env=await navigation(t),store=env.service.tasks,access=present(env.access),id=await store.asset(access,'page',{marker:'original'}),hold=barrier(),read=store.readArtifact.bind(store);let first=true
 store.readArtifact=async(...args)=>{const bytes=await read(...args);if(first){first=false;hold.entered();await hold.gate}return bytes}
 const reading=store.detail(access,id,0,8000),rejected=assert.rejects(reading,{code:'task_busy'})
 try{await hold.ready;await store.asset(access,'page',{marker:'appended'});hold.release();await rejected}finally{hold.release()}
})
for(const operation of ['append','revise'] as const)it(`rejects a raw detail when ${operation} commits after the inner evidence guard`,async t=>{
 const env=await navigation(t),store=env.service.tasks,access=present(env.access),data=store.openTask(access),id=await store.asset(access,'page',{marker:'original'}),version=data.events.length,hold=barrier()
 const proof=expectRecord(present(data.events.find(event=>event.type==='asset'&&event.data.kind==='evidence')).data.data),sample=await open(join(data.dir,expectString(proof.artifact)),'r')
 const prototype=Object.getPrototypeOf(sample) as FileHandle;await sample.close()
 const write=prototype.writeFile,sync=prototype.sync,read=store.readArtifact.bind(store),ownedOpen=store.openTask.bind(store);let writeFd=-2,reads=0;const versions:number[]=[]
 t.mock.method(prototype,'writeFile',function(this:FileHandle,...args:Parameters<FileHandle['writeFile']>){
  if(Buffer.isBuffer(args[0])&&args[0].includes(Buffer.from('late-snapshot-append')))writeFd=this.fd
  return Reflect.apply(write,this,args)
 })
 t.mock.method(prototype,'sync',async function(this:FileHandle){
  await sync.call(this)
  if(this.fd===writeFd){
   writeFd=-2;const close=this.close.bind(this)
   t.mock.method(this,'close',async()=>{await close();hold.entered();await hold.gate})
  }
 })
 const writing=operation==='append'?store.asset(access,'page',{marker:'late-snapshot-append'}):store.revise(access,{goal:'late-snapshot-append'})
 void writing.catch(()=>{});t.after(async()=>{hold.release();await writing})
 try{
  await hold.ready
  store.openTask=(...args)=>{const value=ownedOpen(...args);if(reads===2)versions.push(value.events.length);return value}
  store.readArtifact=async(...args)=>{const bytes=await read(...args);if(++reads===2)hold.release();return bytes}
  const result=await store.detail(access,id,0,8000).then(value=>({value,error:undefined}),error=>({value:undefined,error}))
  await writing
  assert.equal(versions[0],version,'the inner guard must see the original journal')
  assert.equal(data.events.length,version+1,'the actual synchronized append must commit')
  if(operation==='append')assert.equal(versions.at(-1),version+1,'the outer continuation must observe the race')
  assert.equal(result.value,undefined)
  assert.equal(expectRecord(result.error).code,operation==='append'?'task_busy':'task_not_bound')
 }finally{hold.release();await writing}
})
it('returns a consistent old detail when the append happens after the reply',async t=>{
 const env=await navigation(t),store=env.service.tasks,access=present(env.access),id=await store.asset(access,'page',{marker:'original'}),version=store.openTask(access).events.length
 const result=expectRecord(await store.detail(access,id,0,8000))
 await store.asset(access,'page',{marker:'later'})
 assert.equal(result.contextVersion,version);assert.equal(store.openTask(access).events.length,version+1)
 assert.equal(expectRecord(expectRecord(JSON.parse(expectString(result.text))).data).marker,'original')
})
