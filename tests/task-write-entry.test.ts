import {expectOk,expectFailure} from './helpers/assertions.ts'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { taskHost } from './helpers/task-host.ts'

it('refuses direct write queue entry without the task-owned durable attempt',async t=>{
  const env=await taskHost(t);const task=(await env.task('a')).body.value.task;await env.authorize('a',task)
  const caller=expectOk(env.service.resolveCaller({agent:env.agents.get('session-a')}))
  const pending=env.service.dispatch(caller,{kind:'act',action:'click',target:{documentToken:'doc-a',elementRef:'el'}},new AbortController().signal)
  try{
    const taken=env.service.state.takeCommands('panel-a',1,env.service.config)
    assert.equal(expectOk(taken).commands.length,0)
    assert.equal(expectFailure((await pending)).code,'invalid_request')
  }finally{env.service.state.revoke({sessionId:'session-a'},'test cleanup');await pending}
})
