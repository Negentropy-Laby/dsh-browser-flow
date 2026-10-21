/** Explicit Windows target-artifact fixture. It does not establish real website acceptance. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

async function main(){
 if(process.platform!=='win32'||process.arch!=='x64')throw new Error('NOT_RUN: this fixture requires Windows x64')
 const checkout=process.env.DSH_CHECKOUT??process.argv[2],receipt=process.env.DSH_BF_GRAPH_RECEIPT??process.argv[3]
 if(!checkout||!receipt)throw new Error('Set explicit DSH_CHECKOUT and private DSH_BF_GRAPH_RECEIPT')
 const expected='687f282e8625c6b8d11ff58211a90524be2e4317'
 const sha=execFileSync(process.env.DSH_GIT??process.argv[4]??'git',['-C',checkout,'rev-parse','HEAD'],{encoding:'utf8'}).trim()
 assert.equal(sha,expected)
 assert.equal(execFileSync(process.env.DSH_GIT??process.argv[4]??'git',['-C',checkout,'status','--porcelain','-uno'],{encoding:'utf8'}).trim(),'')
 const load=path=>import(pathToFileURL(join(checkout,path)).href)
 const {Context}=await load('vendor/cordis/lib/index.js'),toolsModule=await load('packages/core/tools/lib/index.js'),provider=await load('packages/subprocess/subprocess-local/lib/index.js')
 const plugin=await import('../lib/host/index.js'),scratch=await mkdtemp(join(tmpdir(),'bf-target-graph-'))
 const context=new Context(),agents=new Map(['a','b'].map(id=>['graph-'+id,{id:'graph-'+id}])),routes=new Map()
 const checks=[];let firstScope;let restoreSpawn=()=>{};const owned=[]
 try{
  context.provide('profileContext',{name:'qualification',home:scratch});context.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{}})
  await context.plugin(toolsModule.default??toolsModule.ToolRuntime)
  await context.plugin(provider.default)
  const runtime=context.subprocess,original=runtime.spawn
  runtime.spawn=function(spec){const handle=original.call(this,spec);owned.push(handle);return handle}
  restoreSpawn=()=>{delete runtime.spawn}
  context.provide('agents',{get:id=>agents.get(id)})
  context.provide('connection',{fetch:{register:route=>{routes.set(route.path,route);return()=>routes.delete(route.path)}}})
  await context.plugin({inject:plugin.inject,apply:ctx=>plugin.apply(ctx,{localTasksDir:join(scratch,'tasks')})})
  assert.equal(context.tools.schemas().filter(row=>row.name.startsWith('browser_')).length,6);assert.equal(routes.size,7);checks.push('six tools and seven routes')
  async function post(path,body){const response=await routes.get('/api/browser-flow/'+path).fetch(new Request('http://fixture.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion:3,...body})}));const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.value}
  const outputs={}
  for(const id of ['a','b']){
   const sessionId='graph-'+id,instanceId='panel-'+id
   const page={lease:'synthetic-guest-'+id,partition:'synthetic-'+id,documentToken:'document-'+id,url:'https://'+id+'.example/fixture'}
   await post('hello',{kind:'hello',connectionGeneration:1,sessionId,panel:{instanceId,pages:[page]}})
   const task=await post('authorize',{instanceId,connectionGeneration:1,sessionId,taskOperation:'create',spec:{goal:'Synthetic graph '+id,origins:['https://'+id+'.example'],criteria:['A free criterion stays unverified']}})
   if(id==='a')firstScope=task.task
   await post('authorize',{instanceId,connectionGeneration:1,sessionId,...page})
   const result=await context.tools.get('browser_observe').execute({view:'task'},{agent:agents.get(sessionId),signal:new AbortController().signal})
   assert.equal(result.ok,true);assert.equal(result.value.active_context.graph.status,'ready',JSON.stringify(result))
   assert.equal(result.value.businessVerdict,'unverified');outputs[id]=result
   const waiting=await context.tools.get('browser_act').execute({action:'await_user',wait:{kind:'other_user_input',reason:'Synthetic wait '+id,resumeCondition:'An actual new user response'}},{agent:agents.get(sessionId),signal:new AbortController().signal})
   assert.equal(waiting.ok,true)
   const view=await context.tools.get('browser_observe').execute({view:'task'},{agent:agents.get(sessionId),signal:new AbortController().signal})
   assert.equal(view.value.active_context.waiting.reason,'Synthetic wait '+id)
   assert.equal((await context.tools.get('browser_release').execute({},{agent:agents.get(sessionId),signal:new AbortController().signal})).ok,true)
  }
  assert.ok(!JSON.stringify(outputs.b).includes(firstScope.taskId));checks.push('actual Windows managed Go workers','task isolation','Host criteria remain unverified','Agent tool waits','release independent of graph')
  const readA=()=>context.tools.get('browser_observe').execute({view:'task'},{agent:agents.get('graph-a'),signal:new AbortController().signal})
  const before=await readA(),count=owned.length
  owned[0].terminate();assert.equal(await owned[0].waitForExit(),true);await owned[0].done
  assert.equal(owned.length,count,'a crashed worker must not restart automatically')
  const after=await readA();assert.equal(after.value.active_context.graph.status,'ready')
  assert.equal(after.value.active_context.graph.projectionId,before.value.active_context.graph.projectionId)
  assert.equal(after.value.active_context.waiting.reason,'Synthetic wait a');assert.equal(after.value.active_context.pageControl,'unavailable')
  assert.equal(owned.length,count+1);checks.push('actual worker crash without automatic replay','deterministic reconstruction without restored control')
  await context.fiber.dispose();assert.ok((await Promise.all(owned.map(handle=>handle.waitForExit()))).every(Boolean));assert.equal(context.tools?.schemas().filter(row=>row.name.startsWith('browser_')).length??0,0);checks.push('awaited provider and plugin disposal')
  const manifest=JSON.parse(await readFile(new URL('../lib/native/manifest.json',import.meta.url),'utf8'))
  const result={recordedAt:new Date().toISOString(),status:'PASS',kind:'target-artifact fixture; synthetic task calls, not normal Agent or website acceptance',target:sha,node:process.version,platform:process.platform,checks,native:manifest,hostSha256:createHash('sha256').update(await readFile(new URL('../lib/host/index.js',import.meta.url))).digest('hex')}
  await writeFile(resolve(receipt),JSON.stringify(result,null,2)+'\n',{flag:'wx'})
  process.stdout.write(JSON.stringify({status:result.status,checks:checks.length,target:sha})+'\n')
 }finally{await context.fiber.dispose();restoreSpawn();await rm(scratch,{recursive:true,force:true})}
}
main().catch(error=>{process.stderr.write(String(error.stack??error)+'\n');process.exitCode=1})
