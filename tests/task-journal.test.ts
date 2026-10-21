import assert from 'node:assert/strict'
import { it, type TestContext } from 'node:test'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { TaskStore } from '../src/task-store.ts'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
async function fixture(t: TestContext) {
  const root=await mkdtemp(join(tmpdir(),'bf-journal-'))
  const profile={name:'test',home:join(root,'home')}
  const store=new TaskStore(root,profile,100)
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
  const access=await store.create('owner',{goal:'Synthetic history',origins:['https://one.example']})
  const dir=store.openTask(access).dir
  const journal=join(dir,'basic_law_index/events.jsonl')
  assert.ok(store.runtime)
  return {root,profile,store,access,dir,journal,runtime:store.runtime}
}
async function reopen(t: TestContext,f: Awaited<ReturnType<typeof fixture>>) {
  const store=new TaskStore(f.root,f.profile,100)
  t.after(()=>store.close())
  return {store,access:await store.forSession('owner')}
}
it('versions the manifest, ownership record and every hash-linked event',async t=>{
  const f=await fixture(t)
  assert.equal(JSON.parse(await readFile(join(f.dir,'manifest.json'),'utf8')).schemaVersion,1)
  const registry=join(f.runtime,'registry')
  assert.equal(JSON.parse(await readFile(join(registry,(await readdir(registry))[0]),'utf8')).schemaVersion,1)
  const [event]=(await readFile(f.journal,'utf8')).trim().split('\n').map(line=>JSON.parse(line))
  assert.equal(event.schemaVersion,1)
  const {hash,...unsigned}=event
  assert.equal(hash,digest(unsigned))
})
it('rejects unknown live event semantics before appending any bytes',async t=>{
  const f=await fixture(t),before=await readFile(f.journal)
  await assert.rejects(f.store.append(f.access,'future_write',{run:f.access.run}),{code:'invalid_request'})
  assert.deepEqual(await readFile(f.journal),before)
})
it('blocks only the affected task for well-hashed unknown events, versions and invalid write payloads',async t=>{
  for(const patch of [{type:'future_write'},{schemaVersion:99},{data:{attemptId:'attempt-unknown',action:77}}]){
    const f=await fixture(t)
    const attempt=await f.store.beginAttempt(f.access,'click')
    await f.store.receipt(f.access,attempt,'not_executed')
    await f.store.close()
    const rows=(await readFile(f.journal,'utf8')).trim().split('\n').map(line=>JSON.parse(line))
    const last=rows.at(-1)
    const unsigned={...(last.schemaVersion===undefined?{}:{schemaVersion:last.schemaVersion}),seq:last.seq+1,prev:last.hash,type:'attempt',data:{attemptId:'attempt-unknown',action:'click',run:f.access.run},...patch}
    rows.push({...unsigned,hash:digest(unsigned)})
    await writeFile(f.journal,rows.map(row=>JSON.stringify(row)).join('\n')+'\n')
    const before=await readFile(f.journal),restored=await reopen(t,f)
    assert.throws(()=>restored.store.openTask(restored.access,true),{code:'task_write_blocked'})
    assert.ok(restored.store.openTask(restored.access).storageIssue)
    await restored.store.create('independent',{goal:'Independent',origins:['https://two.example']})
    assert.deepEqual(await readFile(f.journal),before)
  }
})
it('retains unversioned history and Session ownership read-only without promoting old success',async t=>{
  const f=await fixture(t)
  await f.store.close()
  const manifest=JSON.parse(await readFile(join(f.dir,'manifest.json'),'utf8'));delete manifest.schemaVersion
  await writeFile(join(f.dir,'manifest.json'),JSON.stringify(manifest)+'\n')
  const registry=join(f.runtime,'registry'),path=join(registry,(await readdir(registry))[0])
  const owner=JSON.parse(await readFile(path,'utf8'));delete owner.schemaVersion
  await writeFile(path,JSON.stringify(owner)+'\n')
  const created={seq:1,prev:'',type:'created',data:{manifest}}
  const first={...created,hash:digest(created)}
  const verdict={seq:2,prev:first.hash,type:'business_verdict',data:{source:'code_verified',qualified:true,verdict:'import_confirmed',run:f.access.run}}
  await writeFile(f.journal,JSON.stringify(first)+'\n'+JSON.stringify({...verdict,hash:digest(verdict)})+'\n')
  const before=await readFile(f.journal),restored=await reopen(t,f)
  assert.equal(restored.store.openTask(restored.access).readOnly,true)
  assert.throws(()=>restored.store.openTask(restored.access,true),{code:'task_read_only'})
  assert.equal((await restored.store.view(restored.access,8000)).active_context.businessVerdict,'unverified')
  await assert.rejects(restored.store.create('owner',{goal:'Replacement',origins:['https://one.example']}),{code:'task_bound'})
  await assert.rejects(restored.store.revise(restored.access,{newRun:true}),{code:'task_read_only'})
  await restored.store.end(restored.access,'handed_off')
  assert.deepEqual(await readFile(f.journal),before)
  assert.equal(restored.store.openTask(restored.access).state,'active')
})
