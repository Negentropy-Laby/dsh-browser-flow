import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {it,type TestContext} from 'node:test'
import {mkdtemp,mkdir,open,writeFile,rm,rename,type FileHandle} from 'node:fs/promises'
import type {StatOptions} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {TaskStore} from '../src/task-store.ts'
import {expectRecord,expectNumber} from './helpers/assertions.ts'

async function fixture(t:TestContext,bytes=Buffer.alloc(4096,1)){
 const root=await mkdtemp(join(tmpdir(),'bf-artifact-')),store=new TaskStore(join(root,'tasks'),{name:'test',home:root},100)
 let writer:FileHandle|undefined
 t.after(async()=>{await writer?.close();await store.close();await rm(root,{recursive:true,force:true})})
 const access=await store.create('artifact-owner',{goal:'Synthetic bounded evidence',origins:['https://example.test']}),data=store.openTask(access)
 await mkdir(join(data.dir,'evidence',access.run.runId),{recursive:true})
 const path=join(data.dir,'evidence',access.run.runId,'synthetic.bin');await writeFile(path,bytes)
 const ref=await store.artifact(access,path,'snapshot');writer=await open(path,'r+')
 return {store,access,data,path,ref,writer,bytes}
}

async function observe(t:TestContext,writer:FileHandle,onSnapshot:()=>Promise<void>=async()=>{},onRead:()=>Promise<void>=async()=>{},chunkLimit=Infinity){
 // FileHandle hooks are restored by this test's mock tracker in its isolated process.
 const prototype=Object.getPrototypeOf(writer) as FileHandle,identity=await writer.stat({bigint:true})
 const stat=prototype.stat,read=prototype.read,readFile=prototype.readFile
 const seen=new Set<FileHandle>(),buffers=new Set<Buffer>();let readBytes=0,unboundedBytes=0,closed=0
 t.mock.method(prototype,'stat',async function(this:FileHandle,options?:StatOptions){
  const value=await stat.call(this,options)
  if(value.dev===identity.dev&&value.ino===identity.ino&&this!==writer&&!seen.has(this)){
   seen.add(this);const close=this.close.bind(this)
   t.mock.method(this,'close',async()=>{try{await close()}finally{closed++}})
   await onSnapshot()
  }
  return value
 })
 t.mock.method(prototype,'read',async function(this:FileHandle,buffer:Buffer,offset:number,length:number,position:number){
  if(!seen.has(this))return Reflect.apply(read,this,[buffer,offset,length,position])
  buffers.add(buffer);await onRead()
  const result=expectRecord(await Reflect.apply(read,this,[buffer,offset,Math.min(length,chunkLimit),position]))
  const bytesRead=expectNumber(result.bytesRead);readBytes+=bytesRead
  assert.equal(result.buffer,buffer);return {bytesRead,buffer}
 })
 t.mock.method(prototype,'readFile',async function(this:FileHandle,...args:Parameters<FileHandle['readFile']>){
  const bytes:unknown=await Reflect.apply(readFile,this,args)
  if(seen.has(this)){assert.ok(Buffer.isBuffer(bytes));unboundedBytes+=bytes.length}
  return bytes
 })
 return {buffers,get readBytes(){return readBytes},get unboundedBytes(){return unboundedBytes},get closed(){return closed},seen}
}

