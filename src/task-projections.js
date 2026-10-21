import { trustedCriterion, evidenceVerdict } from './task-criteria.js'
/** Pure per-task projections over the owned journal; no global cache or cross-task search. */

/** @typedef {{ id: string, taskId: string, kind: string, source: string, sourceSeq: number, data: Record<string, unknown> }} Asset */
/** @typedef {{ id: string, taskId: string, from: string, to: string, relation: string, sourceSeq: number }} Edge */

/** @param {import('./task-store.js').TaskData} task - private task already opened by its owner. @returns {{ assets: Map<string,Asset>, edges: Edge[], attempts: {id:string,action:string,status:string,sourceSeq:number}[], waits: object[], verdict: string, verdictSeq?: number }} rebuilt projections. */
export function projectTask(task) {
  /** @type {Map<string,Asset>} */ const assets=new Map()
  /** @type {Edge[]} */ const edges=[]
  const goalId='goal-'+task.manifest.scope.taskId+'-r'+task.manifest.scope.scopeRevision
  assets.set(goalId,{id:goalId,taskId:task.manifest.scope.taskId,kind:'goal',source:'user_declared',sourceSeq:task.events.findLast(event=>event.type==='revise')?.seq ?? 1,data:{goal:task.manifest.goal}})
  task.manifest.criteria.forEach((label,index)=>{const id='criterion-'+task.manifest.scope.taskId+'-r'+task.manifest.scope.scopeRevision+'-'+(index+1);assets.set(id,{id,taskId:task.manifest.scope.taskId,kind:'criterion',source:'user_declared',sourceSeq:1,data:{label,status:'unverified'}})})
  const trusted=trustedCriterion(task.manifest)
  if(trusted)assets.set(trusted.id,{id:trusted.id,taskId:task.manifest.scope.taskId,kind:'criterion',source:'code_verified',sourceSeq:1,data:{label:trusted.label,status:'unverified',validatorId:trusted.validatorId,validatorVersion:trusted.version}})
  const attempts=new Map()
  const waits=[]
  let verdict='unverified'
  let verdictSeq
  for(const event of task.events){
    const row=event.data
    if((event.type==='created'||event.type==='revise') && row.manifest && typeof row.manifest==='object'){
      const declared=/** @type {import('./task-store.js').Manifest} */(row.manifest)
      const id='goal-'+declared.scope.taskId+'-r'+declared.scope.scopeRevision
      assets.set(id,{id,taskId:declared.scope.taskId,kind:'goal',source:'user_declared',sourceSeq:event.seq,data:{goal:declared.goal}})
    }
    if(event.type==='asset' && typeof row.id==='string' && typeof row.kind==='string' && typeof row.source==='string' && row.data && typeof row.data==='object' && !Array.isArray(row.data)){
      assets.set(row.id,{id:row.id,taskId:task.manifest.scope.taskId,kind:row.kind,source:row.source,sourceSeq:event.seq,data:/** @type {Record<string,unknown>} */(row.data)})
    }
    if(event.type==='edge' && typeof row.id==='string' && typeof row.from==='string' && typeof row.to==='string' && typeof row.relation==='string' && assets.has(row.from) && assets.has(row.to))edges.push({id:row.id,taskId:task.manifest.scope.taskId,from:row.from,to:row.to,relation:row.relation,sourceSeq:event.seq})
    if(event.type==='attempt' && typeof row.attemptId==='string'){
      attempts.set(row.attemptId,{id:row.attemptId,action:String(row.action),status:'pending',sourceSeq:event.seq})
      assets.set(row.attemptId,{id:row.attemptId,taskId:task.manifest.scope.taskId,kind:'intent',source:'model_intent',sourceSeq:event.seq,data:{action:row.action,status:'attempted',businessSuccess:false}})
      const revision=row.run && typeof row.run==='object' && 'scopeRevision' in row.run ? row.run.scopeRevision : undefined
      const intendedGoal='goal-'+task.manifest.scope.taskId+'-r'+revision
      if(assets.has(intendedGoal))edges.push({id:'intent-edge-'+event.seq,taskId:task.manifest.scope.taskId,from:row.attemptId,to:intendedGoal,relation:'attempts',sourceSeq:event.seq})
    }
    if(event.type==='receipt' && typeof row.attemptId==='string'){
      const attempt=attempts.get(row.attemptId)
      if(attempt){attempt.status=String(row.outcome);const id='receipt-'+task.manifest.scope.taskId+'-'+event.seq;assets.set(id,{id,taskId:task.manifest.scope.taskId,kind:'receipt',source:'host',sourceSeq:event.seq,data:{outcome:row.outcome}});edges.push({id:'receipt-edge-'+event.seq,taskId:task.manifest.scope.taskId,from:id,to:row.attemptId,relation:'records',sourceSeq:event.seq})}
    }
    if(event.type==='waiting'||event.type==='wait_requested'||event.type==='wait_resolved')waits.push({sourceSeq:event.seq,source:'host',...row})
    if(event.type==='business_verdict' && row.run && typeof row.run==='object' && 'runId' in row.run && row.run.runId===task.manifest.runId){
      verdict=evidenceVerdict(task,row);verdictSeq=event.seq
      if(trusted){
        const criterion=assets.get(trusted.id)
        if(criterion)criterion.data.status=verdict==='unverified'?'unverified':'passed'
        for(let i=edges.length-1;i>=0;i--)if(edges[i].relation==='proves'&&edges[i].to===trusted.id)edges.splice(i,1)
        if(verdict!=='unverified'&&typeof row.proofRef==='string'&&assets.has(row.proofRef))edges.push({id:'proof-edge-'+event.seq,taskId:task.manifest.scope.taskId,from:row.proofRef,to:trusted.id,relation:'proves',sourceSeq:event.seq})
      }
    }
  }
  return {assets,edges,attempts:[...attempts.values()],waits,verdict,...(verdictSeq===undefined?{}:{verdictSeq})}
}
/** @param {import('./task-store.js').TaskData} task - verified task. @param {number} budget - total serialized character budget. @returns {Record<string, unknown>} bounded five-module summary with explicit source references. */
export function taskView(task,budget) {
  const projected=projectTask(task)
  const scope=task.manifest.scope
  const contextVersion=task.events.length
  const state=task.readOnly?'read_only':task.blocked||task.unhealthy?'write_blocked':task.waiting&&task.state==='active'?'awaiting_user':task.state
  const sources=task.events.slice(-8).map(event=>({seq:event.seq,hash:event.hash,type:event.type}))
  const assets=[...projected.assets.values()].filter(asset=>!['goal','criterion','intent','receipt'].includes(asset.kind)).slice(-8)
  const keyNodes=[...projected.assets.values()].filter(asset=>(asset.kind==='criterion'&&asset.source==='code_verified')||asset.id==='goal-'+task.manifest.scope.taskId+'-r'+task.manifest.scope.scopeRevision)
  const graphNodes=[...keyNodes,...[...projected.assets.values()].filter(asset=>!keyNodes.includes(asset)).slice(-(16-keyNodes.length))].map(asset=>({id:asset.id,kind:asset.kind,source:asset.source,sourceSeq:asset.sourceSeq}))
  const modelAssets=assets.map(asset=>({id:asset.id,kind:asset.kind,source:asset.source,sourceSeq:asset.sourceSeq,...(asset.kind==='page'?{documentToken:asset.data.documentToken,validity:task.liveDocumentToken&&task.liveDocumentToken===asset.data.documentToken?'current_authorized_document':'historical'}:{})}))
  const waiting=task.state==='active'&&task.waiting?{id:task.waiting.id,kind:task.waiting.kind,owner:'user',source:'model_declared',reason:task.waiting.reason,resumeCondition:task.waiting.resumeCondition}:null
  const active={pageControl:task.liveDocumentToken?'authorized':'unavailable',waiting,waitingRef:waiting?'waiting':null,taskId:scope.taskId,contextVersion,state,goal:task.manifest.goal.slice(0,1000),writeBlocked:task.blocked||task.unhealthy,logHealthy:!task.unhealthy,businessVerdict:projected.verdict,sourceSeq:projected.verdictSeq ?? null,
    storage:{schemaVersion:task.manifest.schemaVersion??null,readOnly:!!task.readOnly,issue:task.storageIssue??null},evidenceIssues:task.evidenceIssues??[],unmetCriteria:[...projected.assets.values()].filter(asset=>asset.kind==='criterion'&&asset.data.status!=='passed').map(asset=>asset.id).slice(0,4),currentRun:task.manifest.runId,recentAssets:modelAssets,pendingAttempts:projected.attempts.filter(row=>row.status==='pending').map(row=>row.id),sources,complete:false}
  const value={
    basic_law_index:{events:contextVersion,healthy:!task.unhealthy,recent:sources},
    procedural_law_index:{goal:{text:task.manifest.goal,source:'user_declared'},constraints:task.manifest.constraints,criteria:[...projected.assets.values()].filter(asset=>asset.kind==='criterion').map(asset=>({id:asset.id,...asset.data,source:asset.source})),intents:projected.attempts.slice(-8).map(row=>({...row,source:'model_intent',businessSuccess:false})),waiting:waiting?[waiting]:[],historicalWaiting:projected.waits.slice(-4)},
    technical_law_index:{assets:modelAssets,total:[...projected.assets.values()].filter(asset=>!['goal','criterion','intent','receipt'].includes(asset.kind)).length},
    knowledge_graph:{nodes:graphNodes,edges:projected.edges.filter(edge=>graphNodes.some(node=>node.id===edge.from)&&graphNodes.some(node=>node.id===edge.to)).slice(-12),totalEdges:projected.edges.length},
    active_context:active,
  }
  if(JSON.stringify(value).length<=budget){active.complete=true;return value}
  // Large goals/history remain accessible as explicit scoped details; no fact is silently promoted.
  const compact={active_context:{...active,recentAssets:[],sources:sources.slice(-1),goal:active.goal.slice(0,40),waiting:waiting?{...waiting,reason:waiting.reason.slice(0,80),resumeCondition:waiting.resumeCondition.slice(0,80)}:null,unmetCriteria:[],criteriaRef:'criteria',evidenceIssues:(task.evidenceIssues??[]).slice(-2),truncated:true},basic_law_index:{events:contextVersion,healthy:!task.unhealthy},procedural_law_index:{details:'goal',criteriaRef:'criteria'},technical_law_index:{total:assets.length},knowledge_graph:{details:'graph',totalEdges:projected.edges.length}}
  return compact
}
