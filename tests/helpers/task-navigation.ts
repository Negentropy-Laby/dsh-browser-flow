import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { taskHost } from './task-host.ts'
import { syntheticDefinition } from './task-definition.ts'

export async function navigation(t:import('node:test').TestContext){
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
