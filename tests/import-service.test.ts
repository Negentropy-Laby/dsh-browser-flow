import {expectList,expectOk,present,expectRecord,expectString,expectSized} from './helpers/assertions.ts'
import { bindTestTask } from './helpers/bind-task.ts'
import assert from 'node:assert/strict'
import { describe,it } from 'node:test'
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserFlowService } from '../src/index.ts'
import { GraphWorkers } from '../src/graph/worker.ts'
import { graphRuntime,graphBinary } from './helpers/graph-process.ts'
import { resolveConfig } from '../src/config.ts'
import { people,scope,workbook,facts } from './import-fixture.ts'

const json=(body:object)=>new Request('http://localhost/api/browser-flow/authorize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion:3,...body})})
async function setup(t:import('node:test').TestContext){
  const root=await mkdtemp(join(tmpdir(),'bf-service-'));const path=join(root,'private-input.xlsx');await writeFile(path,workbook())
  const agent={id:'session-1'};const agents=new Map([[agent.id,agent]])
  const config=resolveConfig({importEvidenceDir:join(root,'private')})
  const graph=new GraphWorkers(config,graphBinary);graph.attach(graphRuntime())
  const service=new BrowserFlowService({agents:{get:id=>agents.get(id)},tools:{register:()=>()=>{}}},config,graph)
  service.start();t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true})})
  const page={lease:'guest',partition:'part',documentToken:'doc',url:'https://fuwu.rsj.beijing.gov.cn/zhrs/yltc/company/information-third-new/imp'}
  service.state.registerConnection({connectionGeneration:1,sessionId:agent.id,panel:{instanceId:'panel',pages:[page]}})
  await bindTestTask(service,agent.id,['https://fuwu.rsj.beijing.gov.cn'],'bjrsj')
  const binding={instanceId:'panel',connectionGeneration:1,sessionId:agent.id,...page}
  const authorized=await(await service.handleAuthorize(json(binding))).json();assert.equal(authorized.ok,true)
  const caller=expectOk(service.resolveCaller({agent}))
  const auth=async (body:object)=>(await service.handleAuthorize(json({...binding,...body}))).json()
  const prepared=await auth({fileOperation:'prepare',path,scope});assert.equal(prepared.ok,true,JSON.stringify(prepared))
  const fileGrantId=prepared.value.fileGrantId
  const evidence=(extra={})=>({unitBodies:[JSON.stringify({map:{data:[{unitDTO:{unitId:scope.unitId,socialCreditCode:scope.legalIdentity}}]}})],unitPending:0,coverage:true,closed:false,expired:false,cleanupFailed:false,fileGrantId:null,facts:{requestCount:0,pending:0,interference:false},...extra})
  async function pageCall(name:string,args:Record<string,unknown>,payload:Record<string,unknown>,beforeGood?:(command:import('../src/state.ts').InFlightRecord['command'],receipt:Record<string,unknown>)=>unknown){
    let ready!:()=>void;const waiting=new Promise<void>(resolve=>{ready=resolve});const original=service.state.run
    service.state.run=(...inputs)=>{const task=original(...inputs);ready();return task}
    try{
      const promise=present(service.tools.get(name)).execute(args,{agent,signal:new AbortController().signal})
      await waiting
      const taken=service.state.takeCommands('panel',1,service.config);assert.equal(expectOk(taken).commands.length,1)
      const command=expectOk(taken).commands[0]
      const result={kind:'result',task:command.task,instanceId:'panel',id:command.id,leaseId:command.leaseId,connectionGeneration:1,epoch:command.epoch,sequence:command.sequence,outcome:'ok',payload}
      if(beforeGood)await beforeGood(command,result)
      const settled=await service.handleResult(json(result));assert.equal(settled.status,200)
      return {result:await promise,command}
    }finally{service.state.run=original}
  }
  return {root,path,service,agent,agents,caller,binding,auth,prepared,fileGrantId,evidence,pageCall}
}

