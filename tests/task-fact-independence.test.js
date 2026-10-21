import assert from 'node:assert/strict'
import { it } from 'node:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { syntheticDefinition } from './helpers/task-definition.js'
import { taskHost } from './helpers/task-host.js'

it('checks business evidence without consulting a replaceable graph view',async t=>{
  const env=await taskHost(t)
  const def=syntheticDefinition({root:env.root})
  await writeFile(join(def.dir,'definition.json'),JSON.stringify({...def.definition,adapter:'bjrsj',origins:['https://fuwu.rsj.beijing.gov.cn'],workflows:def.definition.workflows.map(row=>({...row,id:'import',stopBoundary:'import_confirmed'}))}))
  await env.task('a',{definitionId:'synthetic',workflowRef:'import',goal:'Check evidence independently'})
  const store=env.service.tasks,access=store.current('session-a')
  store.view=()=>{throw new Error('graph unavailable')}
  assert.equal(await store.verdict(access,{verdict:'import_confirmed',qualified:true},'asset-missing'),'unverified')
})
it('keeps reference ownership and unknown writes independent of graph results',async t=>{
  const env=await taskHost(t);await env.task('a');await env.task('b')
  const store=env.service.tasks,a=store.current('session-a'),b=store.current('session-b')
  const own=await store.asset(a,'page',{documentToken:'a'}),foreign=await store.asset(b,'page',{documentToken:'b'})
  store.view=()=>({active_context:{businessVerdict:'import_confirmed',writeBlocked:false}})
  await assert.rejects(store.relate(a,own,foreign,'observed_on'),/inaccessible/)
  const attempt=await store.beginAttempt(a,'click');await store.receipt(a,attempt,'unknown_outcome')
  assert.throws(()=>store.openTask(a,true),/unknown|blocked/)
})
