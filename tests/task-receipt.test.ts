import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, type TestContext } from 'node:test'
import { TaskStore } from '../src/task-store.ts'

async function fixture(t: TestContext) {
  const root=await mkdtemp(join(tmpdir(),'bf-receipt-'))
  const profile={name:'test',home:join(root,'home')}
  const store=new TaskStore(root,profile,100)
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
  const access=await store.create('owner',{workflowRef:'generic',goal:'Synthetic receipt',origins:['https://one.example']})
  return {store,access,root,profile}
}

it('rejects duplicate and wrong-attempt unknown receipts without changing durable or live state',async t=>{
  const {store,access,root,profile}=await fixture(t)
  const attempt=await store.beginAttempt(access,'click')
  await store.receipt(access,attempt,'executed')
  const count=store.openTask(access).events.length
  for(const id of [attempt,'attempt-wrong']){
    await assert.rejects(store.receipt(access,id,'unknown_outcome'),{code:'invalid_request'})
    assert.equal(store.openTask(access).blocked,false)
    assert.equal(store.openTask(access).events.length,count)
    assert.doesNotThrow(()=>store.openTask(access,true))
  }
  await store.close()
  const recovered=new TaskStore(root,profile,100);t.after(()=>recovered.close())
  assert.equal(recovered.openTask(await recovered.forSession('owner')).blocked,false)
})

it('blocks a valid unknown receipt only after its journal append and preserves it across restart',async t=>{
  const {store,access,root,profile}=await fixture(t)
  const attempt=await store.beginAttempt(access,'click')
  let release=()=>{},entered=()=>{}
  const gate=new Promise<void>(resolve=>{release=resolve})
  const ready=new Promise<void>(resolve=>{entered=resolve})
  const append=store.appendOwned.bind(store)
  store.appendOwned=async(data,type,payload)=>{if(type==='receipt'){entered();await gate}return append(data,type,payload)}
  const settled=store.receipt(access,attempt,'unknown_outcome')
  await ready
  try{assert.equal(store.openTask(access).blocked,false)}finally{release();await settled}
  assert.equal(store.openTask(access).blocked,true)
  await assert.rejects(store.receipt(access,attempt,'executed'),{code:'invalid_request'})
  assert.equal(store.openTask(access).blocked,true)
  await store.close()
  const recovered=new TaskStore(root,profile,100);t.after(()=>recovered.close())
  assert.equal(recovered.openTask(await recovered.forSession('owner')).blocked,true)
})

it('serializes competing receipts without letting the losing receipt block a known result',async t=>{
  const {store,access}=await fixture(t)
  const attempt=await store.beginAttempt(access,'click')
  const results=await Promise.allSettled([store.receipt(access,attempt,'executed'),store.receipt(access,attempt,'unknown_outcome')])
  assert.equal(results[0]?.status,'fulfilled')
  assert.equal(results[1]?.status,'rejected')
  assert.equal(store.openTask(access).blocked,false)
  assert.equal(store.openTask(access).events.filter(event=>event.type==='receipt').length,1)
})

it('blocks writes on real journal failure and recovers the unsettled attempt conservatively',async t=>{
  const {store,access,root,profile}=await fixture(t)
  const attempt=await store.beginAttempt(access,'click')
  const path=join(store.openTask(access).dir,'basic_law_index/events.jsonl'),saved=path+'.preserved'
  await rename(path,saved);await mkdir(path)
  await assert.rejects(store.receipt(access,attempt,'unknown_outcome'),{code:'task_storage_failed'})
  assert.equal(store.openTask(access).blocked,true)
  assert.equal(store.openTask(access).unhealthy,true)
  await rm(path,{recursive:true});await rename(saved,path)
  await store.close()
  const recovered=new TaskStore(root,profile,100);t.after(()=>recovered.close())
  assert.equal(recovered.openTask(await recovered.forSession('owner')).blocked,true)
})
