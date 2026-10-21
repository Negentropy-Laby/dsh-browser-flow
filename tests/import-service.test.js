import { bindTestTask } from './helpers/bind-task.js'
import assert from 'node:assert/strict'
import { describe,it } from 'node:test'
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserFlowService } from '../src/index.js'
import { resolveConfig } from '../src/config.js'
import { people,scope,workbook,facts } from './import-fixture.js'

const json=body=>new Request('http://localhost/api/browser-flow/authorize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion:3,...body})})
async function setup(t){
  const root=await mkdtemp(join(tmpdir(),'bf-service-'));const path=join(root,'private-input.xlsx');await writeFile(path,workbook())
  const agent={id:'session-1'};const agents=new Map([[agent.id,agent]])
  const service=new BrowserFlowService({agents:{get:id=>agents.get(id)},tools:{register:()=>()=>{}}},resolveConfig({importEvidenceDir:join(root,'private')}))
  service.start();t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true})})
  const page={lease:'guest',partition:'part',documentToken:'doc',url:'https://fuwu.rsj.beijing.gov.cn/zhrs/yltc/company/information-third-new/imp'}
  service.state.registerConnection({connectionGeneration:1,sessionId:agent.id,panel:{instanceId:'panel',pages:[page]}})
  await bindTestTask(service,agent.id,['https://fuwu.rsj.beijing.gov.cn'],'bjrsj')
  const binding={instanceId:'panel',connectionGeneration:1,sessionId:agent.id,...page}
  const authorized=await(await service.handleAuthorize(json(binding))).json();assert.equal(authorized.ok,true)
  const caller=service.resolveCaller({agent}).value
  const auth=async body=>(await service.handleAuthorize(json({...binding,...body}))).json()
  const prepared=await auth({fileOperation:'prepare',path,scope});assert.equal(prepared.ok,true,JSON.stringify(prepared))
  const fileGrantId=prepared.value.fileGrantId
  const evidence=(extra={})=>({unitBodies:[JSON.stringify({map:{data:[{unitDTO:{unitId:scope.unitId,socialCreditCode:scope.legalIdentity}}]}})],unitPending:0,coverage:true,closed:false,expired:false,cleanupFailed:false,fileGrantId:null,facts:{requestCount:0,pending:0,interference:false},...extra})
  async function pageCall(name,args,payload,beforeGood){
    let ready;const waiting=new Promise(resolve=>{ready=resolve});const original=service.state.run
    service.state.run=(...inputs)=>{const task=original(...inputs);ready();return task}
    try{
      const promise=service.tools.get(name).execute(args,{agent,signal:new AbortController().signal})
      await waiting
      const taken=service.state.takeCommands('panel',1,service.config);assert.equal(taken.value.commands.length,1)
      const command=taken.value.commands[0]
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
    assert.equal(env.service.state.takeCommands('panel',1,env.service.config).value.commands.length,0)
    assert.equal((await env.auth({fileOperation:'confirm',fileGrantId:'forged'})).ok,false)
    assert.equal((await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})).ok,true)
  })
  it('retains the current command after a foreign receipt and never exposes private facts to the model',async t=>{
    const env=await setup(t)
    const {result}=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence()},async(command,receipt)=>{
      const wrong=await env.service.handleResult(json({...receipt,instanceId:'foreign'}));assert.equal(wrong.status,409)
    })
    assert.equal(result.value.import.identity,'verified')
    const output=JSON.stringify(result)
    for(const secret of [env.path,scope.legalIdentity,scope.unitId,people[0].certificateNumber,people[0].name])assert.equal(output.includes(secret),false)
  })
  it('delivers one frozen file and confirms only its own complete result',async t=>{
    const env=await setup(t)
    await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})
    await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence()})
    const selected=await env.pageCall('browser_act',{action:'set_file',fileGrantId:env.fileGrantId,documentToken:'doc',elementRef:'el'},{action:'set_file',dispatched:true,fileGrantId:env.fileGrantId})
    assert.equal(selected.command.op.file.sha256,env.prepared.value.sha256)
    assert.equal(selected.command.op.file.base64,(await readFile(env.path)).toString('base64'))
    const again=await env.service.act(env.caller,{action:'set_file',fileGrantId:env.fileGrantId,documentToken:'doc',elementRef:'el'},new AbortController().signal);assert.equal(again.ok,false)
    const observed=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence({fileGrantId:env.fileGrantId,closed:true,facts:facts()})})
    assert.equal(observed.result.value.import.verdict,'import_confirmed');assert.equal(observed.result.value.import.qualified,true)
    const released=env.service.release(env.caller);assert.equal(released.value.pageRetained,true)
    assert.equal((await env.service.observe(env.caller,new AbortController().signal,'bjrsj_import')).ok,false)
    assert.equal(env.service.importFiles.entries.size,0)
  })
  it('separates business confirmation from failed cleanup',async t=>{
    const env=await setup(t)
    await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})
    await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence()})
    await env.pageCall('browser_act',{action:'set_file',fileGrantId:env.fileGrantId,documentToken:'doc',elementRef:'el'},{action:'set_file',dispatched:true,fileGrantId:env.fileGrantId})
    const observed=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence({fileGrantId:env.fileGrantId,closed:true,cleanupFailed:true,facts:facts()})})
    assert.equal(observed.result.value.import.verdict,'unknown')
    assert.equal(observed.result.value.import.businessJudgment.verdict,'import_confirmed')
    assert.equal(observed.result.value.import.cleanupStatus,'failed')
  })
  it('cannot qualify while another unit identity response is pending',async t=>{
    const env=await setup(t)
    await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})
    await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence()})
    await env.pageCall('browser_act',{action:'set_file',fileGrantId:env.fileGrantId,documentToken:'doc',elementRef:'el'},{action:'set_file',dispatched:true,fileGrantId:env.fileGrantId})
    const observed=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence({fileGrantId:env.fileGrantId,unitPending:1,closed:true,facts:facts()})})
    assert.notEqual(observed.result.value.import.verdict,'import_confirmed')
    assert.equal(observed.result.value.import.qualified,false)
  })
  it('cannot confirm a valid-looking result before a file was selected',async t=>{
    const env=await setup(t)
    const observed=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence({fileGrantId:env.fileGrantId,closed:true,facts:facts()})})
    assert.notEqual(observed.result.value.import.verdict,'import_confirmed')
    assert.equal(observed.result.value.import.qualified,false)
  })
  it('refuses an observation when its Agent changes during private evidence recording',async t=>{
    const env=await setup(t)
    let entered,resume;const barrier=new Promise(resolve=>{entered=resolve});const gate=new Promise(resolve=>{resume=resolve})
    const write=env.service.importFiles.write.bind(env.service.importFiles)
    env.service.importFiles.write=async(...args)=>{entered();await gate;return write(...args)}
    const pending=env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence()})
    await barrier;env.agents.set(env.agent.id,{id:env.agent.id});resume()
    assert.equal((await pending).result.ok,false)
  })
  it('records the safe model-facing import transcript',async t=>{
    const env=await setup(t)
    await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})
    const trace=[]
    async function call(name,args,payload){const {result}=await env.pageCall(name,args,payload);trace.push({tool:name,args,result})}
    await call('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence()})
    await call('browser_act',{action:'set_file',fileGrantId:env.fileGrantId,documentToken:'doc',elementRef:'el'},{action:'set_file',dispatched:true,fileGrantId:env.fileGrantId})
    await call('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:env.evidence({fileGrantId:env.fileGrantId,closed:true,facts:facts()})})
    const run=env.service.tasks.current(env.agent.id).run
    const actual=JSON.stringify(trace,null,2).replaceAll(env.fileGrantId,'FILE_GRANT').replaceAll(run.profileId,'PROFILE').replaceAll(run.taskId,'TASK').replaceAll(run.runId,'RUN')+'\n'
    assert.equal(actual,await readFile(new URL('./expected/bjrsj-import.json',import.meta.url),'utf8'))
    const view=await env.service.observe(env.caller,new AbortController().signal,'task')
    assert.equal(view.value.businessVerdict,'import_confirmed')
    const criteria=view.value.procedural_law_index.criteria??JSON.parse((await env.service.observe(env.caller,new AbortController().signal,'task',{ref:'criteria',offset:0})).value.text)
    const proved=criteria.find(row=>row.source==='code_verified')
    assert.equal(proved.status,'passed')
    const graph=view.value.knowledge_graph.edges?view.value.knowledge_graph:JSON.parse((await env.service.observe(env.caller,new AbortController().signal,'task',{ref:'graph',offset:0})).value.text)
    assert.ok(graph.edges.some(edge=>edge.relation==='proves'&&edge.to===proved.id))
    const entry=env.service.importFiles.current(env.service.leaseOf(env.caller).value)
    await writeFile(entry.snapshot,'changed synthetic snapshot')
    const invalid=await env.service.observe(env.caller,new AbortController().signal,'task')
    assert.equal(invalid.value.businessVerdict,'unverified')
    assert.ok(invalid.value.active_context.evidenceIssues.length>0)
  })
  it('requires a fresh real file confirmation to resolve the matching Agent dependency',async t=>{
    const env=await setup(t),access=env.service.tasks.current(env.agent.id)
    const result=await env.service.tools.get('browser_act').execute({action:'await_user',wait:{kind:'file_confirmation',reason:'The user must confirm this file',resumeCondition:'Confirm the current prepared snapshot'}},{agent:env.agent,signal:new AbortController().signal})
    assert.equal(result.ok,true)
    const resume=()=>env.auth({taskOperation:'resume',lease:undefined,partition:undefined,documentToken:undefined,waitId:result.value.wait.id,task:access.scope})
    assert.equal((await resume()).error.code,'awaiting_user')
    assert.equal((await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})).ok,true)
    assert.equal((await resume()).ok,true)
    assert.equal((await env.service.observe(env.caller,new AbortController().signal,'task')).value.businessVerdict,'unverified')
  })
  it('refuses changed identity, malformed private evidence and replaced Agents',async t=>{
    const env=await setup(t)
    const malformed=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:{unitBodies:[]}})
    assert.equal(malformed.result.ok,false)
    const bad=env.evidence();bad.unitBodies=[JSON.stringify({map:{data:[{unitDTO:{unitId:'OTHER',socialCreditCode:scope.legalIdentity}}]}})]
    const mismatch=await env.pageCall('browser_observe',{view:'bjrsj_import'},{documentToken:'doc',privateImport:bad})
    assert.equal(mismatch.result.value.import.identity,'mismatch')
    env.agents.set(env.agent.id,{id:env.agent.id})
    assert.equal((await env.auth({fileOperation:'confirm',fileGrantId:env.fileGrantId})).ok,false)
  })
})
