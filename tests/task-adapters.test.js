import assert from 'node:assert/strict'
import { it } from 'node:test'
import { navigationVerdict, pagePolicy } from '../src/task-adapters.js'
import { validateDefinition } from '../src/task-definitions.js'
import { taskHost } from './helpers/task-host.js'
import { syntheticDefinition } from './helpers/task-definition.js'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const observation={url:'https://fuwu.rsj.beijing.gov.cn/zhrs/yltc/information-third-new/imp',documentToken:'current',nodes:['模板下载','上传申报信息','批量增员','批量修改','批量减员'].map(text=>({text}))}
it('uses trusted Beijing predicates only for their exact adapter and workflow',()=>{
  const manifest={adapter:'bjrsj',adapterVersion:1,workflowRef:'navigation'}
  assert.equal(navigationVerdict(manifest,observation).verdict,'entry_reached')
  for(const page of [{...observation,url:'https://other.example/information-third-new/imp'},{...observation,url:observation.url+'ersonate'},{...observation,nodes:observation.nodes.slice(1)}])assert.equal(navigationVerdict(manifest,page).verdict,'unverified')
  for(const origin of ['https://one.example','https://two.example']){
    const generic={...manifest,adapter:'generic',origins:[origin]}
    assert.equal(pagePolicy(generic),undefined)
    assert.equal(navigationVerdict(generic,observation).verdict,'unverified')
  }
})
it('does not let a local definition change trusted workflow stop conditions',()=>{
  const base={schemaVersion:1,id:'synthetic',version:'1',adapter:'bjrsj',adapterVersion:1,origins:['https://fuwu.rsj.beijing.gov.cn'],resources:['steps.md'],workflows:[{id:'navigation',skill:'synthetic-navigation',description:'Synthetic',instructions:['steps.md'],resources:[],stopBoundary:'before_file_selection'}]}
  assert.equal(validateDefinition(base).adapter,'bjrsj')
  assert.throws(()=>validateDefinition({...base,workflows:[{...base.workflows[0],stopBoundary:'after_submit'}]}))
  assert.throws(()=>validateDefinition({...base,workflows:[{...base.workflows[0],id:'arbitrary_script'}]}))
})
it('keeps a navigation task before file selection and carries its policy into every page command',async t=>{
  const env=await taskHost(t)
  const def=syntheticDefinition({root:env.root})
  await writeFile(join(def.dir,'definition.json'),JSON.stringify({...def.definition,adapter:'bjrsj',origins:['https://fuwu.rsj.beijing.gov.cn'],workflows:def.definition.workflows.map(row=>({...row,id:'navigation',stopBoundary:'before_file_selection'}))}))
  const page={...env.page('a'),url:observation.url}
  await env.post('hello',{kind:'hello',connectionGeneration:1,sessionId:'session-a',panel:{instanceId:'panel-a',pages:[page]}})
  const created=await env.post('authorize',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',taskOperation:'create',spec:{definitionId:'synthetic',workflowRef:'navigation',goal:'Synthetic entry test'}})
  assert.equal(created.status,200)
  const auth=await env.post('authorize',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',...page})
  assert.deepEqual(auth.body.value.pagePolicy,{adapter:'bjrsj',workflow:'navigation'})
  assert.equal((await env.post('authorize',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',...page,fileOperation:'prepare',path:'/no-read.xlsx'})).body.error.code,'task_scope_mismatch')
  const pending=env.tool('a','browser_observe')
  const poll=await env.post('poll',{instanceId:'panel-a',connectionGeneration:1,sessionId:'session-a',pages:[page]})
  const command=poll.body.value.commands[0]
  assert.deepEqual(command.op.pagePolicy,auth.body.value.pagePolicy)
  await env.post('result',{kind:'result',task:command.task,id:command.id,leaseId:command.leaseId,instanceId:'panel-a',connectionGeneration:1,epoch:command.epoch,sequence:command.sequence,outcome:'ok',payload:{...observation,documentToken:'doc-a'}})
  const result=await pending
  assert.equal(result.value.navigation.verdict,'entry_reached')
  const view=await env.tool('a','browser_observe',{view:'task'})
  assert.equal(view.value.businessVerdict,'entry_reached')
  assert.equal(view.value.taskState,'active','reaching a navigation entry does not certify the full task')
})
