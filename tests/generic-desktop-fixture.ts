/** Native Chromium qualification through the six-tool service; separate from autonomous Agent acceptance. */
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {BrowserFlowService} from '../src/index.ts'
import {resolveConfig} from '../src/config.ts'
import {programFor} from '../src/clientcore.ts'
import {PAGE_CODE} from '../src/panel.ts'
import {identityProgram} from '../src/pagecode.ts'
import {validateCommand} from '../src/protocol.ts'
import {attachInspector} from './helpers/inspector.ts'
import {expectOk,expectRecord,expectString,expectNumber,present} from './helpers/assertions.ts'

const [specFile,output]=process.argv.slice(2)
if(!specFile||!output)throw new Error('usage: generic-desktop-fixture.ts <owned-desktop-start.json> <new-receipt.json>')
const spec=JSON.parse(await readFile(specFile,'utf8')),inspector=await attachInspector(Number(spec.env.DSH_DESKTOP_MAIN_INSPECT_PORT))
const req="process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')"
const identity=expectRecord(await inspector.evaluate(`({appPath:${req}.app.getAppPath(),pid:process.pid,electron:process.versions.electron})`))
assert.equal(resolve(expectString(identity.appPath)).toLowerCase(),resolve(spec.cwd,'apps','desktop').toLowerCase())
const root=await mkdtemp(join(resolve('.cache'),'generic-native-')),file=join(root,'input.json'),payload={records:[{key:randomUUID(),value:'中文 '.repeat(400)+randomUUID()}]}
const bytes=Buffer.from(JSON.stringify(payload));await writeFile(file,bytes,{flag:'wx'})
const cases:Record<string,unknown>[]=[]
let fixtureId:number|undefined
const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><html><body><section role="region" aria-label="Result"><h1>Neutral fixture</h1><input type="file" aria-label="Source"><table><tr><th>Key</th><th>Value</th></tr>${Array.from({length:40},(_,i)=>'<tr><td>'+i+'</td><td>中文 '+i+'</td></tr>').join('')}</table><output></output></section><script>globalThis.fixture={input:0,change:0};document.querySelector('input').addEventListener('input',()=>fixture.input++);document.querySelector('input').addEventListener('change',async e=>{fixture.change++;const file=e.target.files[0];fixture.name=file.name;fixture.content=await file.text();document.querySelector('output').textContent='Received '+file.name})</script></body></html>`)})
await new Promise<void>(resolve=>{server.listen(0,'127.0.0.1',resolve)})
const address=server.address();assert.ok(address&&typeof address==='object');const origin='http://127.0.0.1:'+address.port
const receipt:Record<string,unknown>={recordedAt:new Date().toISOString(),surface:'native owned Electron BrowserWindow; actual shipped page programs and six-tool service; not a normal Agent turn',target:'687f282e8625c6b8d11ff58211a90524be2e4317',electron:identity.electron,cases}
try{
 fixtureId=expectNumber(await inspector.evaluate(`(async()=>{const w=new (${req}.BrowserWindow)({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});await w.loadURL(${JSON.stringify(origin+'/route-'+randomUUID())});return w.webContents.id})()`))
 const page=(source:string)=>inspector.evaluate(`${req}.webContents.fromId(${fixtureId}).executeJavaScript(${JSON.stringify(source)},true)`)
 const doc=expectString(expectRecord(expectRecord(await page(identityProgram())).value).documentToken),agent={id:'generic-native-'+randomUUID()}
 const service=new BrowserFlowService({profileContext:{name:'fixture',home:join(root,'profile')},agents:{get:id=>id===agent.id?agent:undefined},tools:{register:()=>()=>{}}},resolveConfig({localTasksDir:join(root,'tasks'),observeMaxChars:700,observeMaxNodes:30}))
 service.start()
 try{
  const access=await service.tasks.create(agent.id,{goal:'Inspect the original file and observed result',origins:[origin]})
  const panelPage={lease:'guest',partition:'fixture',documentToken:doc,url:origin+'/fixture'}
  service.state.registerConnection({connectionGeneration:1,sessionId:agent.id,panel:{instanceId:'panel',pages:[panelPage]}})
  const post=async(body:object)=>expectRecord(await (await service.handleAuthorize(new Request(origin+'/api/browser-flow/authorize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion:4,instanceId:'panel',connectionGeneration:1,sessionId:agent.id,...panelPage,...body})}))).json())
  assert.equal((await post({})).ok,true)
  const preview=await post({fileOperation:'prepare',path:file});assert.equal(preview.ok,true,JSON.stringify(preview));const prepared=expectRecord(preview.value)
  assert.equal((await post({fileOperation:'confirm',fileGrantId:prepared.fileGrantId})).ok,true)
  const tool=async(name:string,args:Record<string,unknown>)=>{
   let ready!:()=>void;const signal=new Promise<void>(r=>{ready=r}),original=service.state.run
   service.state.run=(...args)=>{const p=original(...args);ready();return p}
   try{
    const result=present(service.tools.get(name)).execute(args,{agent,signal:new AbortController().signal})
    const first=await Promise.race([signal.then(()=>({queued:true as const})),result.then(value=>({queued:false as const,value}))])
    if(!first.queued)return first.value
    const command=expectOk(service.state.takeCommands('panel',1,service.config)).commands[0];assert.ok(command)
    const checked=validateCommand({...command,kind:'command'});assert.ok(checked.ok)
    const value=expectRecord(await page(programFor(PAGE_CODE,checked.command.op as import('../src/clientcore.ts').PageOperation))),error=expectRecord(value.error??{})
    service.state.settle({task:command.task,id:command.id,leaseId:command.leaseId,instanceId:'panel',connectionGeneration:1,epoch:command.epoch,sequence:command.sequence,...(value.ok?{outcome:'ok',payload:expectRecord(value.value)}:{outcome:'failed',error:{code:expectString(error.code),message:expectString(error.message)}})},service.config)
    return result
   }finally{service.state.run=original}
  }
  let counter=0
  const explore=async(command:Record<string,unknown>)=>expectRecord(expectOk(await tool('browser_act',{action:'explore',explore:command,requestId:'native-'+(++counter),expectedVersion:service.tasks.openTask(access).events.length})))
  await explore({op:'add_intent',summary:'Read the selected file and observe native upload'})
  await explore({op:'claim_intent'})
  const ref=expectString(prepared.assetRef),first=expectRecord(expectOk(await tool('browser_observe',{view:'file',ref})))
  let serialized=expectString(first.text),offset=serialized.length
  while(offset<expectNumber(first.totalChars)){const chunk=expectRecord(expectOk(await tool('browser_observe',{view:'file',ref,offset,projectionId:first.projectionId})));serialized+=expectString(chunk.text);offset=serialized.length}
  assert.deepEqual(JSON.parse(serialized),payload);cases.push({case:'file_original_and_chinese_continuation',passed:true})
  const table=expectRecord(expectOk(await tool('browser_observe',{view:'table'})));assert.equal(table.truncated,true);assert.equal(table.datasetComplete,false)
  cases.push({case:'native_table_reports_truncation',passed:true})
  const found=expectRecord(expectOk(await tool('browser_find',{by:'role',value:'region'})))
  const region=expectRecord(expectOk(await tool('browser_observe',{view:'region',documentToken:found.documentToken,elementRef:expectRecord(found.match).elementRef})))
  assert.ok(region.assetRef);assert.equal(region.datasetComplete,false);cases.push({case:'scoped_region_observation',passed:true})
  const input=expectRecord(expectOk(await tool('browser_find',{by:'attr',name:'type',value:'file'}))),target={documentToken:input.documentToken,elementRef:expectRecord(input.match).elementRef}
  const selected=expectOk(await tool('browser_act',{action:'set_file',fileGrantId:prepared.fileGrantId,...target}));assert.equal(expectRecord(selected).dispatched,true)
  const state=expectRecord(await page('(async()=>{for(let i=0;i<100&&!fixture.content;i++)await new Promise(r=>setTimeout(r,10));return fixture})()'))
  assert.equal(state.input,1);assert.equal(state.change,1);assert.equal(state.content,bytes.toString())
  assert.equal((await tool('browser_act',{action:'set_file',fileGrantId:prepared.fileGrantId,...target})).ok,false)
  assert.equal(expectRecord(await page('fixture')).change,1);cases.push({case:'native_file_datatransfer_exact_bytes_single_use',passed:true,sha256:createHash('sha256').update(bytes).digest('hex')})
  const caller=expectOk(service.resolveCaller({agent}));expectOk(service.release(caller))
  assert.equal((await tool('browser_observe',{view:'page'})).ok,false);cases.push({case:'revoked_page_retained_and_uncontrollable',passed:true})
 }finally{await service.close()}
 receipt.passed=true
}catch(error){receipt.passed=false;receipt.failure=error instanceof Error?error.message:String(error);throw error}
finally{await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});if(fixtureId)await inspector.evaluate(`${req}.webContents.fromId(${fixtureId}).close()`);inspector.close();await new Promise<void>(resolve=>{server.close(()=>resolve())})}
console.log(JSON.stringify({passed:receipt.passed,cases:cases.length,electron:identity.electron}))
