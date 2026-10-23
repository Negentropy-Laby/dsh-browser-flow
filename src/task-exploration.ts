/** ARTEX-compatible task semantics. Host facts, never graph output, drive transitions. */
import { randomUUID } from 'node:crypto'
import { sameRunScope, validRunScope } from './task-scope.ts'
import { eventResourceDescriptor } from './task-resources.ts'
import type { Manifest, TaskData } from './task-store.ts'

export type ExplorationKind = 'goal'|'intent'|'fact'|'hint'
export interface ExplorationNode {
  id:string; kind:ExplorationKind; source:'agent'|'host'|'user_declared'; state:string
  data:Record<string,unknown>; asset_ids:string[]; sourceSeq?:number
}
export interface ExplorationEdge {id:string;from:string;to:string;relation:string}
export interface ExplorationChange {
  nodes:ExplorationNode[]; edges:ExplorationEdge[]; updates:{id:string;state:string}[]
  round:boolean; completed:boolean
}
export interface ExplorationState {
  nodes:Map<string,ExplorationNode>; edges:ExplorationEdge[]; phase:'planner'|'worker'
  currentIntent:ExplorationNode|undefined; round:number
}
export class ExplorationError extends Error {
  constructor(readonly code:string,message:string){super(message)}
}
export const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const text=(v:unknown,max=2000):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max
const refs=(v:unknown):v is string[]=>Array.isArray(v)&&v.length<=32&&v.every(x=>text(x,200))&&new Set(v).size===v.length
export const isExploration=(m:Manifest)=>m.schemaVersion===2&&m.adapter==='generic'&&m.workflowRef==='exploration'
export const explorationRun=(task:TaskData)=>({...task.manifest.scope,runId:task.manifest.runId,workflowRef:task.manifest.workflowRef})
export function canonical(value:unknown):string {
  return JSON.stringify(value,(_k,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)
}
function fail(message:string,code='invalid_request'):never {throw new ExplorationError(code,message)}
function node(id:string,kind:ExplorationKind,source:ExplorationNode['source'],state:string,data:Record<string,unknown>,asset_ids:string[]=[]):ExplorationNode{return {id,kind,source,state,data,asset_ids}}
export function seedExploration(manifest:Manifest):ExplorationChange {
  const suffix=`${manifest.scope.taskId}-r${manifest.scope.scopeRevision}`,origin=`fact-origin-${suffix}`
  const nodes=[node(`goal-${suffix}`,'goal','user_declared','open',{text:manifest.goal,mandatory:true,original:true}),node(origin,'fact','host','origin',{summary:manifest.goal,origins:manifest.origins,confidence:'instruction'})]
  manifest.criteria.forEach((label,i)=>nodes.push(node(`goal-condition-${suffix}-${i+1}`,'goal','user_declared','open',{text:label,mandatory:true,original:true})))
  manifest.constraints.forEach((label,i)=>nodes.push(node(`hint-${suffix}-${i+1}`,'hint','user_declared','active',{text:label})))
  const edges=nodes.filter(n=>n.kind==='goal').map(n=>({id:`seed-${n.id}`,from:origin,to:n.id,relation:'spawns'}))
  return {nodes,edges,updates:[],round:false,completed:false}
}
export function explorationState(task:TaskData):ExplorationState {
  const state:ExplorationState={nodes:new Map(),edges:[],phase:'planner',currentIntent:undefined,round:0}
  if(!isExploration(task.manifest))return state
  const apply=(change:ExplorationChange,seq:number)=>{
    for(const n of change.nodes){if(state.nodes.has(n.id))fail('duplicate exploration node','task_unavailable');state.nodes.set(n.id,{...n,data:{...n.data},asset_ids:[...n.asset_ids],sourceSeq:seq})}
    for(const update of change.updates){const n=state.nodes.get(update.id);if(!n)fail('missing exploration node','task_unavailable');n.state=update.state}
    for(const edge of change.edges){if(!state.nodes.has(edge.from)&&!edge.from.startsWith('asset-'))fail('missing exploration endpoint','task_unavailable');state.edges.push(edge)}
    if(change.completed)for(const n of state.nodes.values())if(n.kind==='intent'&&n.state==='open')n.state='stopped'
    if(change.round)state.round++
  }
  apply(seedExploration(task.manifest),1)
  const run=explorationRun(task)
  for(const event of task.events)if(event.type==='exploration'&&validRunScope(event.data.run)&&sameRunScope(event.data.run,run)&&object(event.data.changes))apply(event.data.changes as unknown as ExplorationChange,event.seq)
  const running=[...state.nodes.values()].filter(n=>n.kind==='intent'&&n.state==='running')
  if(running.length>1)fail('multiple running intents','task_unavailable')
  state.currentIntent=running[0];state.phase=running.length?'worker':'planner'
  return state
}
export function validExplorationEvent(row:Record<string,unknown>):boolean {
  if(!text(row.requestId,100)||!Number.isSafeInteger(row.expectedVersion)||Number(row.expectedVersion)<1||!object(row.command)||!object(row.result)||!object(row.changes))return false
  try{validateExplorationCommand(row.command)}catch{return false}
  const c=row.changes
  if(c.completed===true&&row.command.op!=='prove_goal')return false
  if(Object.keys(c).some(k=>!['nodes','edges','updates','round','completed'].includes(k))||!Array.isArray(c.nodes)||!Array.isArray(c.edges)||!Array.isArray(c.updates)||c.nodes.length>32||c.edges.length>256||c.updates.length>33||typeof c.round!=='boolean'||typeof c.completed!=='boolean')return false
  if(!c.nodes.every(n=>object(n)&&Object.keys(n).every(k=>['id','kind','source','state','data','asset_ids'].includes(k))&&text(n.id,200)&&['goal','intent','fact','hint'].includes(String(n.kind))&&n.source==='agent'&&text(n.state,30)&&object(n.data)&&refs(n.asset_ids)))return false
  if(!c.edges.every(e=>object(e)&&Object.keys(e).every(k=>['id','from','to','relation'].includes(k))&&text(e.id,200)&&text(e.from,200)&&text(e.to,200)&&['spawns','derived_from','yields','proves','observed_on','validated_by'].includes(String(e.relation))))return false
  if(!c.updates.every(u=>object(u)&&Object.keys(u).every(k=>['id','state'].includes(k))&&text(u.id,200)&&['running','done','blocked','exhausted','stopped','met'].includes(String(u.state))))return false
  return JSON.stringify(row).length<=200_000
}
export const EXPLORATION_OPS=['set_goals','add_hint','add_intent','claim_intent','finish_intent','record_fact','check_evidence','prove_goal'] as const
export function validateExplorationCommand(command:unknown):asserts command is Record<string,unknown> {
  if(!object(command)||!EXPLORATION_OPS.includes(command.op as typeof EXPLORATION_OPS[number])||JSON.stringify(command).length>100_000)fail('provide a bounded exploration operation')
  const fields:Record<string,string[]>={set_goals:['text','goals'],add_hint:['text','asset_ids'],add_intent:['summary','asset_ids','parent_ids','priority','intents'],claim_intent:['intent_id'],finish_intent:['intent_id','state','reason'],record_fact:['summary','detail','evidence','confidence','intent_id','asset_ids','evidence_refs','check_refs','facts'],check_evidence:['assertion'],prove_goal:['goal_id','evidence_id','reason']}
  if(Object.keys(command).some(k=>k!=='op'&&!fields[String(command.op)].includes(k)))fail('unknown exploration argument')
}
export function currentResources(task:TaskData) {
  const resources=new Map<string,{id:string;kind:string;snapshots:string[];run:ReturnType<typeof explorationRun>}>(),run=explorationRun(task)
  for(const e of task.events)if(e.type==='asset'&&validRunScope(e.data.run)&&sameRunScope(e.data.run,run)){
    const d=eventResourceDescriptor(e,run),r=resources.get(d.id)
    if(r)r.snapshots.push(String(e.data.id));else resources.set(d.id,{id:d.id,kind:String(e.data.kind),snapshots:[String(e.data.id)],run})
  }
  return resources
}
/** Explicit resource and exact-snapshot anchors share the same Host relation index. */
export function resourceAnchors(state:ExplorationState,resources:ReturnType<typeof currentResources>) {
  const anchors=new Map([...resources.keys()].map(id=>[id,new Set<string>()])),snapshots=new Map<string,string>()
  for(const resource of resources.values())for(const ref of resource.snapshots)snapshots.set(ref,resource.id)
  for(const node of state.nodes.values())for(const id of node.asset_ids)anchors.get(id)?.add(node.id)
  for(const edge of state.edges)for(const [snapshot,node] of [[edge.from,edge.to],[edge.to,edge.from]]){
    const resource=snapshots.get(snapshot)
    if(resource&&state.nodes.has(node))anchors.get(resource)!.add(node)
  }
  return anchors
}
export function planExploration(task:TaskData,command:Record<string,unknown>,checkPassed:(id:string,evidenceRefs:string[])=>boolean,checkRef?:string):{changes:ExplorationChange;result:Record<string,unknown>} {
  validateExplorationCommand(command)
  const state=explorationState(task),resources=currentResources(task),changes:ExplorationChange={nodes:[],edges:[],updates:[],round:false,completed:false}
  const op=String(command.op),result:Record<string,unknown>={op,businessInterpretation:'agent'}
  const add=(kind:ExplorationKind,status:string,data:Record<string,unknown>,anchors:string[]=[])=>{
    const n=node(`${kind}-${randomUUID()}`,kind,'agent',status,data,anchors);changes.nodes.push(n);for(const id of anchors){const snapshot=resources.get(id)?.snapshots.at(-1);if(snapshot)edge(snapshot,n.id,'observed_on')};return n
  }
  const edge=(from:string,to:string,relation:string)=>changes.edges.push({id:'edge-'+randomUUID(),from,to,relation})
  const anchors=(raw:unknown):string[]=>{if(raw===undefined)return [];if(!refs(raw)||raw.some(id=>!resources.has(id)))fail('asset_ids must be current task resource IDs');return raw}
  const planner=()=>{if(state.phase!=='planner')fail('finish the current intent before planning','task_busy')}
  const one=(id:unknown,kind:ExplorationKind)=>{if(!text(id,200))fail(`provide ${kind} id`);const n=state.nodes.get(id);if(!n||n.kind!==kind)fail(`${kind} belongs to another task/run or is unavailable`,'task_not_bound');return n}
  if(op==='set_goals'){
    planner();const items=command.goals??[{text:command.text}]
    if(!Array.isArray(items)||!items.length||items.length>32)fail('provide 1 to 32 goals')
    result.ids=items.map(item=>{if(!object(item)||Object.keys(item).some(k=>k!=='text')||!text(item.text))fail('goals require text');const n=add('goal','open',{text:item.text,mandatory:true,original:false});edge([...state.nodes.values()].find(n=>n.state==='origin')!.id,n.id,'spawns');return n.id})
  }else if(op==='add_hint'){
    if(!text(command.text))fail('hint text required');result.id=add('hint','active',{text:command.text},anchors(command.asset_ids)).id
  }else if(op==='add_intent'){
    planner();const items=command.intents??[Object.fromEntries(Object.entries(command).filter(([k])=>k!=='op'))]
    if(!Array.isArray(items)||!items.length||items.length>4)fail('provide 1 to 4 exploration directions per planning round')
    result.ids=items.map(item=>{
      if(!object(item)||Object.keys(item).some(k=>!['summary','asset_ids','parent_ids','priority'].includes(k))||!text(item.summary))fail('intent summary required')
      const priority=item.priority??5;if(!Number.isInteger(priority)||Number(priority)<0||Number(priority)>10)fail('priority must be 0 to 10; larger first')
      const parents=item.parent_ids??[];if(!refs(parents))fail('parent_ids must be fact references')
      for(const id of parents)one(id,'fact')
      const n=add('intent','open',{summary:item.summary,priority},anchors(item.asset_ids))
      for(const id of parents.length?parents:[[...state.nodes.values()].find(n=>n.state==='origin')!.id])edge(id,n.id,'derived_from')
      return n.id
    })
  }else if(op==='claim_intent'){
    planner();const n=command.intent_id===undefined?[...state.nodes.values()].filter(n=>n.kind==='intent'&&n.state==='open').sort((a,b)=>Number(b.data.priority)-Number(a.data.priority)||Number(a.sourceSeq)-Number(b.sourceSeq))[0]:one(command.intent_id,'intent')
    if(!n||n.state!=='open')fail('select an open intent','task_busy')
    changes.updates.push({id:n.id,state:'running'});changes.round=true;result.intent_id=n.id
  }else if(op==='finish_intent'){
    const n=one(command.intent_id??state.currentIntent?.id,'intent'),status=command.state??'done'
    if(n!==state.currentIntent||!['done','blocked','exhausted','stopped'].includes(String(status)))fail('only the running intent can finish')
    if(status==='done'&&![...state.nodes.values()].some(f=>f.kind==='fact'&&f.data.intent_id===n.id))fail('record the exploration result before finishing')
    if(status!=='done'&&!text(command.reason,1000))fail('an unfinished direction requires a reason')
    changes.updates.push({id:n.id,state:String(status)});result.intent_id=n.id;result.state=status
  }else if(op==='record_fact'){
    const intent=one(command.intent_id??state.currentIntent?.id,'intent')
    if(intent!==state.currentIntent)fail('facts must belong to the running intent','task_busy')
    const items=command.facts??[Object.fromEntries(Object.entries(command).filter(([k])=>k!=='op'))]
    if(!Array.isArray(items)||!items.length||items.length>32)fail('provide bounded facts')
    result.ids=items.map(item=>{
      if(!object(item)||Object.keys(item).some(k=>!['summary','detail','evidence','confidence','intent_id','asset_ids','evidence_refs','check_refs'].includes(k))||!text(item.summary)||!['observed','inferred'].includes(String(item.confidence))||(item.detail!==undefined&&!text(item.detail,8000))||(item.evidence!==undefined&&!text(item.evidence,2000))||(item.intent_id!==undefined&&item.intent_id!==intent.id))fail('provide a fact summary and observed/inferred confidence')
      const evidenceRefs=item.evidence_refs??[],checks=item.check_refs??[]
      if(!refs(evidenceRefs)||!refs(checks)||(item.confidence==='observed'&&!evidenceRefs.length))fail('observed facts require original snapshot references')
      for(const id of evidenceRefs){const e=task.events.find(e=>e.type==='asset'&&e.data.id===id&&validRunScope(e.data.run)&&sameRunScope(e.data.run,explorationRun(task)));if(!e||!['page','file'].includes(String(e.data.kind))||!object(e.data.data)||e.data.data.contextOnly===true)fail('fact evidence must be current original observations or files','task_not_bound')}
      for(const id of checks)if(!checkPassed(id,evidenceRefs))fail('check is unavailable, failed or bound to different evidence')
      const n=add('fact','confirmed',{summary:item.summary,...(item.detail?{detail:item.detail}:{}),...(item.evidence?{evidence:item.evidence}:{}),confidence:item.confidence,intent_id:intent.id,evidence_refs:evidenceRefs,check_refs:checks},anchors(item.asset_ids))
      edge(intent.id,n.id,'yields');for(const id of evidenceRefs)edge(id,n.id,'observed_on');for(const id of checks)edge(n.id,id,'validated_by');return n.id
    })
  }else if(op==='check_evidence'){
    if(!checkRef)fail('source-backed evidence check unavailable');result.check_ref=checkRef
  }else if(op==='prove_goal'){
    planner();const goal=one(command.goal_id,'goal'),fact=one(command.evidence_id,'fact')
    if(!text(command.reason))fail('explain why this fact meets the goal')
    const checks=fact.data.check_refs,evidenceRefs=fact.data.evidence_refs
    if(fact.data.confidence!=='observed'||!refs(checks)||!checks.length||!refs(evidenceRefs)||!evidenceRefs.length||!checks.every(id=>checkPassed(id,evidenceRefs)))fail('goal proof requires an observed fact and currently passing source-backed checks')
    changes.updates.push({id:goal.id,state:'met'});edge(fact.id,goal.id,'proves');result.goal_id=goal.id;result.evidence_id=fact.id;result.proofSource='agent';result.evidenceVerification='host_checked'
    changes.completed=[...state.nodes.values()].filter(n=>n.kind==='goal').every(n=>n.id===goal.id||n.state==='met')&&!task.pendingWrite&&!task.waiting&&!task.blocked&&!task.unhealthy

  }
  return {changes,result}
}
export function explorationOverview(task:TaskData) {
  const state=explorationState(task),all=[...state.nodes.values()],resources=currentResources(task)
  const anchors=resourceAnchors(state,resources),explorable=[...resources.values()].filter(r=>['page','file'].includes(r.kind))
  const denominator=explorable.length,count=explorable.filter(r=>[...anchors.get(r.id)!].some(id=>{const n=state.nodes.get(id);return n?.kind==='fact'&&n.state!=='origin'})).length
  const compact=(n:ExplorationNode)=>({id:n.id,state:n.state,source:n.source,summary:String(n.data.summary??n.data.text??'').slice(0,160),...(typeof n.data.confidence==='string'?{confidence:n.data.confidence}:{}),...(typeof n.data.priority==='number'?{priority:n.data.priority}:{}),asset_ids:n.asset_ids,details:n.id})
  return {phase:state.phase,currentIntent:state.currentIntent?.id??null,round:state.round,
    goals:all.filter(n=>n.kind==='goal').slice(0,8).map(n=>({...compact(n),proofSource:n.state==='met'?'agent':null})),
    goals_total:all.filter(n=>n.kind==='goal').length,goals_unmet:all.filter(n=>n.kind==='goal'&&n.state!=='met').length,goals_details:{op:'list_goals'},
    hints:all.filter(n=>n.kind==='hint').slice(-8).map(compact),
    open_intents:all.filter(n=>n.kind==='intent'&&n.state==='open').sort((a,b)=>Number(b.data.priority)-Number(a.data.priority)).slice(0,8).map(compact),
    running_intents:all.filter(n=>n.kind==='intent'&&n.state==='running').map(compact),
    recent_done_intents:all.filter(n=>n.kind==='intent'&&!['open','running'].includes(n.state)).slice(-8).map(compact),
    recent_facts:all.filter(n=>n.kind==='fact'&&n.state!=='origin').slice(-8).map(compact),
    facts_total:all.filter(n=>n.kind==='fact'&&n.state!=='origin').length,
    assetCoverage:{denominator,tested:count,pct:denominator?count/denominator:null,note:'Known task resources anchored by facts; not business success or all website functions.'},
    verification:'last_checked; use explicit task reads to revalidate originals',details:'graph:exploration'}
}
