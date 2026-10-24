import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readBounded,FILE_LIMIT} from '../src/file-core.ts'
import {ImportFiles} from '../src/import-files.ts'
import {GenericFiles} from '../src/generic-files.ts'
import {taskFileMode} from '../src/task-scope.ts'
import {workbook,scope} from './import-fixture.ts'
import {taskHost} from './helpers/task-host.ts'
test('file capability depends on generation and adapter, never just workflow name',async t=>{
 assert.equal(taskFileMode({schemaVersion:1,adapter:'generic',workflowRef:'exploration'}),'none')
 assert.equal(taskFileMode({schemaVersion:2,adapter:'generic',workflowRef:'exploration'}),'generic')
 assert.equal(taskFileMode({schemaVersion:1,adapter:'bjrsj',workflowRef:'import'}),'legacy_import')
 const h=await taskHost(t);await h.task('a',{goal:'Explore',origins:['https://example.test']})
 const a=await h.service.tasks.forSession('session-a');assert.equal((await h.service.taskSummary(a)).fileMode,'generic')
 await h.task('b');const b=await h.service.tasks.forSession('session-b')
 await assert.rejects(h.service.tasks.fileView(b,'asset-any',0,8000),{code:'unsupported'})
})
test('file limits are explicit and legacy import rejects oversized input before parsing',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bf-file-limit-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const path=join(root,'input.xlsx'),legacy=new ImportFiles(join(root,'private')),generic=new GenericFiles()
 t.after(async()=>{await legacy.close();await generic.close()})
 const lease={id:'l',state:'active',agent:{},sessionId:'s',connectionInstanceId:'p',connectionGeneration:1,epoch:0,documentToken:'d',evidenceRoot:join(root,'generic')}
 await writeFile(path,Buffer.alloc(12_000_000,65))
 await assert.rejects(legacy.prepare(lease,path,scope),/file-size-or-type-invalid/)
 assert.equal((await readBounded(path)).length,12_000_000)
 await assert.rejects(readBounded(path,10*1024*1024),/file-size-or-type-invalid/)
 const genericPath=join(root,'large.txt');await writeFile(genericPath,'a'.repeat(12_000_000))
 assert.equal((await generic.prepare(lease,genericPath)).bytes,12_000_000)
 await writeFile(path,workbook());const preview=await legacy.prepare(lease,path,scope);legacy.confirm(lease,preview.fileGrantId)
 await writeFile(path,Buffer.alloc(10*1024*1024+1,65))
 await assert.rejects(legacy.dispatch(lease,preview.fileGrantId),/file-size-or-type-invalid/)
 await writeFile(path,Buffer.alloc(FILE_LIMIT+1,65));await assert.rejects(readBounded(path),/file-size-or-type-invalid/)
})
test('bounded reads allocate only file bytes plus the growth probe',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bf-file-allocation-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const path=join(root,'small.txt');await writeFile(path,'small')
 const alloc=Buffer.alloc,sizes:number[]=[];t.mock.method(Buffer,'alloc',(...args:Parameters<typeof Buffer.alloc>)=>{sizes.push(args[0]);return alloc(...args)})
 assert.equal((await readBounded(path)).toString(),'small');assert.deepEqual(sizes,[6])
})
