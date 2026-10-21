/** Cross-process output validation against the exact sanitized replay input. */
import { GraphError, record } from './protocol.ts'
import type { GraphInput, JsonRecord } from './protocol.ts'
interface Expected {kind:string;source:string;sourceSeq:number;data:JsonRecord;run:string}
function bad():never {throw new GraphError('invalid_projection')}
function object(value:unknown):JsonRecord {return record(value)?value:bad()}
function list(value:unknown):unknown[]{return Array.isArray(value)?value:bad()}
function keys(value:JsonRecord,allowed:string[]):void {if(Object.keys(value).some(key=>!allowed.includes(key)))bad()}
function integer(value:unknown):void {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)bad()}
function equal(a:unknown,b:unknown):boolean {if(record(a)&&record(b)){const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();return equal(ak,bk)&&ak.every(k=>equal(a[k],b[k]))};if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>equal(v,b[i]));return a===b}
function expected(input:GraphInput):Map<string,Expected> {
 const result=new Map<string,Expected>(),goal=(s:GraphInput['scope'])=>`goal-${s.taskId}-r${s.scopeRevision}`
 for(const e of input.events){const run=JSON.stringify([e.run.profileId,e.run.taskId,e.run.ownerSessionId,e.run.scopeRevision,e.run.runId,e.run.workflowRef])
  if(e.type==='created'||e.type==='revise')result.set(goal(e.run),{kind:'goal',source:'user_declared',sourceSeq:e.seq,data:{goal:e.goal},run})
  if(e.type==='asset'&&e.id)result.set(e.id,{kind:e.kind??'',source:e.source??'',sourceSeq:e.seq,data:e.kind==='page'?{documentToken:e.documentToken??''}:{},run})
  if(e.type==='attempt'&&e.id)result.set(e.id,{kind:'intent',source:'model_intent',sourceSeq:e.seq,data:{action:e.action,status:'pending',businessSuccess:false},run})
  if(e.type==='receipt'&&e.id){const a=result.get(e.id);if(a)a.data.status=e.outcome;result.set(`receipt-${input.scope.taskId}-${e.seq}`,{kind:'receipt',source:'host',sourceSeq:e.seq,data:{outcome:e.outcome},run})}
 }
 result.set(goal(input.scope),{kind:'goal',source:'user_declared',sourceSeq:1,data:{goal:input.goal},run:JSON.stringify([input.scope.profileId,input.scope.taskId,input.scope.ownerSessionId,input.scope.scopeRevision,input.scope.runId,input.scope.workflowRef])})
 for(const c of input.criteria)result.set(c.id,{kind:'criterion',source:c.source,sourceSeq:1,data:{label:c.label,status:c.status,validatorId:c.validatorId??'',validatorVersion:c.version??0},run:JSON.stringify([input.scope.profileId,input.scope.taskId,input.scope.ownerSessionId,input.scope.scopeRevision,input.scope.runId,input.scope.workflowRef])})
 return result
}
function metadata(value:unknown,refs:Map<string,Expected>,asset=false):void {
 const row=object(value);keys(row,['id','kind','source','sourceSeq',...(asset?['documentToken']:[])]);if(typeof row.id!=='string')bad();const source=refs.get(row.id);if(!source||row.kind!==source.kind||row.source!==source.source||row.sourceSeq!==source.sourceSeq)bad()
 if(asset&&source.kind==='page'){if(row.documentToken!==source.data.documentToken)bad()}else if('documentToken' in row)bad()
}
interface DigestRecord {row:JsonRecord;members:Set<unknown>}
function digests(value:unknown,refs:Map<string,Expected>,input:GraphInput,hash:string):Map<string,DigestRecord> {
 const all=new Map<string,DigestRecord>(),covered=new Set<string>(),protectedRefs=new Set(input.protected)
 for(const valueRow of list(value)){
  const row=object(valueRow);keys(row,['id','members','anchors','outcomes','sourceSeqs','signature'])
  if(typeof row.signature!=='string'||!/^[a-f0-9]{64}$/.test(row.signature)||row.id!==`digest-${hash}-${row.signature}`)bad()
  const members=list(row.members),memberSet=new Set(members),anchors=list(row.anchors);if(members.length<input.minGroup)bad();let run:string|undefined;const outcomes:Record<string,number>={},seqs:number[]=[]
  for(const id of members){if(typeof id!=='string'||covered.has(id)||protectedRefs.has(id))bad();const node=refs.get(id);if(!node||!['intent','receipt'].includes(node.kind)||['pending','unknown_outcome'].includes(String(node.data.status??node.data.outcome)))bad();if(run&&run!==node.run)bad();run=node.run;covered.add(id);seqs.push(node.sourceSeq);if(node.kind==='receipt'){const outcome=String(node.data.outcome);outcomes[outcome]=(outcomes[outcome]??0)+1}}
  for(const id of anchors)if(typeof id!=='string'||!refs.has(id)||memberSet.has(id))bad()
  if(!equal(outcomes,row.outcomes)||!equal(seqs.sort((a,b)=>a-b),row.sourceSeqs))bad();if(all.has(String(row.id)))bad();all.set(String(row.id),{row,members:memberSet})
 }
 return all
}
function edge(value:unknown,input:GraphInput,refs:Map<string,Expected>,ds:Map<string,DigestRecord>):void {
 const row=object(value);keys(row,['id','taskId','from','to','relation','sourceSeq']);if(row.taskId!==input.scope.taskId||typeof row.from!=='string'||typeof row.to!=='string'||!refs.has(row.to))bad()
 if(row.relation==='covers'){const d=ds.get(row.from);if(!d||!d.members.has(row.to)||row.id!==row.from+':'+row.to||row.sourceSeq!==0)bad();return}
 if(!refs.has(row.from))bad();integer(row.sourceSeq)
 if(row.relation==='proves'){if(row.from!==input.proofRef||row.sourceSeq!==input.proofSeq||row.id!==`proof-edge-${input.proofSeq}`||!input.criteria.some(c=>c.id===row.to&&c.source==='code_verified'&&c.status==='passed'))bad();return}
 const e=input.events[Number(row.sourceSeq)-1];if(!e)bad()
 if(row.relation==='attempts'){if(e.type!=='attempt'||row.id!==`intent-edge-${e.seq}`||row.from!==e.id||row.to!==`goal-${e.run.taskId}-r${e.run.scopeRevision}`)bad();return}
 if(row.relation==='records'){if(e.type!=='receipt'||row.id!==`receipt-edge-${e.seq}`||row.from!==`receipt-${input.scope.taskId}-${e.seq}`||row.to!==e.id)bad();return}
 if(e.type!=='edge'||row.id!==e.id||row.from!==e.from||row.to!==e.to||row.relation!==e.relation)bad()
}
function attempt(value:unknown,refs:Map<string,Expected>,frontier:boolean):void {
 const row=object(value);keys(row,['id','action','status','sourceSeq','source','businessSuccess']);if(typeof row.id!=='string')bad();const n=refs.get(row.id)
 if(!n||n.kind!=='intent'||row.action!==n.data.action||row.status!==n.data.status||row.sourceSeq!==n.sourceSeq||row.source!=='model_intent'||row.businessSuccess!==false)bad()
 if(frontier&&!['pending','unknown_outcome'].includes(String(row.status)))bad()
}
/** @param value - worker payload. @param input - original safe input. @param hash - projection identity. @returns Closed owned view with no generated authority fields. */
export function validateView(value:unknown,input:GraphInput,hash:string):JsonRecord {
 const v=object(value);if(Object.keys(v).sort().join(',')!=='active_context,knowledge_graph,procedural_law_index,technical_law_index')bad()
 const p=object(v.procedural_law_index),t=object(v.technical_law_index),g=object(v.knowledge_graph),a=object(v.active_context),refs=expected(input)
 keys(p,['goal','constraints','criteria','intents','frontier','details','criteriaRef']);keys(t,['assets','total','byKind']);keys(g,['nodes','edges','totalEdges','totalNodes','digests','digestCount','details']);keys(a,['recentAssets','round','complete','truncated'])
 if(p.goal!==undefined&&!equal(p.goal,{text:input.goal,source:'user_declared'}))bad()
 if(p.constraints!==undefined&&!equal(p.constraints,input.constraints))bad()
 if(p.criteria!==undefined&&!equal(p.criteria,input.criteria))bad()
 for(const row of p.intents===undefined?[]:list(p.intents))attempt(row,refs,false)
 for(const row of p.frontier===undefined?[]:list(p.frontier))attempt(row,refs,true)
 for(const row of t.assets===undefined?[]:list(t.assets))metadata(row,refs,true)
 for(const row of a.recentAssets===undefined?[]:list(a.recentAssets))metadata(row,refs,true)
 for(const row of g.nodes===undefined?[]:list(g.nodes))metadata(row,refs)
 const ds=digests(g.digests??[],refs,input,hash)
 for(const row of g.edges===undefined?[]:list(g.edges))edge(row,input,refs,ds)
 for(const row of [t.total,g.totalEdges,g.totalNodes,g.digestCount,a.round])if(row!==undefined)integer(row)
 if(t.byKind!==undefined){const counts=object(t.byKind);keys(counts,['page','file','unit_check','import_result','evidence']);for(const count of Object.values(counts))integer(count)}
 if(typeof a.complete!=='boolean'||(a.truncated!==undefined&&typeof a.truncated!=='boolean'))bad()
 if((g.details!==undefined&&g.details!=='graph')||(p.details!==undefined&&p.details!=='goal')||(p.criteriaRef!==undefined&&p.criteriaRef!=='criteria'))bad()
 return v
}
/** @param value - detail reply. @param ref - requested reference. @param input - original safe input. @param hash - projection identity. @returns Owned immutable detail. */
export function validateDetail(value:unknown,ref:string,input:GraphInput,hash:string):unknown {
 const v=object(value),refs=expected(input)
 const node=(value:unknown,ds:Map<string,DigestRecord>)=>{const n=object(value);keys(n,['id','taskId','kind','source','sourceSeq','data']);if(n.taskId!==input.scope.taskId||typeof n.id!=='string')bad()
  if(n.kind==='digest'){const d=ds.get(n.id);if(!d||n.source!=='derived'||!equal(n.data,{signature:d.row.signature}))bad();return}
  const original=refs.get(n.id);if(!original||n.kind!==original.kind||n.source!==original.source||n.sourceSeq!==original.sourceSeq||!equal(n.data,original.data))bad()
 }
 if(ref==='graph'){keys(v,['nodes','edges','digests']);const ds=digests(v.digests,refs,input,hash);const nodes=list(v.nodes),edges=list(v.edges),nodeIds=new Set(),edgeIds=new Set();for(const n of nodes){node(n,ds);const id=object(n).id;if(nodeIds.has(id))bad();nodeIds.add(id)}
 if(nodeIds.size!==refs.size+ds.size)bad();for(const e of edges){edge(e,input,refs,ds);const id=object(e).id;if(edgeIds.has(id))bad();edgeIds.add(id)}
 const expectedEdges=input.events.filter(e=>e.type==='attempt'||e.type==='receipt'||e.type==='edge'&&refs.has(e.from??'')&&refs.has(e.to??'')).length+input.criteria.filter(c=>c.source==='code_verified'&&c.status==='passed'&&refs.has(input.proofRef)).length+[...ds.values()].reduce((sum,d)=>sum+d.members.size,0);if(edgeIds.size!==expectedEdges)bad()}
 else if(ref.startsWith('digest-')){if(v.id!==ref)bad();digests([v],refs,input,hash)}
 else{if(v.id!==ref)bad();node(v,new Map())}
 return v
}
