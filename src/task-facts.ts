/** Host-owned fact selection. Derived graph output never supplies authority. */
import { trustedCriterion, evidenceVerdict } from './task-criteria.ts'
import { validRunScope, sameRunScope } from './task-scope.ts'

/** @param {import('./task-store.ts').TaskData} task - opened owned task. @returns {{verdict:string,sourceSeq:number|null,proofRef:string|null,criteria:import('./graph/protocol.ts').Criterion[]}} independently verified current facts. */
export function taskFacts(task: import('./task-store.ts').TaskData) : {
    verdict: string;
    sourceSeq: number | null;
    proofRef: string | null;
    criteria: import('./graph/protocol.ts').Criterion[];
} {
  let verdict='unverified',sourceSeq=null,proofRef=null
  for(const event of task.events)if(event.type==='business_verdict'&&event.data.run&&typeof event.data.run==='object'&&'runId' in event.data.run&&event.data.run.runId===task.manifest.runId){
    verdict=evidenceVerdict(task,event.data);sourceSeq=event.seq
    proofRef=verdict!=='unverified'&&typeof event.data.proofRef==='string'?event.data.proofRef:null
  }

  const criteria: import('./graph/protocol.ts').Criterion[]=task.manifest.criteria.map((label,index)=>({id:`criterion-${task.manifest.scope.taskId}-r${task.manifest.scope.scopeRevision}-${index+1}`,label,status:'unverified',source:'user_declared'}))
  const trusted=trustedCriterion(task.manifest)
  if(trusted)criteria.push({...trusted,status:verdict==='unverified'?'unverified':'passed',source:'code_verified'})
  return {verdict,sourceSeq,proofRef,criteria}
}
/** Uses only Host facts. Call refreshEvidence before an authoritative tool read. */
export function taskCoverage(task:import('./task-store.ts').TaskData) {
  const facts=taskFacts(task)
  const conditions=facts.criteria.map(criterion=>({
    ...criterion,verified:criterion.status==='passed'&&criterion.source==='code_verified',
    reason:criterion.source==='user_declared'?'no_validator':criterion.status==='passed'?'verified':task.readOnly?'read_only_history':task.evidenceIssues?.length?'evidence_unavailable':'no_valid_current_run_proof',
    proofRefs:criterion.status==='passed'&&facts.proofRef?[facts.proofRef]:[],details:criterion.id,
  }))
  const total=conditions.length,verified=conditions.filter(c=>c.verified).length
  return {total,verified,unverified:total-verified,ratio:total===0?null:verified/total,conditions}
}
/** New relations require both original endpoints in the exact current run. */
export function currentRunReferences(task:import('./task-store.ts').TaskData):Set<string> {
  const run={...task.manifest.scope,runId:task.manifest.runId,workflowRef:task.manifest.workflowRef}
  const ids=new Set(taskFacts(task).criteria.map(c=>c.id))
  ids.add(`goal-${run.taskId}-r${run.scopeRevision}`)
  for(const e of task.events)if(validRunScope(e.data.run)&&sameRunScope(e.data.run,run)){
    if(e.type==='asset'&&typeof e.data.id==='string')ids.add(e.data.id)
    if(e.type==='attempt'&&typeof e.data.attemptId==='string')ids.add(e.data.attemptId)
    if(e.type==='receipt')ids.add(`receipt-${run.taskId}-${e.seq}`)
  }
  return ids
}
/** @param {import('./task-store.ts').TaskData} task - opened owned task. @returns {Set<string>} owned original references; no derived digest can authorize a relation. */
export function taskReferences(task: import('./task-store.ts').TaskData) : Set<string> {
  const ids=new Set(taskFacts(task).criteria.map(row=>String(row.id)))
  for(const event of task.events){const row=event.data
    if((event.type==='created'||event.type==='revise')&&row.manifest&&typeof row.manifest==='object'&&'scope' in row.manifest){const m=(row.manifest as import('./task-store.ts').Manifest);ids.add(`goal-${m.scope.taskId}-r${m.scope.scopeRevision}`)}
    if(event.type==='asset'&&typeof row.id==='string')ids.add(row.id)
    if(event.type==='attempt'&&typeof row.attemptId==='string')ids.add(row.attemptId)
    if(event.type==='receipt')ids.add(`receipt-${task.manifest.scope.taskId}-${event.seq}`)
  }
  return ids
}
