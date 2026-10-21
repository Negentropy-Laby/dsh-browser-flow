import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { it, type TestContext } from 'node:test'
import { TaskStore } from '../src/task-store.ts'
import { syntheticDefinition } from './helpers/task-definition.ts'

const spec={goal:'Synthetic creation',origins:['https://one.example']}
async function fixture(t:TestContext){
  const root=await mkdtemp(join(tmpdir(),'bf-create-')),profile={name:'test',home:join(root,'home')}
  const store=new TaskStore(root,profile,100)
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
  await store.initialize()
  assert.ok(store.runtime)
  return {store,root,profile,runtime:store.runtime}
}
async function entries(path:string){try{return await readdir(path)}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ENOENT')return [];throw error}}

for(const stage of ['manifest','journal','registry'] as const)it(`removes only its unregistered new directory after ${stage} failure and permits safe retry`,async t=>{
  const {store,runtime,root,profile}=await fixture(t)
  const write=store.writeNew.bind(store),append=store.appendOwned.bind(store)
  store.writeNew=async(path,value)=>{if((stage==='manifest'&&basename(path)==='manifest.json')||(stage==='registry'&&path.includes('registry')))throw new Error('synthetic failure');return write(path,value)}
  store.appendOwned=async(data,type,value)=>{if(stage==='journal'&&type==='created')throw new Error('synthetic failure');return append(data,type,value)}
  await assert.rejects(store.create('owner',spec),{code:'task_storage_failed'})
  assert.deepEqual(await entries(join(runtime,'tasks')),[])
  store.writeNew=write;store.appendOwned=append
  const retry=await store.create('owner',spec)
  assert.equal((await entries(join(runtime,'tasks'))).length,1)
  await store.close()
  const recovered=new TaskStore(root,profile,100);t.after(()=>recovered.close())
  assert.equal((await recovered.forSession('owner')).scope.taskId,retry.scope.taskId)
})

it('preserves a registry written before an error, contains that Session and recovers its sole binding',async t=>{
  const {store,runtime,root,profile}=await fixture(t)
  const write=store.writeNew.bind(store)
  store.writeNew=async(path,value)=>{await write(path,value);if(path.includes('registry'))throw new Error('synthetic post-write error')}
  await assert.rejects(store.create('owner',spec),{code:'task_storage_failed'})
  const dirs=await entries(join(runtime,'tasks')),registry=await entries(join(runtime,'registry'))
  assert.equal(dirs.length,1);assert.equal(registry.length,1)
  const bytes=await readFile(join(runtime,'registry',registry[0]!))
  await assert.rejects(store.create('owner',spec),{code:'task_storage_failed'})
  assert.deepEqual(await entries(join(runtime,'tasks')),dirs)
  assert.deepEqual(await readFile(join(runtime,'registry',registry[0]!)),bytes)
  store.writeNew=write
  await store.create('other',spec)
  await store.close()
  const recovered=new TaskStore(root,profile,100);t.after(()=>recovered.close())
  assert.equal((await recovered.forSession('owner')).scope.taskId,dirs[0])
})

it('does not resurrect unregistered directories during recovery',async t=>{
  const {store,runtime,root,profile}=await fixture(t)
  const registered=await store.create('registered',spec)
  await mkdir(join(runtime,'tasks','orphan'))
  await writeFile(join(runtime,'tasks','orphan','private-history'),'preserve')
  await store.close()
  const recovered=new TaskStore(root,profile,100);t.after(()=>recovered.close())
  await assert.rejects(recovered.forSession('orphan'),{code:'task_not_bound'})
  assert.equal((await recovered.forSession('registered')).scope.taskId,registered.scope.taskId)
  assert.equal(await readFile(join(runtime,'tasks','orphan','private-history'),'utf8'),'preserve')
})

it('cleans its unregistered definition snapshot when manifest persistence fails',async t=>{
  const {store,root,runtime}=await fixture(t),def=syntheticDefinition({root})
  const write=store.writeNew.bind(store)
  store.writeNew=async(path,value)=>{if(basename(path)==='manifest.json')throw new Error('synthetic failure');return write(path,value)}
  await assert.rejects(store.create('owner',{definitionId:def.definition.id,workflowRef:'read',goal:'Synthetic'}),{code:'task_storage_failed'})
  assert.deepEqual(await entries(join(runtime,'tasks')),[])
  assert.ok(await readFile(join(def.dir,'definition.json')))
})

for(const failure of ['unknown_registration','cleanup'] as const)it(`retains uncertain creation on ${failure}, blocks duplicate creation and isolates other Sessions`,async t=>{
  const {store,runtime}=await fixture(t)
  const write=store.writeNew.bind(store),registration=store.registrationState.bind(store),remove=store.removeNewDirectory.bind(store)
  store.writeNew=async(path,value)=>{if(path.includes('registry'))throw new Error('synthetic registration failure');return write(path,value)}
  if(failure==='unknown_registration')store.registrationState=async()=> 'unknown'
  else store.removeNewDirectory=async()=>{throw new Error('synthetic cleanup failure')}
  await assert.rejects(store.create('owner',spec),{code:'task_storage_failed'})
  const dirs=await entries(join(runtime,'tasks'));assert.equal(dirs.length,1)
  await assert.rejects(store.create('owner',spec),{code:'task_storage_failed'})
  assert.deepEqual(await entries(join(runtime,'tasks')),dirs)
  store.writeNew=write;store.registrationState=registration;store.removeNewDirectory=remove
  await store.create('other',spec)
  assert.equal((await entries(join(runtime,'tasks'))).length,2)
})

it('cleans a partially written snapshot but leaves the local definition and pre-existing directories untouched',async t=>{
  const {store,root,runtime}=await fixture(t),def=syntheticDefinition({root})
  await mkdir(join(runtime,'tasks'),{recursive:true})
  const existing=join(runtime,'tasks','existing-history');await mkdir(existing);await writeFile(join(existing,'keep'),'original')
  const directory=store.directory.bind(store)
  store.directory=async path=>{
    await directory(path)
    if(basename(path).startsWith('task-'))await mkdir(join(path,'definition-snapshot','instructions','steps.md'),{recursive:true})
  }
  await assert.rejects(store.create('owner',{definitionId:def.definition.id,workflowRef:'read',goal:'Synthetic'}),{code:'task_storage_failed'})
  assert.deepEqual(await entries(join(runtime,'tasks')),['existing-history'])
  assert.equal(await readFile(join(existing,'keep'),'utf8'),'original')
  assert.ok(await readFile(join(def.dir,'definition.json')))
})

it('never deletes an existing registry record when exclusive registration fails',async t=>{
  const {store,runtime}=await fixture(t)
  const existing=await store.create('original',spec),write=store.writeNew.bind(store)
  let registryPath=''
  const originalRecord=JSON.stringify({schemaVersion:1,sessionId:'owner',taskId:existing.scope.taskId,profileId:existing.scope.profileId})+'\n'
  store.writeNew=async(path,value)=>{
    if(path.includes('registry')){registryPath=path;await writeFile(path,originalRecord,{flag:'wx'});return write(path,value)}
    return write(path,value)
  }
  await assert.rejects(store.create('owner',spec),{code:'task_storage_failed'})
  assert.equal(await readFile(registryPath,'utf8'),originalRecord)
  assert.equal((await entries(join(runtime,'tasks'))).length,2)
  assert.equal(store.openTask(existing).state,'active')
  await assert.rejects(store.create('owner',spec),{code:'task_storage_failed'})
})
