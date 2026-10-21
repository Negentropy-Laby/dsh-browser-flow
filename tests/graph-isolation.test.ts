import {present,expectRecord,expectList,expectString} from './helpers/assertions.ts'
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { taskHost } from './helpers/task-host.ts'
import { graphInput } from '../src/task-projections.ts'
import { GraphWorkers } from '../src/graph/worker.ts'
import { validateView, validateDetail } from '../src/graph/validation.ts'

it('excludes private original data and paths from graph input, replies and cross-task views',async t=>{
 const env=await taskHost(t);await env.task('a');await env.task('b')
 const store=env.service.tasks,a=store.current('session-a'),b=store.current('session-b')
 await store.asset(present(a),'file',{path:'/private/task-a/input.xlsx',person:'PERSON_A',sha256:'a'.repeat(64)})
 await store.asset(present(b),'page',{private:'PERSON_B',documentToken:'doc-b'})
 const safe=graphInput(store.openTask(present(a)),env.service.config)
 assert.ok(!JSON.stringify(safe).includes('PERSON_A'));assert.ok(!JSON.stringify(safe).includes('/private/'))
 const first=await store.view(present(a),50000),second=await store.view(present(b),50000)
 assert.equal(first.active_context.graph.status,'ready');assert.equal(second.active_context.graph.status,'ready')
 assert.ok(!JSON.stringify(first).includes('PERSON_B'));assert.ok(!JSON.stringify(second).includes(present(a).scope.taskId))
 // A worker receives and returns only its four derived modules.
 const view=await env.service.graph.project(safe,50000,()=>true),hash=first.active_context.graph.projectionId
 const bad=structuredClone(view);expectRecord(expectList(expectRecord(bad.knowledge_graph).nodes)[0]).id='asset-foreign'
 assert.throws(()=>validateView(bad,safe,present(hash)),/invalid_projection/)
 const fake=structuredClone(view);expectRecord(fake.procedural_law_index).criteria=[{id:'fake',status:'passed',source:'code_verified'}]
 assert.throws(()=>validateView(fake,safe,present(hash)),/invalid_projection/)
 const detail=await env.service.graph.detail(safe,'graph',()=>true);expectRecord(expectRecord(expectList(expectRecord(detail).nodes)[0]).data).goal='FOREIGN_SECRET'
 assert.throws(()=>validateDetail(detail,'graph',safe,present(hash)),/invalid_projection/)
})
it('keeps Host criteria, waits and permission withdrawal usable when graph is unavailable',async t=>{
 const env=await taskHost(t);await env.task('a');await env.authorize('a')
 const store=env.service.tasks,a=store.current('session-a')
 await env.service.graph.close()
 const view=await env.tool('a','browser_observe',{view:'task'})
 assert.equal(view.ok,true);assert.equal(expectRecord(expectRecord(expectRecord(view.value).active_context).graph).status,'unavailable')
 assert.equal(expectRecord(view.value).businessVerdict,'unverified')
 assert.equal((await env.tool('a','browser_release')).ok,true)
 assert.equal((await env.tool('a','browser_observe')).ok,false)
 assert.equal((await env.tool('a','browser_act',{action:'await_user',wait:{kind:'other_user_input',reason:'Synthetic confirmation',resumeCondition:'A new user response'}})).ok,true)
 assert.equal(present((await store.view(present(a),1800)).active_context.waiting).kind,'other_user_input')
})
it('reconstructs compressed views after a worker restart and refuses old digest details',async t=>{
 const env=await taskHost(t);await env.task('a')
 const store=env.service.tasks,a=store.current('session-a')
 for(let i=0;i<9;i++){const attempt=await store.beginAttempt(present(a),'click');await store.receipt(present(a),attempt,'executed')}
 const first=await store.view(present(a),50000),ref=expectRecord(expectList(expectRecord(first.knowledge_graph).digests)[0]).id
 await env.service.graph.retire(present(a).scope.taskId)
 const rebuilt=await store.view(present(a),50000)
 assert.deepEqual(expectRecord(rebuilt.knowledge_graph).digests,expectRecord(first.knowledge_graph).digests)
 assert.equal(JSON.parse(expectString(expectRecord((await store.detail(present(a),expectString(ref),0,50000))).text)).id,ref)
 const attempt=await store.beginAttempt(present(a),'type');await store.receipt(present(a),attempt,'executed')
 await assert.rejects(store.detail(present(a),expectString(ref),0,50000),/expired|unavailable/)
 assert.equal(store.openTask(present(a)).events.length,21)
})
it('loads all six tools and seven routes without a subprocess service or local definitions',async t=>{
 const env=await taskHost(t);delete env.ctx.subprocess;await env.service.graph.close()
 const graph=new GraphWorkers(env.service.config)
 assert.equal(env.service.tools.size,6);assert.equal(env.routes.size,7)
 await env.task('a')
 const access=env.service.tasks.current('session-a'),safe=graphInput(env.service.tasks.openTask(present(access)),env.service.config)
 await assert.rejects(graph.project(safe,8000,()=>true),/subprocess_unavailable/)
 await graph.close()
})
