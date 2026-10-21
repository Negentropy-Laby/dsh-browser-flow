/** Host-owned fact selection. Derived graph output never supplies authority. */
import { trustedCriterion, evidenceVerdict } from './task-criteria.ts'

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
