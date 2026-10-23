/** Host safety facts plus optional Go projections. This module contains no graph algorithm. */
import {isExploration,seedExploration,explorationState} from './task-exploration.ts'
import { taskFacts, taskCoverage } from './task-facts.ts'
import { eventResourceDescriptor } from './task-resources.ts'
import {record} from './graph/protocol.ts'
import { validRunScope } from './task-scope.ts'

/** @param {import('./task-store.ts').TaskData} task - opened task. @param {import('./graph/protocol.ts').GraphConfig} config - resolved graph limits. @returns {import('./graph/protocol.ts').GraphInput} safe replay input without original assets or physical paths. */
export function graphInput(task: import('./task-store.ts').TaskData,config: import('./graph/protocol.ts').GraphConfig) : import('./graph/protocol.ts').GraphInput {
  const run={...task.manifest.scope,runId:task.manifest.runId,workflowRef:task.manifest.workflowRef},facts=taskFacts(task)
  const semantic=(change:import('./task-exploration.ts').ExplorationChange)=>({nodes:change.nodes.map(n=>({id:n.id,kind:n.kind,source:n.source,data:{state:n.state,...(n.kind==='intent'?{priority:Number(n.data.priority)}:{}),...(n.kind==='fact'?{confidence:String(n.data.confidence)}:{}),...(n.kind==='goal'?{mandatory:n.data.mandatory===true}:{})}})),edges:change.edges,updates:change.updates,round:change.round,completed:change.completed})
  const events=task.events.map(event=>{
    const row=event.data,declared=(event.type==='created'||event.type==='revise')&&row.manifest&&typeof row.manifest==='object'?(row.manifest as import('./task-store.ts').Manifest):undefined
    const scope=declared?{...declared.scope,runId:declared.runId,workflowRef:declared.workflowRef}:validRunScope(row.run)?row.run:run
     const safe: import('./graph/protocol.ts').GraphEvent={seq:event.seq,hash:event.hash,type:event.type,run:scope}
    if(declared){safe.goal=declared.goal.slice(0,4000);if(isExploration(declared))safe.semantic=semantic(seedExploration(declared))}
    if(event.type==='exploration')safe.semantic=semantic(row.changes as unknown as import('./task-exploration.ts').ExplorationChange)
    if(event.type==='asset'){safe.id=String(row.id);safe.kind=String(row.kind);safe.source=String(row.source);safe.resource=eventResourceDescriptor(event,scope);if(row.kind==='page'&&row.data&&typeof row.data==='object'&&'documentToken' in row.data&&typeof row.data.documentToken==='string')safe.documentToken=row.data.documentToken.slice(0,200)}
    if(event.type==='attempt'){safe.id=String(row.attemptId);safe.action=String(row.action);if(typeof row.intentId==='string')safe.intentId=row.intentId}
    if(event.type==='receipt'){safe.id=String(row.attemptId);safe.outcome=String(row.outcome)}
    if(event.type==='edge'){safe.id=String(row.id);safe.from=String(row.from);safe.to=String(row.to);safe.relation=String(row.relation)}
    return safe
  })
  const protectedRefs=new Set([task.pendingWrite??''])
  if(facts.proofRef){protectedRefs.add(facts.proofRef);const proof=task.checkedProofs?.get(facts.proofRef)?.value;for(const key of ['attemptId','fileRef','resultRef','pageRef'])if(proof&&typeof proof[key]==='string')protectedRefs.add(proof[key])}
  for(const e of events)for(const n of e.semantic?.nodes??[])if(n.data.state==='origin')protectedRefs.add(n.id)
  if(isExploration(task.manifest)){const state=explorationState(task);for(const n of state.nodes.values())if(n.state==='origin'||state.edges.some(e=>e.from===n.id&&e.relation==='proves'))protectedRefs.add(n.id)}
  protectedRefs.delete('')
  return {...(isExploration(task.manifest)?{exploration:true}:{}),scope:run,version:events.length,tailHash:events.at(-1)?.hash??'',goal:task.manifest.goal.slice(0,4000),constraints:task.manifest.constraints,criteria:facts.criteria,events,protected:[...protectedRefs].sort(),proofRef:facts.proofRef??'',proofSeq:facts.sourceSeq??0,coldRounds:config.graphColdRounds,minGroup:config.graphMinGroup,liveDocumentToken:task.liveDocumentToken??''}
}
/** @param {import('./task-store.ts').TaskData} task - current Host data. @param {number} budget - optional display budget. @param {Record<string,unknown>|undefined} derived - validated Go view. @param {string} reason - component status. @param {boolean} writable - current durable writer availability. @param {string} [projectionId] - kernel-versioned safe input identity. @returns {Record<string,unknown>} five-module view with Host authority over safety and criteria. */
export function taskView(task: import('./task-store.ts').TaskData,budget: number,derived: Record<string, unknown> | undefined,reason: string,writable: boolean,projectionId?: string,cleanup?:{state:'pending'|'failed';code?:string}) {
  const facts=taskFacts(task),scope=task.manifest.scope
  const state=task.readOnly?'read_only':task.blocked||task.unhealthy?'write_blocked':task.waiting&&task.state==='active'?'awaiting_user':task.state
  const sources=task.events.slice(-8).map(event=>({seq:event.seq,hash:event.hash,type:event.type}))
  const waiting=task.state==='active'&&task.waiting?{id:task.waiting.id,kind:task.waiting.kind,owner:'user',source:'model_declared',reason:task.waiting.reason,resumeCondition:task.waiting.resumeCondition}:null
  const unknown=task.events.filter(event=>event.type==='receipt'&&event.data.outcome==='unknown_outcome').map(event=>event.data.attemptId)
  const active={pageControl:task.liveDocumentToken?'authorized':'unavailable',waiting,waitingRef:waiting?'waiting':null,taskId:scope.taskId,contextVersion:task.events.length,state,goal:task.manifest.goal.slice(0,1000),writeBlocked:!!task.readOnly||task.blocked||task.unhealthy||!writable,logHealthy:!task.unhealthy,businessVerdict:facts.verdict,sourceSeq:facts.sourceSeq,
    storage:{schemaVersion:task.manifest.schemaVersion??null,readOnly:!!task.readOnly,issue:task.storageIssue??null},evidenceIssues:task.evidenceIssues??[],unmetCriteria:facts.criteria.filter(row=>row.status!=='passed').map(row=>row.id),criteriaRef:'criteria',coverageRef:'coverage',coverage:((c)=>({total:c.total,verified:c.verified,unverified:c.unverified,ratio:c.ratio}))(taskCoverage(task,facts)),currentRun:task.manifest.runId,pendingAttempts:task.pendingWrite?[task.pendingWrite]:[],unknownOutcomes:unknown,sources,
    graph:{status:derived?'ready':'unavailable',reason,...(projectionId?{projectionId}:{}),...(cleanup?{cleanup}:{}),kernelVersion:'5'},complete:false}
  const procedural=((derived?.procedural_law_index??{}) as Record<string, unknown>),technical={...((derived?.technical_law_index??{}) as Record<string, unknown>)},graph=((derived?.knowledge_graph??{}) as Record<string, unknown>),selection={...((derived?.active_context??{}) as Record<string, unknown>)}
  const pageAssets=(value:unknown)=>Array.isArray(value)?value.map(row=>record(row)&&row.kind==='page'?{...row,validity:task.liveDocumentToken&&row.documentToken===task.liveDocumentToken?'current_authorized_document':'historical'}:row):value
  if(technical.assets!==undefined)technical.assets=pageAssets(technical.assets)
  if(selection.recentAssets!==undefined)selection.recentAssets=pageAssets(selection.recentAssets)
  const history=task.events.filter(event=>['waiting','wait_requested','wait_resolved'].includes(event.type)).slice(-4).map(event=>({sourceSeq:event.seq,type:event.type}))
  const value={basic_law_index:{events:task.events.length,healthy:!task.unhealthy,recent:sources},procedural_law_index:{...procedural,goal:{text:task.manifest.goal,source:'user_declared'},constraints:task.manifest.constraints,criteria:facts.criteria,waiting:waiting?[waiting]:[],historicalWaiting:history},technical_law_index:technical,knowledge_graph:graph,active_context:{...selection,...active,complete:!!derived&&selection.complete===true}}
  if(JSON.stringify(value).length<=budget)return value
  return {basic_law_index:{events:task.events.length,healthy:!task.unhealthy},procedural_law_index:{details:'goal',criteriaRef:'criteria'},technical_law_index:{details:'graph'},knowledge_graph:{details:'graph',views:graph.views,digestCount:graph.digestCount??0},active_context:{...active,goal:active.goal.slice(0,40),waiting:waiting?{...waiting,reason:waiting.reason.slice(0,80),resumeCondition:waiting.resumeCondition.slice(0,80)}:null,sources:[],unmetCriteria:active.unmetCriteria.slice(0,2),unmetCount:active.unmetCriteria.length,unknownOutcomes:unknown.slice(0,2),unknownCount:unknown.length,evidenceIssues:active.evidenceIssues.slice(0,2),evidenceIssueCount:active.evidenceIssues.length,truncated:true,complete:false}}
}
