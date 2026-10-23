import assert from 'node:assert/strict'
import { it } from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { taskFacts, taskCoverage } from '../src/task-facts.ts'
import { navigation } from './helpers/task-navigation.ts'
import { expectFailure, expectOk, expectRecord, present } from './helpers/assertions.ts'

async function observe(env:Awaited<ReturnType<typeof navigation>>,extra:Record<string,unknown>={}) {
  const page={...env.page('a'),url:'https://fuwu.rsj.beijing.gov.cn/zhrs/yltc/information-third-new/imp'}
  const pending=env.tool('a','browser_observe')
  const command=(await env.post('poll',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',pages:[page]})).body.value.commands[0]
  await env.post('result',{kind:'result',task:command.task,id:command.id,leaseId:command.leaseId,instanceId:'panel-a',connectionGeneration:1,epoch:command.epoch,sequence:command.sequence,outcome:'ok',payload:{url:page.url,documentToken:page.documentToken,nodes:['模板下载','上传申报信息','批量增员','批量修改','批量减员'].map(text=>({text})),...extra}})
  return pending
}

for(const flag of [undefined,true,false,'true'] as const)it(`owns the ordinary observation marker when the guest reports ${String(flag)}`,async t=>{
  const env=await navigation(t),store=env.service.tasks,access=present(env.access)
  const returned=expectRecord(expectOk(await observe(env,{...(flag===undefined?{}:{contextOnly:flag}),resourceIdentity:{version:1,key:'f'.repeat(64),basis:'document_instance',snapshotKind:'context'}})))
  const data=store.openTask(access),page=expectRecord(present(data.events.findLast(e=>e.type==='asset'&&e.data.kind==='page')).data.data)
  assert.equal(returned.contextOnly,false);assert.equal(page.contextOnly,false)
  assert.equal(page.documentToken,'doc-a');assert.equal(expectRecord(page.resourceIdentity).snapshotKind,'observation')
  assert.notEqual(expectRecord(page.resourceIdentity).key,'f'.repeat(64))
  assert.equal(taskFacts(data).verdict,'entry_reached');assert.equal(taskCoverage(data).verified,1)
})

it('recovers with a real observation while preserving a polluted historical snapshot byte for byte',async t=>{
  const env=await navigation(t),store=env.service.tasks,access=present(env.access),data=store.openTask(access)
  const initial=expectRecord(present(data.events.find(e=>e.type==='asset'&&e.data.kind==='page')).data.data)
  const polluted=await store.asset(access,'page',{...initial,contextOnly:true})
  const proof=await store.proof(access,{schemaVersion:1,kind:'navigation',run:access.run,pageRef:polluted})
  assert.equal(await store.verdict(access,{verdict:'entry_reached'},proof),'unverified')
  const journal=join(data.dir,'basic_law_index/events.jsonl'),before=await readFile(journal)
  expectOk(await observe(env,{contextOnly:true}))
  assert.equal(taskFacts(data).verdict,'entry_reached')
  assert.equal(expectRecord(present(data.events.find(e=>e.data.id===polluted)).data.data).contextOnly,true)
  assert.deepEqual((await readFile(journal)).subarray(0,before.length),before)
})

it('still rejects a reported document replacement before recording an observation',async t=>{
  const env=await navigation(t),store=env.service.tasks,access=present(env.access),count=store.openTask(access).events.length
  assert.equal(expectFailure(await observe(env,{documentToken:'foreign-document',contextOnly:true})).code,'stale_observation')
  assert.equal(store.openTask(access).events.length,count)
})
