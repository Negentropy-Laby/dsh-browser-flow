import assert from 'node:assert/strict'
import { it } from 'node:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TaskStore } from '../src/task-store.ts'
import { validateDefinition } from '../src/task-definitions.ts'
import { taskHost } from './helpers/task-host.ts'
import { syntheticDefinition } from './helpers/task-definition.ts'
import { expectFailure, expectList, expectOk, expectRecord, expectString, present } from './helpers/assertions.ts'

const names=['coverage','graph','goal','criteria','waiting','digest-synthetic','resource-synthetic','asset-synthetic','attempt-synthetic','receipt-synthetic','criterion-synthetic','goal-synthetic','ordinary.txt']
async function definition(root:string) {
  const fixture=syntheticDefinition({root})
  const value={...fixture.definition,resources:names,workflows:[{...fixture.definition.workflows[0]!,instructions:['coverage'],resources:names.slice(1)}]}
  await writeFile(join(fixture.dir,'definition.json'),JSON.stringify(value))
  for(const name of names)await writeFile(join(fixture.dir,name),'Synthetic snapshot '+name+' 中文😀')
  return fixture
}

it('separates every reserved snapshot name from system and generated task details',async t=>{
  const env=await taskHost(t);await definition(env.root)
  await env.task('a',{definitionId:'synthetic',workflowRef:'read',goal:'Synthetic namespace task'})
  const store=env.service.tasks,access=present(store.current('session-a'))
  for(const name of names){
    const reply=expectRecord(expectOk(await env.tool('a','browser_observe',{view:'task',ref:'definition:'+name})))
    const value=expectRecord(JSON.parse(expectString(reply.text)))
    assert.equal(value.name,name);assert.equal(value.text,'Synthetic snapshot '+name+' 中文😀');assert.equal(value.source,'definition_snapshot')
  }
  for(const name of ['coverage','goal','criteria','waiting','graph']){
    const reply=expectRecord(await store.detail(access,name,0,10000))
    assert.notEqual((JSON.parse(expectString(reply.text)) as {source?:string}).source,'definition_snapshot')
  }
  for(const name of names.filter(n=>n.includes('-')))await assert.rejects(store.detail(access,name,0,10000),{code:'task_not_bound'})
  const old=expectRecord(await store.detail(access,'ordinary.txt',0,10000))
  assert.equal(expectRecord(JSON.parse(expectString(old.text))).text,'Synthetic snapshot ordinary.txt 中文😀')
})

it('advertises explicit snapshot refs and keeps bounded character continuation',async t=>{
  const env=await taskHost(t);await definition(env.root)
  await env.task('a',{definitionId:'synthetic',workflowRef:'read',goal:'Synthetic namespace task'})
  const store=env.service.tasks,access=present(store.current('session-a')),summary=await env.service.taskSummary(access)
  assert.deepEqual(summary.resources,names.map(n=>'definition:'+n))
  assert.equal(expectRecord(expectList(summary.instructions)[0]).ref,'definition:coverage')
  const first=expectRecord(await store.detail(access,'definition:coverage',0,17))
  const rest=expectRecord(await store.detail(access,'definition:coverage',17,10000))
  assert.equal(expectRecord(JSON.parse(expectString(first.text)+expectString(rest.text))).text,'Synthetic snapshot coverage 中文😀')
})

it('resolves only the bound whitelist and preserves colliding files across recovery',async t=>{
  const env=await taskHost(t);await definition(env.root)
  await env.task('a',{definitionId:'synthetic',workflowRef:'read',goal:'Synthetic namespace task'})
  await env.task('b')
  assert.equal(expectFailure(await env.tool('b','browser_observe',{view:'task',ref:'definition:coverage'})).code,'task_not_bound')
  const store=env.service.tasks,access=present(store.current('session-a'))
  for(const ref of ['definition:missing','definition:../coverage','definition:/coverage','definition:definition.json'])await assert.rejects(store.detail(access,ref,0,100),{code:'task_not_bound'})
  const before=expectRecord(await store.detail(access,'definition:coverage',0,10000))
  await store.close()
  const recovered=new TaskStore(env.root,env.ctx.profileContext,100);t.after(()=>recovered.close())
  const next=await recovered.forSession('session-a')
  assert.equal((await recovered.detail(next,'definition:coverage',0,10000) as {text:string}).text,before.text)
  assert.equal(recovered.openTask(next).readOnly,false)
})

it('continues rejecting colon resource names on every platform',()=>{
  for(const name of ['graph:assets','graph:exploration','definition:coverage'])assert.throws(()=>validateDefinition({schemaVersion:1,id:'synthetic',version:'1',adapter:'generic',adapterVersion:1,origins:['https://example.test'],resources:[name],workflows:[]}),/task-definition-invalid/)
})
