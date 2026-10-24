/** Host-owned fact selection. Derived graph output never supplies authority. */
import { isExploration, explorationState, seedExploration } from './task-exploration.ts'
import { trustedCriterion, evidenceVerdict } from './task-criteria.ts'
import { validRunScope, sameRunScope } from './task-scope.ts'

export interface TaskFacts {
    verdict: string;
    sourceSeq: number | null;
    proofRef: string | null;
    /** Diagnostic association only; this reference never proves a condition. */
    candidateProofRef: string | null;
    criteria: import('./graph/protocol.ts').Criterion[];
}
/** Independently verified current facts; callers may reuse them within one read phase. */
export function taskFacts(task: import('./task-store.ts').TaskData) : TaskFacts {
  let verdict='unverified',sourceSeq=null,proofRef=null,candidateProofRef:string|null=null
  const trusted=trustedCriterion(task.manifest),run={...task.manifest.scope,runId:task.manifest.runId,workflowRef:task.manifest.workflowRef}
  for(const event of task.events)if(event.type==='business_verdict'&&event.data.run&&typeof event.data.run==='object'&&'runId' in event.data.run&&event.data.run.runId===task.manifest.runId){
    verdict=evidenceVerdict(task,event.data);sourceSeq=event.seq
    proofRef=verdict!=='unverified'&&typeof event.data.proofRef==='string'?event.data.proofRef:null
    const row=event.data
    candidateProofRef=trusted&&row.source==='code_verified'&&row.criterionId===trusted.id&&row.validatorId===trusted.validatorId&&row.validatorVersion===trusted.version&&validRunScope(row.run)&&sameRunScope(row.run,run)&&typeof row.proofRef==='string'?row.proofRef:null
  }
  if(candidateProofRef!==null&&!task.events.some(e=>e.type==='asset'&&e.data.id===candidateProofRef&&e.data.kind==='evidence'&&validRunScope(e.data.run)&&sameRunScope(e.data.run,run)))candidateProofRef=null

  const criteria: import('./graph/protocol.ts').Criterion[]=task.manifest.criteria.map((label,index)=>({id:`criterion-${task.manifest.scope.taskId}-r${task.manifest.scope.scopeRevision}-${index+1}`,label,status:'unverified',source:'user_declared'}))
  if(trusted)criteria.push({...trusted,status:verdict==='unverified'?'unverified':'passed',source:'code_verified'})
  return {verdict,sourceSeq,proofRef,candidateProofRef,criteria}
}
/** Uses only Host facts. Call refreshEvidence before an authoritative tool read. */
export function taskCoverage(task:import('./task-store.ts').TaskData,facts:TaskFacts=taskFacts(task)) {
  const unavailable=facts.candidateProofRef!==null&&task.evidenceIssues?.includes(facts.candidateProofRef)
  const conditions=facts.criteria.map(criterion=>({
    ...criterion,verified:criterion.status==='passed'&&criterion.source==='code_verified',
    reason:criterion.source==='user_declared'?'no_validator':criterion.status==='passed'?'verified':task.readOnly?'read_only_history':unavailable?'evidence_unavailable':'no_valid_current_run_proof',
    proofRefs:criterion.status==='passed'&&facts.proofRef?[facts.proofRef]:[],details:criterion.id,
  }))
  const total=conditions.length,verified=conditions.filter(c=>c.verified).length
  return {total,verified,unverified:total-verified,ratio:total===0?null:verified/total,conditions}
}
/** New relations require both original endpoints in the exact current run. */
export function currentRunReferences(task:import('./task-store.ts').TaskData):Set<string> {
  return taskReferences(task,{currentRunOnly:true})
}
/** @param {import('./task-store.ts').TaskData} task - opened owned task. @returns {Set<string>} owned original references; no derived digest can authorize a relation. */
export function taskReferences(task: import('./task-store.ts').TaskData,{currentRunOnly=false}:{currentRunOnly?:boolean}={}) : Set<string> {
  const run={...task.manifest.scope,runId:task.manifest.runId,workflowRef:task.manifest.workflowRef}
  const ids=new Set(taskFacts(task).criteria.map(row=>String(row.id)))
  if(currentRunOnly)ids.add(`goal-${run.taskId}-r${run.scopeRevision}`)
  for(const event of task.events){const row=event.data
    if((event.type==='created'||event.type==='revise')&&row.manifest&&typeof row.manifest==='object'&&'scope' in row.manifest){
      const m=(row.manifest as import('./task-store.ts').Manifest),declared={...m.scope,runId:m.runId,workflowRef:m.workflowRef}
      if(!currentRunOnly||(validRunScope(declared)&&sameRunScope(declared,run))){ids.add(`goal-${m.scope.taskId}-r${m.scope.scopeRevision}`);if(isExploration(m))for(const n of seedExploration(m).nodes)ids.add(n.id)}
    }
    if(currentRunOnly&&(!validRunScope(row.run)||!sameRunScope(row.run,run)))continue
    if(event.type==='exploration'&&typeof row.changes==='object'&&row.changes!==null&&'nodes' in row.changes&&Array.isArray(row.changes.nodes))for(const n of row.changes.nodes)if(n&&typeof n==='object'&&typeof n.id==='string')ids.add(n.id)
    if(event.type==='asset'&&typeof row.id==='string')ids.add(row.id)
    if(event.type==='attempt'&&typeof row.attemptId==='string')ids.add(row.attemptId)
    if(event.type==='receipt')ids.add(`receipt-${task.manifest.scope.taskId}-${event.seq}`)
  }
  return ids
}
