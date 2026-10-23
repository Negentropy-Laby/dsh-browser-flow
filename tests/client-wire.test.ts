import assert from 'node:assert/strict'
import {test} from 'node:test'
import {decodePanelReply,isFilePreview} from '../src/client-wire.ts'
import {TASK,TASK_VIEW} from './helpers/task-scope.ts'

test('panel decodes the existing unbound and bound poll responses',()=>{
  for(const task of [null,TASK_VIEW] as const)assert.equal(decodePanelReply({ok:true,value:{protocolVersion:4,task,agent:{id:'session-1',instance:'opaque'},commands:[],dropped:[]}}).ok,true)
})
test('panel rejects malformed displayed fields before using them',()=>{
  for(const value of [{task:{task:TASK}},{agent:{id:'session-1',instance:7}},{controls:[42]},{pagePolicy:{adapter:'bjrsj',workflow:'import',kind:'other'}},{definitions:[{id:'sample',workflows:[{}]}]}] as const)assert.equal(decodePanelReply({ok:true,value}).ok,false)
})
test('validates task origins and journal position before initializing an edit draft',()=>{
  assert.equal(decodePanelReply({ok:true,value:{task:{...TASK_VIEW,state:'read_only',contextVersion:0}}}).ok,true)
  for(const patch of [{origins:[42]},{origins:['https://example.test/path']},{contextVersion:-1},{contextVersion:0.5}])assert.equal(decodePanelReply({ok:true,value:{task:{...TASK_VIEW,...patch}}}).ok,false)
})
test('panel validates dispatched operations without changing the existing poll envelope',()=>{
  const command={protocolVersion:4,task:TASK,id:'command-1',leaseId:'lease-1',connectionGeneration:1,epoch:0,sequence:0,deadlineAt:1000,budgetMs:100,op:{kind:'observe',maxChars:100,maxNodes:5}}
  assert.equal(decodePanelReply({ok:true,value:{commands:[command]}}).ok,true)
  for(const patch of [{task:{}},{op:{kind:'arbitrary'}},{budgetMs:NaN}] as const)assert.equal(decodePanelReply({ok:true,value:{commands:[{...command,...patch}]}}).ok,false)
})

test('optional panel fields keep their declared JSON types',()=>{
  assert.equal(decodePanelReply({ok:true,value:{pagePolicy:{adapter:'bjrsj',workflow:'import',kind:['add']}}}).ok,false)
  assert.equal(decodePanelReply({ok:true,value:{agent:{id:'session-1',instance:'opaque',authorizedLeaseCount:'1'}}}).ok,false)
  const preview={fileGrantId:'opaque',path:'synthetic.xlsx',sha256:'a'.repeat(64),bytes:1,rows:1,kind:'add'}
  assert.equal(isFilePreview({...preview,confirmed:'yes'}),false)
  assert.equal(isFilePreview({...preview,confirmed:true}),true)
  for(const patch of [{path:''},{kind:'unknown'},{rows:-1},{bytes:0.5},{sha256:'incomplete'}])assert.equal(isFilePreview({...preview,...patch}),false)
})
