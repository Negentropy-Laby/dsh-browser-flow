/** Automated synthetic roundtrip; this does not claim autonomous model or live-site acceptance. */
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {pathToFileURL} from 'node:url'
import {resolveDependency,entryOf,host,call,pump} from './helpers/dom-host.ts'
import {hostPort} from './helpers/ports.ts'
import {throughPage} from './helpers/through-page.ts'
import {BrowserFlowService} from '../src/index.ts'
import {resolveConfig} from '../src/config.ts'
import {identityProgram} from '../src/pagecode.ts'
const checkout=process.env.DSH_CHECKOUT??new URL('../../deepseek-harness',import.meta.url).pathname
for(const shape of ['native','aria'] as const)test(`generic normal tools observe ${shape} layout, write facts and complete with original-backed checks`,async t=>{
 const dependency=resolveDependency(checkout,'jsdom');assert.ok(dependency,'Set DSH_CHECKOUT to the existing built Harness containing jsdom; this required test cannot be skipped')
 const {JSDOM}=await import(pathToFileURL(entryOf(dependency)).href)
 const token=randomUUID(),origin='https://'+token+'.example',header='field-'+randomUUID(),value='value-'+randomUUID(),button='action-'+randomUUID()
 const table=shape==='native'?`<table><tr><th>${header}</th></tr><tr><td>${value}</td></tr></table>`:`<div role="grid"><div role="row"><span role="columnheader">${header}</span></div><div role="row"><span role="gridcell">${value}</span></div></div>`
 const dom=new JSDOM(`<section role="region">${table}<button>${button}</button></section>`,{url:origin+'/route-'+randomUUID(),runScripts:'dangerously'})
 const window=dom.window
 window.Element.prototype.getBoundingClientRect=function(){return {x:0,y:0,top:0,left:0,right:100,bottom:20,width:100,height:20,toJSON(){return {}}}}
 let clicked=0;window.document.querySelector('button').addEventListener('click',()=>clicked++)
 const root=await mkdtemp(join(tmpdir(),'bf-generic-dom-')),agent={id:'session-1'},fake=host(agent)
 const service=new BrowserFlowService({...hostPort(fake.ctx),profileContext:{name:'fixture',home:join(root,'home')}},resolveConfig({localTasksDir:join(root,'tasks')}));service.start()
 t.after(async()=>{await service.close();window.close();await rm(root,{recursive:true,force:true})})
 const identity=new window.Function(`return (${identityProgram()})`)().value
 const pages=[{lease:'guest',partition:'partition',tabId:'tab',url:identity.url,documentToken:identity.documentToken}]
 await call(fake.routes.get('POST /api/browser-flow/hello')!,{kind:'hello',connectionGeneration:1,sessionId:agent.id,panel:{instanceId:'panel-1',pages}})
 const access=await service.tasks.create(agent.id,{goal:'Observe and establish the requested result',origins:[origin]})
 const binding={instanceId:'panel-1',connectionGeneration:1,sessionId:agent.id,...pages[0]}
 assert.equal((await call(fake.routes.get('POST /api/browser-flow/authorize')!,binding)).status,200)
 const tool=(name:string,args:Record<string,unknown>)=>throughPage(service,()=>fake.tools.get(name)!.execute(args,{agent,signal:new AbortController().signal}),()=>pump({routes:fake.routes,window,pages,sessionId:agent.id})) as Promise<any>
 let request=0
 const explore=async(command:Record<string,unknown>)=>{const result=await tool('browser_act',{action:'explore',explore:command,requestId:'request-'+(++request),expectedVersion:service.tasks.openTask(access).events.length});assert.equal(result.ok,true,JSON.stringify(result));return result.value}
 await explore({op:'add_intent',summary:'Inspect the page and check its actual result'})
 await explore({op:'claim_intent'})
 const observed=await tool('browser_observe',{view:'table'});assert.equal(observed.ok,true,JSON.stringify(observed))
 assert.equal(observed.value.tables[0].columns[0].text,header)
 assert.equal(observed.value.tables[0].rows[1].cells[0].text,value)
 assert.equal(observed.value.datasetComplete,false);assert.equal(observed.value.truncated,false)
 assert.match(observed.value.assetRef,/^asset-/);assert.match(observed.value.resourceRef,/^resource-/)
 const check=await explore({op:'check_evidence',assertion:{op:'equals',left:{ref:observed.value.assetRef,path:['tables',0,'rows',1,'cells',0,'text']},right:{value}}})
 const found=await tool('browser_find',{by:'role',value:'button'});assert.equal(found.ok,true)
 const clickedResult=await tool('browser_act',{action:'click',documentToken:found.value.documentToken,elementRef:found.value.match.elementRef});assert.equal(clickedResult.ok,true);assert.equal(clicked,1)
 const fact=await explore({op:'record_fact',summary:'Observed the requested value in its table',confidence:'observed',evidence_refs:[observed.value.assetRef],check_refs:[check.check_ref],asset_ids:[observed.value.resourceRef]})
 await explore({op:'finish_intent'})
 const overview=await tool('browser_observe',{view:'task',query:{op:'graph_overview'}});assert.equal(overview.ok,true)
 const result=await explore({op:'prove_goal',goal_id:overview.value.value.goals[0].id,evidence_id:fact.ids[0],reason:'The actual table value matches the requested outcome'})
 assert.equal(result.state,'completed');assert.equal(service.state.leaseCountForSession(agent.id),0)
 assert.equal((await tool('browser_observe',{view:'task'})).ok,true)
 assert.equal((await tool('browser_act',{action:'click',documentToken:found.value.documentToken,elementRef:found.value.match.elementRef})).ok,false)
})
