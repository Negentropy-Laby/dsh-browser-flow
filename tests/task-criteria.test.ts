import {expectOk,present,expectRecord,expectString,expectList} from './helpers/assertions.ts'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { taskHost } from './helpers/task-host.ts'
import { navigation } from './helpers/task-navigation.ts'
import { TaskStore } from '../src/task-store.ts'

it('does not accept a bare qualified event as an import proof',async t=>{
  const env=await taskHost(t);await env.task('a')
  const store=env.service.tasks,access=store.current('session-a')
  await store.append(present(access),'business_verdict',{source:'code_verified',qualified:true,verdict:'import_confirmed',run:present(access).run})
  assert.equal(expectRecord(expectOk((await env.tool('a','browser_observe',{view:'task'})))).businessVerdict,'unverified')
})
it('proves a trusted navigation criterion with actual evidence and identical graph/detail IDs',async t=>{
  const env=await navigation(t)
  const view=expectOk((await env.tool('a','browser_observe',{view:'task'})))
  const criterion=expectList(expectRecord(expectRecord(view).procedural_law_index).criteria).find((row)=>expectRecord(row).source==='code_verified')
  assert.equal(expectRecord(criterion).status,'passed')
  assert.ok(expectList(expectRecord(expectRecord(view).knowledge_graph).edges).some((edge)=>expectRecord(edge).relation==='proves'&&expectRecord(edge).to===expectRecord(criterion).id))
  assert.equal(JSON.parse(expectString(expectRecord(expectOk((await env.tool('a','browser_observe',{view:'task',ref:expectRecord(criterion).id})))).text)).data.status,'passed')
  assert.equal(expectRecord(expectList(expectRecord(expectRecord(view).procedural_law_index).criteria).find((row)=>expectRecord(row).source==='user_declared')).status,'unverified')
  const row=env.service.tasks.openTask(present(env.access)).events.findLast(event=>event.type==='business_verdict')
  assert.ok(present(row).data.proofRef)
  const next=await env.service.tasks.revise(present(env.access),{newRun:true})
  assert.equal((await env.service.tasks.view(next,8000)).active_context.businessVerdict,'unverified')
})
it('rechecks private originals and refuses missing, changed and foreign proof references',async t=>{
  for(const mode of ['missing','changed','foreign','wrong-version'] as const){
    const env=await navigation(t),store=env.service.tasks
    const data=store.openTask(present(env.access)),verdict=present(data.events.findLast(event=>event.type==='business_verdict')).data
    assert.ok(verdict.proofRef)
    const proof=data.events.find(event=>event.type==='asset'&&event.data.id===verdict.proofRef)
    if(mode==='missing')await unlink(join(data.dir,expectString(expectRecord(present(proof).data.data).artifact)))
    if(mode==='changed')await writeFile(join(data.dir,expectString(expectRecord(present(proof).data.data).artifact)),'{}\n')
    if(mode==='foreign')await store.append(present(env.access),'business_verdict',{...verdict,proofRef:'asset-foreign'})
    if(mode==='wrong-version')await store.append(present(env.access),'business_verdict',{...verdict,validatorVersion:99})
    const view=expectOk((await env.tool('a','browser_observe',{view:'task'})))
    assert.equal(expectRecord(view).businessVerdict,'unverified',mode)
    assert.ok(expectList(expectRecord(expectRecord(view).procedural_law_index).criteria).every((row)=>expectRecord(row).status!=='passed'),mode)
  }
})
it('rebuilds a valid proof from disk without restoring control and rejects a missing original on restart',async t=>{
  const env=await navigation(t),data=env.service.tasks.openTask(present(env.access))
  const original=expectRecord(present(data.events.find(event=>event.type==='asset'&&event.data.kind==='evidence')).data.data).artifact
  await env.service.close()
  for(const missing of [false,true] as const){
    if(missing)await unlink(join(data.dir,expectString(original)))
    const store=new TaskStore(env.root,env.ctx.profileContext,100)
    try{
      const access=await store.forSession('session-a')
      assert.equal((await store.view(access,8000)).active_context.businessVerdict,missing?'unverified':'entry_reached')
      assert.equal(env.service.state.leaseFor(present(env.agents.get('session-a')),'no-restored-token','session-a'),undefined)
    }finally{await store.close()}
  }
})
