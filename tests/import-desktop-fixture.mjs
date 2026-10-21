/** Target-Electron primitive qualification. Requires an already launched owned Desktop; never contacts the real portal. */
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {BrowserFlowService} from '../src/index.ts'
import {resolveConfig} from '../src/config.ts'
import {programFor} from '../src/clientcore.js'
import {PAGE_CODE} from '../src/panel.js'
import {identityProgram,findProgram,actProgram} from '../src/pagecode.js'
import {importProgram} from '../src/import-page.js'
import {workbook,scope,people} from './import-fixture.js'

const [specFile,output]=process.argv.slice(2)
if(!specFile||!output)throw new Error('usage: node tests/import-desktop-fixture.mjs <owned-desktop-start.json> <new-receipt.json>')
const spec=JSON.parse(await readFile(specFile,'utf8'));const port=Number(spec.env.DSH_DESKTOP_MAIN_INSPECT_PORT)
const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(5000)})).json()
const ws=new WebSocket(targets.find(target=>target.type==='node').webSocketDebuggerUrl)
await new Promise((yes,no)=>{ws.addEventListener('open',yes,{once:true});ws.addEventListener('error',no,{once:true})})
let sequence=0;const pending=new Map()
ws.addEventListener('message',event=>{const result=JSON.parse(String(event.data));const p=pending.get(result.id);if(!p)return;pending.delete(result.id);clearTimeout(p.timer);result.error?p.reject(new Error(JSON.stringify(result.error))):p.resolve(result.result)})
function rpc(method,params){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('inspector timeout'))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value}
const requireElectron="process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
const identity=await evaluate(`(()=>{const e=${requireElectron};return {pid:process.pid,versions:process.versions,appPath:e.app.getAppPath(),appVersion:e.app.getVersion()}})()`)
assert.equal(resolve(identity.appPath).toLowerCase(),resolve(spec.cwd,'apps','desktop').toLowerCase(),'owned target Desktop')
const html=await readFile(new URL('../fixtures/bjrsj-import.html',import.meta.url),'utf8')
const root=await mkdtemp(join(resolve('.cache'),'native-import-'));const file=join(root,'input.xlsx');const bytes=workbook();await writeFile(file,bytes,{flag:'wx'})
const tasksDir=join(root,'tasks');await mkdir(join(tasksDir,'synthetic'),{recursive:true});await writeFile(join(tasksDir,'synthetic','steps.md'),'Synthetic fixture only; stop at the strict verifier result. No final submission.\n');await writeFile(join(tasksDir,'synthetic','definition.json'),JSON.stringify({schemaVersion:1,id:'synthetic',version:'1',adapter:'bjrsj',adapterVersion:1,origins:['https://fuwu.rsj.beijing.gov.cn'],resources:['steps.md'],workflows:[{id:'import',skill:'synthetic-import',description:'Synthetic native verification',instructions:['steps.md'],resources:[],stopBoundary:'import_confirmed'}]}));
const sha256=createHash('sha256').update(bytes).digest('hex')
const receipt={recordedAt:new Date().toISOString(),appVersion:identity.appVersion,mainPid:identity.pid,electron:identity.versions.electron,node:identity.versions.node,chrome:identity.versions.chrome,surface:'isolated synthetic BrowserWindow in owned Desktop; service-driven six-tool fixture; not a normal Agent turn or real portal',cases:[]}
let fixtureId
async function page(source){return evaluate(`(async()=>{const e=${requireElectron};const w=e.BrowserWindow.fromId(${fixtureId});if(!w)throw new Error('fixture missing');return w.webContents.executeJavaScript(${JSON.stringify(source)},true)})()`)}
try {
  for(const [kind,transport,mode,expected] of [['add','xhr','success','import_confirmed'],['modify','fetch','success','import_confirmed'],['reduce','xhr','row-failure','rejected'],['add','xhr','old-summary','unknown'],['add','xhr','stale-tables','unknown'],['add','xhr','double-request','unknown'],['add','xhr','wrong-tab','not_selected'],['modify','fetch','redirect','unknown'],['add','fetch','oversized','unknown'],['add','xhr','revoked','not_selected'],['add','xhr','idle-timeout','not_selected']]){
    const token=randomUUID();const requestKey='__bfFixture_'+token.replaceAll('-','')
    fixtureId=await evaluate(`(async()=>{const e=${requireElectron};const s=e.session.fromPartition(${JSON.stringify('bf-import-fixture-'+token)});const calls=[];await s.protocol.handle('https',async request=>{const u=new URL(request.url);if(u.origin==='https://redirect-fixture.invalid')return Response.json({appcode:'0',map:{data:${JSON.stringify(people)}.map(p=>({...p,validateStatus:'1',errorMessage:''}))}},{headers:{'access-control-allow-origin':'https://fuwu.rsj.beijing.gov.cn'}});if(u.origin!=='https://fuwu.rsj.beijing.gov.cn')return new Response('blocked',{status:403});if(u.pathname==='/fixture')return new Response(${JSON.stringify(html)},{headers:{'content-type':'text/html; charset=utf-8'}});if(u.pathname.toLowerCase().endsWith('/unitsearch/queryunitinfo')){calls.push({type:'unit'});return Response.json({map:{data:[{unitDTO:{unitId:'UNIT1',socialCreditCode:'123456789012345678'}}]}})};if(u.pathname.includes('ExcelCheck')){const body=Buffer.from(await request.arrayBuffer());const hash=process.getBuiltinModule('crypto').createHash('sha256').update(body).digest('hex');calls.push({type:'check',method:request.method,path:u.pathname,bytes:body.length,sha256:hash});if(${JSON.stringify(mode)}==='redirect')return new Response(null,{status:302,headers:{location:'https://redirect-fixture.invalid/result'}});const envelope={appcode:'0',map:{data:${JSON.stringify(people)}.map(p=>({...p,validateStatus:${JSON.stringify(mode==='row-failure'?'0':'1')},errorMessage:${JSON.stringify(mode==='row-failure'?'测试拒绝':'')}}))}};return new Response(JSON.stringify(envelope)+(${JSON.stringify(mode)}==='oversized'?' '.repeat(200000):''),{headers:{'content-type':'application/json'}})}return new Response('missing',{status:404})});const w=new e.BrowserWindow({show:false,width:1000,height:800,webPreferences:{partition:${JSON.stringify('bf-import-fixture-'+token)},contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});Object.defineProperty(w,${JSON.stringify(requestKey)},{value:calls});await w.loadURL(${JSON.stringify('https://fuwu.rsj.beijing.gov.cn/fixture?kind='+kind+'&transport='+transport+'&mode='+mode)});return w.id})()`)
    const agent={id:'fixture-'+token};const service=new BrowserFlowService({profileContext:{name:'fixture',home:join(root,'profile')},agents:{get:id=>id===agent.id?agent:undefined},tools:{register:()=>()=>{}}},resolveConfig({localTasksDir:tasksDir,importWindowMs:expected==='unknown'||mode==='idle-timeout'?500:10000}))
    service.start()
    try {
      const doc=(await page(identityProgram())).value.documentToken
      const panelPage={lease:'guest',partition:'fixture',documentToken:doc,url:'https://fuwu.rsj.beijing.gov.cn/fixture'}
      service.state.registerConnection({connectionGeneration:1,sessionId:agent.id,panel:{instanceId:'panel',pages:[panelPage]}})
      await service.tasks.create(agent.id,{definitionId:'synthetic',workflowRef:'import',goal:'Synthetic native case '+kind+' '+transport+' '+mode})
      const binding={instanceId:'panel',connectionGeneration:1,sessionId:agent.id,...panelPage}
      const post=async body=>(await service.handleAuthorize(new Request('http://localhost/api/browser-flow/authorize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion:3,...binding,...body})}))).json()
      assert.equal((await post({})).ok,true)
      const preview=await post({fileOperation:'prepare',path:file,scope:{...scope,kind}});assert.equal(preview.ok,true,JSON.stringify(preview))
      assert.equal((await post({fileOperation:'confirm',fileGrantId:preview.value.fileGrantId})).ok,true)
      const caller=service.resolveCaller({agent}).value
      const importOwner=service.importMetadata(service.leaseOf(caller).value).importOwner
      async function tool(name,args){
        let ready;const signal=new Promise(resolve=>{ready=resolve});const original=service.state.run
        service.state.run=(...args)=>{const p=original(...args);ready();return p}
        try{const result=service.tools.get(name).execute(args,{agent,signal:new AbortController().signal});const first=await Promise.race([signal.then(()=>({queued:true})),result.then(value=>({queued:false,value}))]);if(!first.queued)return first.value;
          const command=service.state.takeCommands('panel',1,service.config).value.commands[0];assert.ok(command)
          const value=await page(programFor(PAGE_CODE,command.op))
          service.state.settle({task:command.task,id:command.id,leaseId:command.leaseId,instanceId:'panel',connectionGeneration:1,epoch:command.epoch,sequence:command.sequence,...(value.ok?{outcome:'ok',payload:value.value}:{outcome:'failed',error:value.error})},service.config)
          return await result
        }finally{service.state.run=original}
      }
      await tool('browser_observe',{view:'bjrsj_import'})
      assert.equal((await evaluate(`(()=>{const e=${requireElectron};return e.BrowserWindow.fromId(${fixtureId})[${JSON.stringify(requestKey)}]})()`)).length,0,'passive installation must not initiate a request')
      const unit=await tool('browser_find',{by:'text',value:'单位信息变更'});assert.equal(unit.ok,true)
      assert.equal((await tool('browser_act',{action:'click',documentToken:unit.value.documentToken,elementRef:unit.value.match.elementRef})).ok,true)
      const deadline=Date.now()+15000;let observed
      do{observed=await tool('browser_observe',{view:'bjrsj_import'});assert.equal(observed.ok,true,JSON.stringify(observed));if(Date.now()>deadline)throw new Error('unit observation never became verified')}while(observed.value.import.identity!=='verified')
      const upload=await tool('browser_find',{by:'text',value:'上传申报信息'});assert.equal(upload.ok,true)
      if(mode==='idle-timeout'){do{observed=await tool('browser_observe',{view:'bjrsj_import'});if(Date.now()>deadline)throw new Error('idle observer never closed')}while(observed.value.import.cleanupStatus==='pending')}
      if(mode==='revoked')assert.equal(service.release(caller).value.pageRetained,true)
      const selected=await tool('browser_act',{action:'set_file',fileGrantId:preview.value.fileGrantId,documentToken:upload.value.documentToken,elementRef:upload.value.match.elementRef})
      let verdict='not_selected'
      if(expected!=='not_selected'){
        assert.equal(selected.ok,true,JSON.stringify(selected))
        do{observed=await tool('browser_observe',{view:'bjrsj_import'});assert.equal(observed.ok,true,JSON.stringify(observed));if(Date.now()>deadline)throw new Error('native import never settled')}while(observed.value.import.verdict==='not_dispatched'||observed.value.import.cleanupStatus==='pending')
        verdict=observed.value.import.verdict
      }else assert.equal(selected.ok,false)
      assert.equal(verdict,expected,JSON.stringify(observed))
      if(mode!=='revoked'){const submit=await tool('browser_find',{by:'text',value:'提交'});assert.equal(submit.ok,true)
      assert.equal((await tool('browser_act',{action:'click',documentToken:submit.value.documentToken,elementRef:submit.value.match.elementRef})).ok,false)}
      const duplicate=await service.act(caller,{action:'set_file',fileGrantId:preview.value.fileGrantId,documentToken:doc,elementRef:'none'},new AbortController().signal);assert.equal(duplicate.ok,false)
      const browser=await page('({fixture:window.fixture,url:location.origin,nativeFetch:Function.prototype.toString.call(fetch).includes("[native code]")})')
      const calls=await evaluate(`(()=>{const e=${requireElectron};return e.BrowserWindow.fromId(${fixtureId})[${JSON.stringify(requestKey)}]})()`)
      const network=calls.filter(request=>request.type==='check');assert.equal(calls.filter(request=>request.type==='unit').length,1)
      assert.equal(browser.fixture.changeEvents,expected==='not_selected'?0:1);assert.equal(browser.fixture.submitClicks,0)
      assert.equal(network.length,expected==='not_selected'?0:mode==='double-request'?2:1)
      for(const request of network){assert.equal(request.bytes,bytes.length);assert.equal(request.sha256,sha256)}
      if(mode!=='revoked')assert.equal(service.release(caller).value.pageRetained,true)
      assert.equal((await service.observe(caller,new AbortController().signal,'bjrsj_import')).ok,false)
      const response=await page('window.__dshBrowserFlow?.importState?.cache?.response?({url:window.__dshBrowserFlow.importState.cache.response.url,status:window.__dshBrowserFlow.importState.cache.response.status}):null');
      const cleanup=await page(importProgram({mode:'dispose',owner:importOwner}))
      const restored=await page('Function.prototype.toString.call(fetch).includes("[native code]")&&Function.prototype.toString.call(XMLHttpRequest.prototype.send).includes("[native code]")');assert.equal(restored,true)
      if(mode==='redirect'){assert.equal(new URL(response.url).origin,'https://redirect-fixture.invalid');assert.equal(response.status,200)}
      receipt.cases.push({kind,transport,mode,verdict,inputEvents:browser.fixture.inputEvents,changeEvents:browser.fixture.changeEvents,submitClicks:browser.fixture.submitClicks,requests:network.length,...(response?{responseOrigin:new URL(response.url).origin,responseStatus:response.status}:{}),fileSha256:sha256,cleanupFailed:cleanup.value.cleanupFailed,pageRetained:true})
      process.stdout.write(JSON.stringify(receipt.cases.at(-1))+'\n')
    }finally{await service.close();await evaluate(`(()=>{const e=${requireElectron};e.BrowserWindow.fromId(${fixtureId})?.destroy();return true})()`);fixtureId=undefined}
  }
  receipt.passed=true
  await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})
}catch(error){receipt.passed=false;receipt.failure=String(error.message).slice(0,500);await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});throw error}
finally{if(fixtureId)await evaluate(`(()=>{const e=${requireElectron};e.BrowserWindow.fromId(${fixtureId})?.destroy();return true})()`);ws.close()}
