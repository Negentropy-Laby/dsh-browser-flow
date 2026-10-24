import {nativeToolPump} from './helpers/native-tool-pump.ts'
import {expectOk,expectRecord,expectNumber,present,expectSized,expectList,expectString} from './helpers/assertions.ts'
import {attachInspector} from './helpers/inspector.ts'
/** Target-Electron primitive qualification. Requires an already launched owned Desktop; never contacts the real portal. */
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {BrowserFlowService} from '../src/index.ts'
import {resolveConfig} from '../src/config.ts'
import {identityProgram,findProgram,actProgram} from '../src/pagecode.ts'
import {importProgram} from '../src/import-page.ts'
import {workbook,scope,people} from './import-fixture.ts'

const [specFile,output]=process.argv.slice(2)
if(!specFile||!output)throw new Error('usage: node --import tsx/esm tests/import-desktop-fixture.ts <owned-desktop-start.json> <new-receipt.json>')
const spec=JSON.parse(await readFile(specFile,'utf8'));const port=Number(spec.env.DSH_DESKTOP_MAIN_INSPECT_PORT)
const inspector=await attachInspector(port)
const evaluate=inspector.evaluate
const requireElectron="process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
const programs:Record<string,string>=JSON.parse(await readFile(new URL('../.cache/fixtures/programs.json',import.meta.url),'utf8'))
const mainProgram=(name:string,...args:unknown[])=>`(${programs[name]})(${requireElectron},${args.map(value=>JSON.stringify(value)).join(',')})`
const pageProgram=(name:string)=>`(${programs[name]})()`
const identity=expectRecord(await evaluate(mainProgram('desktopIdentity')))
assert.equal(resolve(expectString(identity.appPath)).toLowerCase(),resolve(spec.cwd,'apps','desktop').toLowerCase(),'owned target Desktop')
const html=await readFile(new URL('../.cache/fixtures/bjrsj-import.html',import.meta.url),'utf8')
const root=await mkdtemp(join(resolve('.cache'),'native-import-'));const file=join(root,'input.xlsx');const bytes=workbook();await writeFile(file,bytes,{flag:'wx'})
const tasksDir=join(root,'tasks');await mkdir(join(tasksDir,'synthetic'),{recursive:true});await writeFile(join(tasksDir,'synthetic','steps.md'),'Synthetic fixture only; stop at the strict verifier result. No final submission.\n');await writeFile(join(tasksDir,'synthetic','definition.json'),JSON.stringify({schemaVersion:1,id:'synthetic',version:'1',adapter:'bjrsj',adapterVersion:1,origins:['https://fuwu.rsj.beijing.gov.cn'],resources:['steps.md'],workflows:[{id:'import',skill:'synthetic-import',description:'Synthetic native verification',instructions:['steps.md'],resources:[],stopBoundary:'import_confirmed'}]}));
const sha256=createHash('sha256').update(bytes).digest('hex')
const receipt:{recordedAt:string;appVersion:unknown;mainPid:unknown;electron:unknown;node:unknown;chrome:unknown;surface:string;cases:Record<string,unknown>[];passed?:boolean;failure?:string}={recordedAt:new Date().toISOString(),appVersion:identity.appVersion,mainPid:identity.pid,electron:expectRecord(identity.versions).electron,node:expectRecord(identity.versions).node,chrome:expectRecord(identity.versions).chrome,surface:'isolated synthetic BrowserWindow in owned Desktop; service-driven six-tool fixture; not a normal Agent turn or real portal',cases:[]}
let fixtureId:number|undefined
async function page(source:string){return evaluate(mainProgram('executeFixturePage',fixtureId,source))}
try {
  for(const [kind,transport,mode,expected] of [['add','xhr','success','import_confirmed'],['modify','fetch','success','import_confirmed'],['reduce','xhr','row-failure','rejected'],['add','xhr','old-summary','unknown'],['add','xhr','stale-tables','unknown'],['add','xhr','double-request','unknown'],['add','xhr','wrong-tab','not_selected'],['modify','fetch','redirect','unknown'],['add','fetch','oversized','unknown'],['add','xhr','revoked','not_selected'],['add','xhr','idle-timeout','not_selected']] as const){
    const token=randomUUID();const requestKey='__bfFixture_'+token.replaceAll('-','')
    fixtureId=expectNumber(await evaluate(mainProgram('createImportFixture',{token,requestKey,mode,html,people,kind,transport})))
    const agent={id:'fixture-'+token};const service=new BrowserFlowService({profileContext:{name:'fixture',home:join(root,'profile')},agents:{get:id=>id===agent.id?agent:undefined},tools:{register:()=>()=>{}}},resolveConfig({localTasksDir:tasksDir,importWindowMs:expected==='unknown'||mode==='idle-timeout'?500:10000}))
    service.start()
    try {
      const doc=expectString(expectRecord(expectRecord((await page(identityProgram()))).value).documentToken)
      const panelPage={lease:'guest',partition:'fixture',documentToken:doc,url:'https://fuwu.rsj.beijing.gov.cn/fixture'}
      service.state.registerConnection({connectionGeneration:1,sessionId:agent.id,panel:{instanceId:'panel',pages:[panelPage]}})
      await service.tasks.create(agent.id,{definitionId:'synthetic',workflowRef:'import',goal:'Synthetic native case '+kind+' '+transport+' '+mode})
      const binding={instanceId:'panel',connectionGeneration:1,sessionId:agent.id,...panelPage}
      const post=async (body:object)=>(await service.handleAuthorize(new Request('http://localhost/api/browser-flow/authorize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion:4,...binding,...body})}))).json()
      assert.equal((await post({})).ok,true)
      const preview=await post({fileOperation:'prepare',path:file,scope:{...scope,kind}});assert.equal(preview.ok,true,JSON.stringify(preview))
      assert.equal((await post({fileOperation:'confirm',fileGrantId:preview.value.fileGrantId})).ok,true)
      const caller=expectOk(service.resolveCaller({agent}))
      const importOwner=service.importMetadata(expectOk(service.leaseOf(caller))).importOwner
      const tool=nativeToolPump(service,agent,page)
      await tool('browser_observe',{view:'bjrsj_import'})
      assert.equal(expectSized((await evaluate(mainProgram('fixtureRequests',fixtureId,requestKey)))).length,0,'passive installation must not initiate a request')
      const unit=await tool('browser_find',{by:'text',value:'单位信息变更'});assert.equal(unit.ok,true)
      assert.equal((await tool('browser_act',{action:'click',documentToken:expectRecord(unit.value).documentToken,elementRef:expectRecord(expectRecord(unit.value).match).elementRef})).ok,true)
      const deadline=Date.now()+15000;let observed
      do{observed=await tool('browser_observe',{view:'bjrsj_import'});assert.equal(observed.ok,true,JSON.stringify(observed));if(Date.now()>deadline)throw new Error('unit observation never became verified')}while(expectRecord(expectRecord(observed.value).import).identity!=='verified')
      const upload=await tool('browser_find',{by:'text',value:'上传申报信息'});assert.equal(upload.ok,true)
      if(mode==='idle-timeout'){do{observed=await tool('browser_observe',{view:'bjrsj_import'});if(Date.now()>deadline)throw new Error('idle observer never closed')}while(expectRecord(expectRecord(expectOk(observed)).import).cleanupStatus==='pending')}
      if(mode==='revoked')assert.equal(expectOk(service.release(caller)).pageRetained,true)
      const selected=await tool('browser_act',{action:'set_file',fileGrantId:preview.value.fileGrantId,documentToken:expectRecord(upload.value).documentToken,elementRef:expectRecord(expectRecord(upload.value).match).elementRef})
      let verdict='not_selected'
      if(expected!=='not_selected'){
        assert.equal(selected.ok,true,JSON.stringify(selected))
        do{observed=await tool('browser_observe',{view:'bjrsj_import'});assert.equal(observed.ok,true,JSON.stringify(observed));if(Date.now()>deadline)throw new Error('native import never settled')}while(expectRecord(expectRecord(observed.value).import).verdict==='not_dispatched'||expectRecord(expectRecord(observed.value).import).cleanupStatus==='pending')
        verdict=expectString(expectRecord(expectRecord(observed.value).import).verdict)
      }else assert.equal(selected.ok,false)
      assert.equal(verdict,expected,JSON.stringify(observed))
      if(mode!=='revoked'){const submit=await tool('browser_find',{by:'text',value:'提交'});assert.equal(submit.ok,true)
      assert.equal((await tool('browser_act',{action:'click',documentToken:expectRecord(submit.value).documentToken,elementRef:expectRecord(expectRecord(submit.value).match).elementRef})).ok,false)}
      const duplicate=await service.act(caller,{action:'set_file',fileGrantId:preview.value.fileGrantId,documentToken:doc,elementRef:'none'},new AbortController().signal);assert.equal(duplicate.ok,false)
      const browser=await page(pageProgram('fixtureState'))
      const calls=await evaluate(mainProgram('fixtureRequests',fixtureId,requestKey))
      const network=expectList(calls).map(expectRecord).filter(request=>request.type==='check');assert.equal(expectList(calls).map(expectRecord).filter(request=>request.type==='unit').length,1)
      assert.equal(expectRecord(expectRecord(browser).fixture).changeEvents,expected==='not_selected'?0:1);assert.equal(expectRecord(expectRecord(browser).fixture).submitClicks,0)
      assert.equal(network.length,expected==='not_selected'?0:mode==='double-request'?2:1)
      for(const request of network){assert.equal(expectRecord(request).bytes,bytes.length);assert.equal(expectRecord(request).sha256,sha256)}
      if(mode!=='revoked')assert.equal(expectOk(service.release(caller)).pageRetained,true)
      assert.equal((await service.observe(caller,new AbortController().signal,'bjrsj_import')).ok,false)
      const response=await page(pageProgram('fixtureResponse'));
      const cleanup=await page(importProgram({mode:'dispose',owner:importOwner}))
      const restored=await page(pageProgram('fixtureRestored'));assert.equal(restored,true)
      if(mode==='redirect'){assert.equal(new URL(expectString(expectRecord(response).url)).origin,'https://redirect-fixture.invalid');assert.equal(expectRecord(response).status,200)}
      receipt.cases.push({kind,transport,mode,verdict,inputEvents:expectRecord(expectRecord(browser).fixture).inputEvents,changeEvents:expectRecord(expectRecord(browser).fixture).changeEvents,submitClicks:expectRecord(expectRecord(browser).fixture).submitClicks,requests:network.length,...(response?{responseOrigin:new URL(expectString(expectRecord(response).url)).origin,responseStatus:expectRecord(response).status}:{}),fileSha256:sha256,cleanupFailed:expectRecord(expectRecord(cleanup).value).cleanupFailed,pageRetained:true})
      process.stdout.write(JSON.stringify(receipt.cases.at(-1))+'\n')
    }finally{await service.close();await evaluate(mainProgram('destroyFixture',fixtureId));fixtureId=undefined}
  }
  receipt.passed=true
  await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})
}catch(error){receipt.passed=false;receipt.failure=String(expectRecord(error).message).slice(0,500);await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});throw error}
finally{if(fixtureId)await evaluate(mainProgram('destroyFixture',fixtureId));inspector.close()}