for(const size of [32,128])it(`bounds the allocation when a 4 KiB original grows to ${size} MiB after stat`,async t=>{
 const f=await fixture(t),probe=await observe(t,f.writer,()=>f.writer.truncate(size*1024*1024))
 const error:unknown=await f.store.readArtifact(f.data,f.ref).then(()=>undefined,error=>error)
 assert.ok(probe.unboundedBytes<=f.bytes.length+1,'reading to EOF allocated beyond the original size')
 assert.equal(probe.readBytes,f.bytes.length+1);assert.equal(probe.buffers.size,1)
 assert.ok([...probe.buffers].every(buffer=>buffer.length===f.bytes.length+1))
 assert.ok(error instanceof Error);assert.equal(error.message,'task-evidence-mismatch')
 assert.equal(probe.closed,1);assert.ok([...probe.seen].every(handle=>handle.fd===-1))
})
it('stops at the sentinel while the original keeps growing between short reads',async t=>{
 const f=await fixture(t);let size=f.bytes.length
 const probe=await observe(t,f.writer,async()=>{},async()=>{size+=1024*1024;await f.writer.truncate(size)},256)
 await assert.rejects(f.store.readArtifact(f.data,f.ref),/task-evidence-mismatch/)
 assert.equal(probe.readBytes,f.bytes.length+1);assert.equal(probe.buffers.size,1);assert.equal(probe.closed,1)
})
it('assembles short positioned reads without changing bytes or digest',async t=>{
 const f=await fixture(t,Buffer.from('中文😀 synthetic original')),probe=await observe(t,f.writer,async()=>{},async()=>{},3)
 assert.deepEqual(await f.store.readArtifact(f.data,f.ref),f.bytes)
 assert.equal(probe.readBytes,f.bytes.length);assert.equal(probe.buffers.size,1);assert.equal(probe.closed,1)
})
it('rejects truncation at EOF and closes its evidence handle',async t=>{
 const f=await fixture(t),probe=await observe(t,f.writer,()=>f.writer.truncate(f.bytes.length-1))
 await assert.rejects(f.store.readArtifact(f.data,f.ref),/task-evidence-mismatch/)
 assert.equal(probe.readBytes,f.bytes.length-1);assert.equal(probe.closed,1)
})
it('closes its evidence handle when the positioned read fails',async t=>{
 const f=await fixture(t),probe=await observe(t,f.writer,async()=>{},async()=>{throw new Error('synthetic read failure')})
 await assert.rejects(f.store.readArtifact(f.data,f.ref),/synthetic read failure/)
 assert.equal(probe.readBytes,0);assert.equal(probe.closed,1);assert.ok([...probe.seen].every(handle=>handle.fd===-1))
})
it('keeps growth bounded when discovering an artifact without a recorded digest',async t=>{
 const f=await fixture(t),probe=await observe(t,f.writer,()=>f.writer.truncate(32*1024*1024))
 await assert.rejects(f.store.artifact(f.access,f.path,'snapshot'),/task-evidence-mismatch/)
 assert.equal(probe.readBytes,f.bytes.length+1);assert.equal(probe.closed,1)
})
it('accepts the exact 16 MB limit and rejects larger or empty files before reading',async t=>{
 const f=await fixture(t,Buffer.alloc(16_000_000,3)),probe=await observe(t,f.writer)
 assert.deepEqual(await f.store.readArtifact(f.data,f.ref),f.bytes);assert.equal(probe.readBytes,16_000_000)
 for(const size of [16_000_001,0]){
  await f.writer.truncate(size)
  await assert.rejects(f.store.readArtifact(f.data,f.ref),/task-evidence-size/)
 }
 assert.equal(probe.readBytes,16_000_000);assert.equal(probe.closed,1)
})
it('retains digest and path identity checks after bounded reads',async t=>{
 const f=await fixture(t),probe=await observe(t,f.writer)
 await assert.rejects(f.store.readArtifact(f.data,{...f.ref,sha256:'0'.repeat(64)}),/task-evidence-mismatch/)
 const read=f.store.readArtifact.bind(f.store);let replaced=false
 const state=f.store.artifactState.bind(f.store)
 f.store.artifactState=async(...args)=>{
  if(!replaced&&probe.readBytes>=f.bytes.length*2){replaced=true;await writeFile(f.path+'.replacement',f.bytes);await rename(f.path+'.replacement',f.path)}
  return state(...args)
 }
 await assert.rejects(read(f.data,f.ref),/task-evidence-changed/)
 assert.equal(probe.closed,2)
})
it('reads a newly written proof through the same bounded artifact entry',async t=>{
 const f=await fixture(t),read=f.store.readArtifact.bind(f.store);let reads=0
 const proof={schemaVersion:1,kind:'synthetic',run:f.access.run},bytes=Buffer.from(JSON.stringify(proof)+'\n')
 f.store.readArtifact=async(...args)=>{reads++;assert.notEqual(args[2],false);assert.equal(args[1].sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(args[1].bytes,bytes.length);return read(...args)}
 const id=await f.store.proof(f.access,proof)
 assert.ok(f.data.events.some(event=>event.type==='asset'&&event.data.id===id));assert.equal(reads,1)
})
