import { TASK, TASK_VIEW } from './helpers/task-scope.ts'
import assert from 'node:assert/strict'
import { describe,it } from 'node:test'
import { PROTOCOL_VERSION,validateCommand } from '../src/protocol.ts'
import { createTools } from '../src/tools.ts'
import { resolveConfig } from '../src/config.ts'
import { resolve } from 'node:path'

const command=op=>({kind:'command',protocolVersion:3,task:TASK,id:'c',leaseId:'l',connectionGeneration:1,epoch:0,sequence:0,deadlineAt:1000,op})
describe('authorized import wire and model interface',()=>{
  it('requires matching v3 peers',()=>assert.equal(PROTOCOL_VERSION,3))
  it('refuses an unresolved or remote private root at load',()=>{
    assert.throws(()=>resolveConfig({importEvidenceDir:'relative/private'}),/local absolute/)
    assert.throws(()=>resolveConfig({importEvidenceDir:'//server/share'}),/local absolute/)
    assert.equal(resolveConfig({importEvidenceDir:resolve('.cache/private')} ).importEvidenceDir,resolve('.cache/private'))
  })
  it('accepts fractional Host monotonic timestamps without comparing process clocks',()=>assert.equal(validateCommand({...command({kind:'observe',maxChars:8000,maxNodes:400}),deadlineAt:1000.25}).ok,true))
  it('adds one scoped action within the existing six tools',()=>{
    const tools=createTools({},resolveConfig());assert.equal(tools.length,6)
    const act=tools.find(t=>t.name==='browser_act')
    assert.ok(act.parameters.properties.action.enum.includes('set_file'))
    assert.ok(act.parameters.properties.fileGrantId)
    const observe=tools.find(t=>t.name==='browser_observe')
    assert.ok(observe.parameters.properties.view.enum.includes('bjrsj_import'))
  })
  it('accepts only a bounded complete file envelope, never arbitrary file paths',()=>{
    const file={fileGrantId:'g',name:'input.xlsx',expectedIdentity:{unitId:'UNIT1',legalIdentity:'123456789012345678'},sha256:'a'.repeat(64),base64:'eA==',bytes:1,kind:'add'}
    const op={kind:'act',action:'set_file',target:{documentToken:'d',elementRef:'e'},file,importOwner:'o',importScope:{kind:'add'},windowMs:25000}
    assert.equal(validateCommand(command(op)).ok,true)
    assert.equal(validateCommand(command({...op,file:{...file,bytes:10*1024*1024+1}})).ok,false)
    assert.equal(validateCommand(command({...op,file:{...file,path:'C:\\private.xlsx'}})).ok,false)
    assert.equal(validateCommand(command({...op,file:{...file,base64:'not base64'}})).ok,false)
    assert.equal(validateCommand(command({...op,file:undefined})).ok,false)
    const bytes=600_000
    assert.equal(validateCommand(command({...op,file:{...file,bytes,base64:Buffer.alloc(bytes).toString('base64')}})).ok,true)
    assert.equal(validateCommand(command({kind:'act',action:'type',target:op.target,value:'x'.repeat(bytes)})).ok,false)
  })
})
