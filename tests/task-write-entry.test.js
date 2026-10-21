import assert from 'node:assert/strict'
import { it } from 'node:test'
import { taskHost } from './helpers/task-host.js'

it('refuses direct write queue entry without the task-owned durable attempt',async t=>{
  const env=await taskHost(t);const task=(await env.task('a')).body.value.task;await env.authorize('a',task)
  const caller=env.service.resolveCaller({agent:env.agents.get('session-a')}).value
  const pending=env.service.dispatch(caller,{kind:'act',action:'click',target:{documentToken:'doc-a',elementRef:'el'}},new AbortController().signal)
  try{
    const taken=env.service.state.takeCommands('panel-a',1,env.service.config)
    assert.equal(taken.value.commands.length,0)
    assert.equal((await pending).error.code,'invalid_request')
  }finally{env.service.state.revoke({sessionId:'session-a'},'test cleanup');await pending}
})
