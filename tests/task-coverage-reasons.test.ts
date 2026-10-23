import assert from 'node:assert/strict'
import { it } from 'node:test'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { taskCoverage, taskFacts } from '../src/task-facts.ts'
import { graphInput } from '../src/task-projections.ts'
import type { TaskData } from '../src/task-store.ts'
import { navigation } from './helpers/task-navigation.ts'
import { expectRecord, expectString, present } from './helpers/assertions.ts'

function selected(data:TaskData){return present(data.events.findLast(e=>e.type==='business_verdict')).data}
function artifact(data:TaskData,proofRef:string){return join(data.dir,expectString(expectRecord(present(data.events.find(e=>e.type==='asset'&&e.data.id===proofRef)).data.data).artifact))}
function trustedReason(data:TaskData){return present(taskCoverage(data).conditions.find(c=>c.source==='code_verified')).reason}

it('ignores missing old-run evidence and unrelated broken current-run evidence when no current judgment exists',async t=>{
  const env=await navigation(t),store=env.service.tasks,access=present(env.access),data=store.openTask(access),old=artifact(data,expectString(selected(data).proofRef))
  const next=await store.revise(access,{newRun:true});await unlink(old);await store.refreshEvidence(next)
  assert.deepEqual(data.evidenceIssues,[]);assert.equal(trustedReason(data),'no_valid_current_run_proof')
  const unrelated=await store.proof(next,{schemaVersion:1,kind:'navigation',run:next.run,pageRef:'missing-synthetic-page'})
  await unlink(artifact(data,unrelated));await store.refreshEvidence(next)
  assert.deepEqual(data.evidenceIssues,[unrelated]);assert.equal(taskFacts(data).candidateProofRef,null)
  assert.equal(trustedReason(data),'no_valid_current_run_proof')
})

for(const mode of ['missing','changed'] as const)it(`attributes ${mode} selected proof bytes without granting authority to the candidate`,async t=>{
  const env=await navigation(t),store=env.service.tasks,access=present(env.access),data=store.openTask(access),ref=expectString(selected(data).proofRef),path=artifact(data,ref)
  if(mode==='missing')await unlink(path);else await writeFile(path,'{}')
  await store.refreshEvidence(access)
  const facts=taskFacts(data)
  assert.equal(facts.candidateProofRef,ref);assert.equal(facts.proofRef,null);assert.equal(facts.verdict,'unverified')
  assert.equal(trustedReason(data),'evidence_unavailable');assert.equal(taskCoverage(data).verified,0)
  assert.equal(graphInput(data,store.graphConfig).proofRef,'')
  const detail=expectRecord(await store.detail(access,present(facts.criteria.find(c=>c.source==='code_verified')).id,0,8000))
  assert.deepEqual(expectRecord(JSON.parse(expectString(detail.text))).proofRefs,[])
})

it('uses only the selected judgment when a readable failed proof and a later valid proof replace a missing proof',async t=>{
  const env=await navigation(t),store=env.service.tasks,access=present(env.access),data=store.openTask(access),oldRef=expectString(selected(data).proofRef)
  const pageRef=expectString(present(data.events.find(e=>e.type==='asset'&&e.data.kind==='page')).data.id)
  await unlink(artifact(data,oldRef))
  const failed=await store.proof(access,{schemaVersion:1,kind:'navigation',run:access.run,pageRef:'missing-synthetic-page'})
  assert.equal(await store.verdict(access,{verdict:'entry_reached'},failed),'unverified')
  assert.deepEqual(data.evidenceIssues,[oldRef]);assert.equal(taskFacts(data).candidateProofRef,failed)
  assert.equal(trustedReason(data),'no_valid_current_run_proof')
  const valid=await store.proof(access,{schemaVersion:1,kind:'navigation',run:access.run,pageRef})
  assert.equal(await store.verdict(access,{verdict:'entry_reached'},valid),'entry_reached')
  assert.equal(trustedReason(data),'verified');assert.equal(taskCoverage(data).verified,1)
})

for(const mismatch of [{validatorVersion:99},{criterionId:'criterion-other'},{source:'model_intent'},{proofRef:'asset-foreign'}])it(`ignores an ineligible candidate ${JSON.stringify(mismatch)}`,async t=>{
  const env=await navigation(t),store=env.service.tasks,access=present(env.access),data=store.openTask(access),row=selected(data)
  await unlink(artifact(data,expectString(row.proofRef)))
  await store.append(access,'business_verdict',{...row,...mismatch});await store.refreshEvidence(access)
  assert.equal(taskFacts(data).candidateProofRef,null);assert.equal(trustedReason(data),'no_valid_current_run_proof')
})

it('preserves free-text and read-only reasons before considering unavailable originals',async t=>{
  const env=await navigation(t),data=env.service.tasks.openTask(present(env.access));data.readOnly=true
  const coverage=taskCoverage(data)
  assert.equal(coverage.conditions[0].reason,'no_validator')
  assert.equal(trustedReason(data),'read_only_history');assert.equal(coverage.verified,0)
})
