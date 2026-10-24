import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ImportFiles} from '../src/import-files.ts'
import {GenericFiles} from '../src/generic-files.ts'
import {FileGrantCollection} from '../src/file-grants.ts'
import {workbook,scope} from './import-fixture.ts'
for(const mode of ['generic','legacy'] as const)test(`${mode} shared grants reject foreign leases, retire bindings and consume before concurrent IO`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'bf-grants-')),files=mode==='generic'?new GenericFiles():new ImportFiles(join(root,'private'))
 t.after(async()=>{await files.close();await rm(root,{recursive:true,force:true})})
 const lease={id:'l',state:'active',agent:{},sessionId:'owner',connectionInstanceId:'p',connectionGeneration:1,epoch:0,documentToken:'doc',evidenceRoot:join(root,'private')},path=join(root,mode==='generic'?'data.json':'data.xlsx')
 await writeFile(path,mode==='generic'?Buffer.from('{"rows":[1]}'):workbook())
 const prepare=()=>files instanceof ImportFiles?files.prepare(lease,path,scope):files.prepare(lease,path)
 let p=await prepare();assert.throws(()=>files.confirm({...lease,agent:{}},p.fileGrantId),/binding/)
 files.confirm(lease,p.fileGrantId)
 const outcomes=await Promise.allSettled([files.dispatch(lease,p.fileGrantId),files.dispatch(lease,p.fileGrantId)])
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1)
 lease.epoch++;new FileGrantCollection([files]).prune();assert.equal(files.current(lease),undefined)
 p=await prepare();files.confirm(lease,p.fileGrantId);lease.state='revoked'
 new FileGrantCollection([files]).prune();assert.equal(files.current(lease),undefined)
 await assert.rejects(files.dispatch(lease,p.fileGrantId),/missing/)
 await files.close();await assert.rejects(prepare(),/unavailable/)
})
