import assert from 'node:assert/strict'
import { it } from 'node:test'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { taskHost } from './helpers/task-host.js'
import { syntheticDefinition } from './helpers/task-definition.js'
import { TaskStore } from '../src/task-store.js'

async function navigation(t){
  const env=await taskHost(t),def=syntheticDefinition({root:env.root})
  await writeFile(join(def.dir,'definition.json'),JSON.stringify({...def.definition,adapter:'bjrsj',origins:['https://fuwu.rsj.beijing.gov.cn'],workflows:def.definition.workflows.map(row=>({...row,id:'navigation',stopBoundary:'before_file_selection'}))}))
  const page={...env.page('a'),url:'https://fuwu.rsj.beijing.gov.cn/zhrs/yltc/information-third-new/imp'}
  await env.post('hello',{kind:'hello',connectionGeneration:1,sessionId:'session-a',panel:{instanceId:'panel-a',pages:[page]}})
  await env.post('authorize',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',taskOperation:'create',spec:{definitionId:'synthetic',workflowRef:'navigation',goal:'Reach navigation entry',criteria:['A free-text criterion stays unverified']}})
  await env.post('authorize',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',...page})
  const pending=env.tool('a','browser_observe')
  const command=(await env.post('poll',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',pages:[page]})).body.value.commands[0]
  await env.post('result',{kind:'result',task:command.task,id:command.id,leaseId:command.leaseId,instanceId:'panel-a',connectionGeneration:1,epoch:command.epoch,sequence:command.sequence,outcome:'ok',payload:{url:page.url,documentToken:'doc-a',nodes:['模板下载','上传申报信息','批量增员','批量修改','批量减员'].map(text=>({text}))}})
  assert.equal((await pending).ok,true)
  const access=env.service.tasks.current('session-a')
  return {...env,access}
}
it('does not accept a bare qualified event as an import proof',async t=>{
  const env=await taskHost(t);await env.task('a')
  const store=env.service.tasks,access=store.current('session-a')
  await store.append(access,'business_verdict',{source:'code_verified',qualified:true,verdict:'import_confirmed',run:access.run})
  assert.equal((await env.tool('a','browser_observe',{view:'task'})).value.businessVerdict,'unverified')
})
it('proves a trusted navigation criterion with actual evidence and identical graph/detail IDs',async t=>{
  const env=await navigation(t)
  const view=(await env.tool('a','browser_observe',{view:'task'})).value
  const criterion=view.procedural_law_index.criteria.find(row=>row.source==='code_verified')
  assert.equal(criterion.status,'passed')
  assert.ok(view.knowledge_graph.edges.some(edge=>edge.relation==='proves'&&edge.to===criterion.id))
  assert.equal(JSON.parse((await env.tool('a','browser_observe',{view:'task',ref:criterion.id})).value.text).data.status,'passed')
  assert.equal(view.procedural_law_index.criteria.find(row=>row.source==='user_declared').status,'unverified')
  const row=env.service.tasks.openTask(env.access).events.findLast(event=>event.type==='business_verdict')
  assert.ok(row.data.proofRef)
  const next=await env.service.tasks.revise(env.access,{newRun:true})
  assert.equal(env.service.tasks.view(next,8000).active_context.businessVerdict,'unverified')
})
it('rechecks private originals and refuses missing, changed and foreign proof references',async t=>{
  for(const mode of ['missing','changed','foreign','wrong-version']){
    const env=await navigation(t),store=env.service.tasks
    const data=store.openTask(env.access),verdict=data.events.findLast(event=>event.type==='business_verdict').data
    assert.ok(verdict.proofRef)
    const proof=data.events.find(event=>event.type==='asset'&&event.data.id===verdict.proofRef)
    if(mode==='missing')await unlink(join(data.dir,proof.data.data.artifact))
    if(mode==='changed')await writeFile(join(data.dir,proof.data.data.artifact),'{}\n')
    if(mode==='foreign')await store.append(env.access,'business_verdict',{...verdict,proofRef:'asset-foreign'})
    if(mode==='wrong-version')await store.append(env.access,'business_verdict',{...verdict,validatorVersion:99})
    const view=(await env.tool('a','browser_observe',{view:'task'})).value
    assert.equal(view.businessVerdict,'unverified',mode)
    assert.ok(view.procedural_law_index.criteria.every(row=>row.status!=='passed'),mode)
  }
})
it('rebuilds a valid proof from disk without restoring control and rejects a missing original on restart',async t=>{
  const env=await navigation(t),data=env.service.tasks.openTask(env.access)
  const original=data.events.find(event=>event.type==='asset'&&event.data.kind==='evidence').data.data.artifact
  await env.service.close()
  for(const missing of [false,true]){
    if(missing)await unlink(join(data.dir,original))
    const store=new TaskStore(env.root,env.ctx.profileContext,100)
    try{
      const access=await store.forSession('session-a')
      assert.equal(store.view(access,8000).active_context.businessVerdict,missing?'unverified':'entry_reached')
      assert.equal(env.service.state.leaseFor(env.agents.get('session-a'),'no-restored-token','session-a'),undefined)
    }finally{await store.close()}
  }
})