describe('scoped file import through six tools and the existing routes',()=>{
  it('keeps file authorization separate from page authorization and rejects v1 polling',async t=>{
    const env=await setup(t)
    const old=await env.service.handlePoll(json({...env.binding,pages:[],protocolVersion:1}));assert.equal(old.status,400)
    const blocked=await env.service.act(env.caller,{action:'set_file',fileGrantId:env.fileGrantId,documentToken:'doc',elementRef:'el'},new AbortController().signal)
    assert.equal(blocked.ok,false)
    assert.equal(expectOk(env.service.state.takeCommands('panel',1,env.service.config)).commands.length,0)
    assert.equal((await env.auth({fileOperation:'confirm',fileGrantId:'forged'})).ok,false)
    assert.equal((await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})).ok,true)
  })
  it('retains the current command after a foreign receipt and never exposes private facts to the model',async t=>{
    const env=await setup(t)
    const {result}=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence()},async(command:import('../src/state.ts').InFlightRecord['command'],receipt)=>{
      const wrong=await env.service.handleResult(json({...receipt,instanceId:'foreign'}));assert.equal(wrong.status,409)
    })
    assert.equal(expectRecord(expectRecord(expectOk(result)).import).identity,'verified')
    const output=JSON.stringify(result)
    for(const secret of [env.path,scope.legalIdentity,scope.unitId,people[0].certificateNumber,people[0].name] as const)assert.equal(output.includes(secret),false)
  })
  it('delivers one frozen file and confirms only its own complete result',async t=>{
    const env=await setup(t)
    await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})
    await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence()})
    const selected=await env.pageCall('browser_act',{action:'set_file',fileGrantId:env.fileGrantId,documentToken:'doc',elementRef:'el'},{action:'set_file',dispatched:true,fileGrantId:env.fileGrantId})
    assert.equal(expectRecord(selected.command.op.file).sha256,env.prepared.value.sha256)
    assert.equal(expectRecord(selected.command.op.file).base64,(await readFile(env.path)).toString('base64'))
    const again=await env.service.act(env.caller,{action:'set_file',fileGrantId:env.fileGrantId,documentToken:'doc',elementRef:'el'},new AbortController().signal);assert.equal(again.ok,false)
    const observed=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence({fileGrantId:env.fileGrantId,closed:true,facts:facts()})})
    assert.equal(expectRecord(expectRecord(expectOk(observed.result)).import).verdict,'import_confirmed');assert.equal(expectRecord(expectRecord(expectOk(observed.result)).import).qualified,true)
    const released=env.service.release(env.caller);assert.equal(expectOk(released).pageRetained,true)
    assert.equal((await env.service.observe(env.caller,new AbortController().signal,'bjrsj_import')).ok,false)
    assert.equal(env.service.importFiles.entries.size,0)
  })
  it('separates business confirmation from failed cleanup',async t=>{
    const env=await setup(t)
    await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})
    await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence()})
    await env.pageCall('browser_act',{action:'set_file',fileGrantId:env.fileGrantId,documentToken:'doc',elementRef:'el'},{action:'set_file',dispatched:true,fileGrantId:env.fileGrantId})
    const observed=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence({fileGrantId:env.fileGrantId,closed:true,cleanupFailed:true,facts:facts()})})
    assert.equal(expectRecord(expectRecord(expectOk(observed.result)).import).verdict,'unknown')
    assert.equal(expectRecord(expectRecord(expectRecord(expectOk(observed.result)).import).businessJudgment).verdict,'import_confirmed')
    assert.equal(expectRecord(expectRecord(expectOk(observed.result)).import).cleanupStatus,'failed')
  })
  it('cannot qualify while another unit identity response is pending',async t=>{
    const env=await setup(t)
    await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})
    await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence()})
    await env.pageCall('browser_act',{action:'set_file',fileGrantId:env.fileGrantId,documentToken:'doc',elementRef:'el'},{action:'set_file',dispatched:true,fileGrantId:env.fileGrantId})
    const observed=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence({fileGrantId:env.fileGrantId,unitPending:1,closed:true,facts:facts()})})
    assert.notEqual(expectRecord(expectRecord(expectOk(observed.result)).import).verdict,'import_confirmed')
    assert.equal(expectRecord(expectRecord(expectOk(observed.result)).import).qualified,false)
  })
  it('cannot confirm a valid-looking result before a file was selected',async t=>{
    const env=await setup(t)
    const observed=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence({fileGrantId:env.fileGrantId,closed:true,facts:facts()})})
    assert.notEqual(expectRecord(expectRecord(expectOk(observed.result)).import).verdict,'import_confirmed')
    assert.equal(expectRecord(expectRecord(expectOk(observed.result)).import).qualified,false)
  })
  it('refuses an observation when its Agent changes during private evidence recording',async t=>{
    const env=await setup(t)
    let entered!:()=>void,resume!:()=>void;const barrier=new Promise<void>(resolve=>{entered=resolve});const gate=new Promise<void>(resolve=>{resume=resolve})
    const write=env.service.importFiles.write.bind(env.service.importFiles)
    env.service.importFiles.write=async(...args)=>{entered();await gate;return write(...args)}
    const pending=env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence()})
    await barrier;env.agents.set(env.agent.id,{id:env.agent.id});resume()
    assert.equal((await pending).result.ok,false)
  })
  it('records the safe model-facing import transcript',async t=>{
    const env=await setup(t)
    await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})
    const trace:unknown[]=[]
    async function call(name:string,args:Record<string,unknown>,payload:Record<string,unknown>){const {result}=await env.pageCall(name,args,payload);trace.push({tool:name,args,result})}
    await call('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence()})
    await call('browser_act',{action:'set_file',fileGrantId:env.fileGrantId,documentToken:'doc',elementRef:'el'},{action:'set_file',dispatched:true,fileGrantId:env.fileGrantId})
    await call('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence({fileGrantId:env.fileGrantId,closed:true,facts:facts()})})
    const run=present(env.service.tasks.current(env.agent.id)).run
    const actual=JSON.stringify(trace,null,2).replaceAll(env.fileGrantId,'FILE_GRANT').replaceAll(run.profileId,'PROFILE').replaceAll(run.taskId,'TASK').replaceAll(run.runId,'RUN')+'\n'
    assert.equal(actual,await readFile(new URL('./expected/bjrsj-import.json',import.meta.url),'utf8'))
    const view=await env.service.observe(env.caller,new AbortController().signal,'task')
    assert.equal(expectRecord(expectOk(view)).businessVerdict,'import_confirmed')
    const criteria=expectRecord(expectRecord(expectOk(view)).procedural_law_index).criteria??JSON.parse(expectString(expectRecord(expectOk((await env.service.observe(env.caller,new AbortController().signal,'task',{ref:'criteria',offset:0})))).text))
    const proved=expectList(criteria).map(expectRecord).find(row=>row.source==='code_verified')
    assert.equal(present(proved).status,'passed')
    const graph=expectRecord(expectRecord(expectOk(view)).knowledge_graph).edges?expectRecord(expectOk(view)).knowledge_graph:JSON.parse(expectString(expectRecord(expectOk((await env.service.observe(env.caller,new AbortController().signal,'task',{ref:'graph',offset:0})))).text))
    assert.ok(expectList(expectRecord(graph).edges).map(expectRecord).some(edge=>edge.relation==='proves'&&edge.to===present(proved).id))
    const entry=env.service.importFiles.current(expectOk(env.service.leaseOf(env.caller)))
    await writeFile(present(entry).snapshot,'changed synthetic snapshot')
    const invalid=await env.service.observe(env.caller,new AbortController().signal,'task')
    assert.equal(expectRecord(expectOk(invalid)).businessVerdict,'unverified')
    assert.ok(expectSized(expectRecord(expectRecord(expectOk(invalid)).active_context).evidenceIssues).length>0)
  })
  it('requires a fresh real file confirmation to resolve the matching Agent dependency',async t=>{
    const env=await setup(t),access=env.service.tasks.current(env.agent.id)
    const result=await present(env.service.tools.get('browser_act')).execute({action:'await_user',wait:{kind:'file_confirmation',reason:'The user must confirm this file',resumeCondition:'Confirm the current prepared snapshot'}},{agent:env.agent,signal:new AbortController().signal})
    assert.equal(result.ok,true)
    const resume=()=>env.auth({taskOperation:'resume',lease:undefined,partition:undefined,documentToken:undefined,waitId:expectRecord(expectRecord(result.value).wait).id,task:present(access).scope})
    assert.equal((await resume()).error.code,'awaiting_user')
    assert.equal((await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})).ok,true)
    assert.equal((await resume()).ok,true)
    assert.equal(expectRecord(expectOk((await env.service.observe(env.caller,new AbortController().signal,'task')))).businessVerdict,'unverified')
  })
  it('refuses changed identity, malformed private evidence and replaced Agents',async t=>{
    const env=await setup(t)
    const malformed=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:{unitBodies:[]}})
    assert.equal(malformed.result.ok,false)
    const bad=env.evidence();bad.unitBodies=[JSON.stringify({map:{data:[{unitDTO:{unitId:'OTHER',socialCreditCode:scope.legalIdentity}}]}})]
    const mismatch=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:bad})
    assert.equal(expectRecord(expectRecord(expectOk(mismatch.result)).import).identity,'mismatch')
    env.agents.set(env.agent.id,{id:env.agent.id})
    assert.equal((await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})).ok,false)
  })
})
