import assert from 'node:assert/strict'
import {test} from 'node:test'
import {decodePanelReply} from '../src/client-wire.ts'
import {TASK,TASK_VIEW} from './helpers/task-scope.ts'

test('panel decodes the existing unbound and bound poll responses',()=>{
  for(const task of [null,TASK_VIEW])assert.equal(decodePanelReply({ok:true,value:{protocolVersion:3,task,agent:{id:'session-1',instance:'opaque'},commands:[],dropped:[]}}).ok,true)
})
test('panel rejects malformed displayed fields before using them',()=>{
  for(const value of [{task:{task:TASK}},{agent:{id:'session-1',instance:7}},{controls:[42]},{pagePolicy:{adapter:'bjrsj',workflow:'import',kind:'other'}},{definitions:[{id:'sample',workflows:[{}]}]}])assert.equal(decodePanelReply({ok:true,value}).ok,false)
})
test('panel validates dispatched operations without changing the existing poll envelope',()=>{
  const command={protocolVersion:3,task:TASK,id:'command-1',leaseId:'lease-1',connectionGeneration:1,epoch:0,sequence:0,deadlineAt:1000,budgetMs:100,op:{kind:'observe',maxChars:100,maxNodes:5}}
  assert.equal(decodePanelReply({ok:true,value:{commands:[command]}}).ok,true)
  for(const patch of [{task:{}},{op:{kind:'arbitrary'}},{budgetMs:NaN}])assert.equal(decodePanelReply({ok:true,value:{commands:[{...command,...patch}]}}).ok,false)
})
