/** Cross-process output validation against the exact sanitized replay input. */
import { GraphError, record } from './protocol.ts'
import type { GraphInput, JsonRecord } from './protocol.ts'
import { createHash } from 'node:crypto'
interface Expected {kind:string;source:string;sourceSeq:number;data:JsonRecord;run:string}
function bad():never {throw new GraphError('invalid_projection')}
function object(value:unknown):JsonRecord {return record(value)?value:bad()}
function list(value:unknown):unknown[]{return Array.isArray(value)?value:bad()}
function keys(value:JsonRecord,allowed:string[]):void {if(Object.keys(value).some(key=>!allowed.includes(key)))bad()}
function integer(value:unknown):void {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)bad()}
function equal(a:unknown,b:unknown):boolean {if(record(a)&&record(b)){const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();return equal(ak,bk)&&ak.every(k=>equal(a[k],b[k]))};if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>equal(v,b[i]));return a===b}
interface ExpectedEdge {id:string;taskId:string;from:string;to:string;relation:string;sourceSeq:number}
function expected(input:GraphInput):{refs:Map<string,Expected>;edges:Map<string,ExpectedEdge>} {
 const result=new Map<string,Expected>(),edges=new Map<string,ExpectedEdge>(),goal=(s:GraphInput['scope'])=>`goal-${s.taskId}-r${s.scopeRevision}`
 const add=(id:string,node:Expected)=>{const prior=result.get(id);if(prior){prior.data=node.data;prior.sourceSeq=node.sourceSeq}else result.set(id,node)}
 const link=(id:string,from:string,to:string,relation:string,sourceSeq:number)=>{
  if(!result.has(from)||!result.has(to))return
  if(edges.has(id))bad()
  edges.set(id,{id,taskId:input.scope.taskId,from,to,relation,sourceSeq})
 }
 for(const e of input.events){const run=JSON.stringify([e.run.profileId,e.run.taskId,e.run.ownerSessionId,e.run.scopeRevision,e.run.runId,e.run.workflowRef])
  if(e.type==='created'||e.type==='revise')add(goal(e.run),{kind:'goal',source:'user_declared',sourceSeq:e.seq,data:{goal:e.goal},run})
  if(e.type==='asset'&&e.id)add(e.id,{kind:e.kind??'',source:e.source??'',sourceSeq:e.seq,data:{...(e.kind==='page'?{documentToken:e.documentToken??''}:{}),...(e.resource?{resourceRef:e.resource.id,snapshotKind:e.resource.snapshotKind}:{})},run})
  if(e.type==='attempt'&&e.id){add(e.id,{kind:'intent',source:'model_intent',sourceSeq:e.seq,data:{action:e.action,status:'pending',businessSuccess:false},run});link(`intent-edge-${e.seq}`,e.id,goal(e.run),'attempts',e.seq)}
  if(e.type==='receipt'&&e.id){const a=result.get(e.id);if(a)a.data.status=e.outcome;const id=`receipt-${input.scope.taskId}-${e.seq}`;add(id,{kind:'receipt',source:'host',sourceSeq:e.seq,data:{outcome:e.outcome},run});link(`receipt-edge-${e.seq}`,id,e.id,'records',e.seq)}
  if(e.type==='edge')link(e.id??'',e.from??'',e.to??'',e.relation??'',e.seq)
 }
 const run=JSON.stringify([input.scope.profileId,input.scope.taskId,input.scope.ownerSessionId,input.scope.scopeRevision,input.scope.runId,input.scope.workflowRef])
 add(goal(input.scope),{kind:'goal',source:'user_declared',sourceSeq:1,data:{goal:input.goal},run})
 for(const c of input.criteria){
  add(c.id,{kind:'criterion',source:c.source,sourceSeq:1,data:{label:c.label,status:c.status,validatorId:c.validatorId??'',validatorVersion:c.version??0},run})
  if(c.source==='code_verified'&&c.status==='passed')link(`proof-edge-${input.proofSeq}-${c.id}`,input.proofRef,c.id,'proves',input.proofSeq)
 }
 return {refs:result,edges}
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
function edge(value:unknown,input:GraphInput,refs:Map<string,Expected>,ds:Map<string,DigestRecord>,edges:Map<string,ExpectedEdge>):void {
 const row=object(value);keys(row,['id','taskId','from','to','relation','sourceSeq']);if(row.taskId!==input.scope.taskId||typeof row.from!=='string'||typeof row.to!=='string'||!refs.has(row.to))bad()
 if(row.relation==='covers'){const d=ds.get(row.from);if(!d||!d.members.has(row.to)||row.id!==row.from+':'+row.to||row.sourceSeq!==0)bad();return}
 if(typeof row.id!=='string'||!equal(row,edges.get(row.id)))bad()
}
function attempt(value:unknown,refs:Map<string,Expected>,frontier:boolean):void {
 const row=object(value);keys(row,['id','action','status','sourceSeq','source','businessSuccess']);if(typeof row.id!=='string')bad();const n=refs.get(row.id)
 if(!n||n.kind!=='intent'||row.action!==n.data.action||row.status!==n.data.status||row.sourceSeq!==n.sourceSeq||row.source!=='model_intent'||row.businessSuccess!==false)bad()
 if(frontier&&!['pending','unknown_outcome'].includes(String(row.status)))bad()
}
function isAsset(kind:string):boolean{return ['page','file','unit_check','import_result','evidence'].includes(kind)}
function scopeFromKey(key:string):GraphInput['scope'] {
 const [profileId,taskId,ownerSessionId,scopeRevision,runId,workflowRef]=JSON.parse(key)
 return {profileId,taskId,ownerSessionId,scopeRevision,runId,workflowRef}
}
interface ExpectedResource {id:string;kind:string;run:GraphInput['scope'];basis:string;groupingReason:string;snapshots:string[]}
function dualExpected(input:GraphInput,refs:Map<string,Expected>,edges:Map<string,ExpectedEdge>) {
 const resources=new Map<string,ExpectedResource>()
 for(const e of input.events)if(e.type==='asset'&&e.id){
  // Matches the kernel fallback for direct IPC fixtures; normal Host input always supplies a descriptor.
  const s=e.run,ordered={profileId:s.profileId,taskId:s.taskId,ownerSessionId:s.ownerSessionId,scopeRevision:s.scopeRevision,runId:s.runId,workflowRef:s.workflowRef}
  const encoded=JSON.stringify([ordered,e.kind,e.id]).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))
  const d=e.resource??{id:'resource-'+createHash('sha256').update(encoded).digest('hex'),basis:'unavailable',groupingReason:'reliable_identity_unavailable'}
  const r=resources.get(d.id)
  if(r){if(!equal(r.run,e.run)||r.kind!==e.kind||r.basis!==d.basis||r.groupingReason!==d.groupingReason||['independent','unavailable'].includes(r.basis))bad();r.snapshots.push(e.id)}
  else resources.set(d.id,{id:d.id,kind:e.kind??'',run:e.run,basis:d.basis,groupingReason:d.groupingReason,snapshots:[e.id]})
 }
 const anchors=[...edges.values()].filter(e=>isAsset(refs.get(e.from)!.kind)!==isAsset(refs.get(e.to)!.kind)).map(e=>({...e,run:input.events[e.sourceSeq-1]?.run??input.scope,fromRun:scopeFromKey(refs.get(e.from)!.run),toRun:scopeFromKey(refs.get(e.to)!.run)}))
 return {resources,anchors}
}
function exactRows(value:unknown,expectedRows:unknown[]):void {if(!equal(value,expectedRows))bad()}
function connected(seeds:string[],edges:Map<string,ExpectedEdge>):Set<string> {
 const adjacent=new Map<string,string[]>(),seen=new Set<string>(),queue=[...seeds]
 for(const e of edges.values())if(e.relation!=='attempts'){adjacent.set(e.from,[...(adjacent.get(e.from)??[]),e.to]);adjacent.set(e.to,[...(adjacent.get(e.to)??[]),e.from])}
 for(let i=0;i<queue.length;i++){const id=queue[i];if(seen.has(id))continue;seen.add(id);for(const other of adjacent.get(id)??[])if(!seen.has(other))queue.push(other)}
 return seen
}
/** @param value - worker payload. @param input - original safe input. @param hash - projection identity. @returns Closed owned view with no generated authority fields. */
export function validateView(value:unknown,input:GraphInput,hash:string):JsonRecord {
 const v=object(value);if(Object.keys(v).sort().join(',')!=='active_context,knowledge_graph,procedural_law_index,technical_law_index')bad()
 const p=object(v.procedural_law_index),t=object(v.technical_law_index),g=object(v.knowledge_graph),a=object(v.active_context),{refs,edges:expectedEdges}=expected(input)
 keys(p,['goal','constraints','criteria','intents','frontier','details','criteriaRef']);keys(t,['assets','total','byKind']);keys(g,['nodes','edges','totalEdges','totalNodes','digests','digestCount','details','views']);keys(a,['recentAssets','round','complete','truncated'])
 if(p.goal!==undefined&&!equal(p.goal,{text:input.goal,source:'user_declared'}))bad()
 if(p.constraints!==undefined&&!equal(p.constraints,input.constraints))bad()
 if(p.criteria!==undefined&&!equal(p.criteria,input.criteria))bad()
 for(const row of p.intents===undefined?[]:list(p.intents))attempt(row,refs,false)
 for(const row of p.frontier===undefined?[]:list(p.frontier))attempt(row,refs,true)
 for(const row of t.assets===undefined?[]:list(t.assets))metadata(row,refs,true)
 for(const row of a.recentAssets===undefined?[]:list(a.recentAssets))metadata(row,refs,true)
 for(const row of g.nodes===undefined?[]:list(g.nodes))metadata(row,refs)
 const ds=digests(g.digests??[],refs,input,hash)
 for(const row of g.edges===undefined?[]:list(g.edges))edge(row,input,refs,ds,expectedEdges)
 for(const row of [t.total,g.totalEdges,g.totalNodes,g.digestCount,a.round])if(row!==undefined)integer(row)
 if(t.byKind!==undefined){const counts=object(t.byKind);keys(counts,['page','file','unit_check','import_result','evidence']);for(const count of Object.values(counts))integer(count)}
 if(typeof a.complete!=='boolean'||(a.truncated!==undefined&&typeof a.truncated!=='boolean'))bad()
 if((g.details!==undefined&&g.details!=='graph')||(p.details!==undefined&&p.details!=='goal')||(p.criteriaRef!==undefined&&p.criteriaRef!=='criteria'))bad()
 const dual=dualExpected(input,refs,expectedEdges),assetCount=[...refs.values()].filter(n=>isAsset(n.kind)).length
 if(!equal(g.views,{assets:{details:'graph:assets',resources:dual.resources.size,snapshots:assetCount,recentResources:[...dual.resources.keys()].slice(-8)},exploration:{details:'graph:exploration',nodes:refs.size-assetCount+Number(g.digestCount),anchors:dual.anchors.length}}))bad()
 return v
}
/** @param value - detail reply. @param ref - requested reference. @param input - original safe input. @param hash - projection identity. @returns Owned immutable detail. */
export function validateDetail(value:unknown,ref:string,input:GraphInput,hash:string):unknown {
 const v=object(value),{refs,edges:expectedEdges}=expected(input)
 const node=(value:unknown,ds:Map<string,DigestRecord>)=>{const n=object(value);keys(n,['id','taskId','kind','source','sourceSeq','data']);if(n.taskId!==input.scope.taskId||typeof n.id!=='string')bad()
  if(n.kind==='digest'){const d=ds.get(n.id);if(!d||n.source!=='derived'||!equal(n.data,{signature:d.row.signature}))bad();return}
  const original=refs.get(n.id);if(!original||n.kind!==original.kind||n.source!==original.source||n.sourceSeq!==original.sourceSeq||!equal(n.data,original.data))bad()
 }
 if(ref==='graph:assets'||ref==='graph:exploration'||ref.startsWith('resource-')){
  const {resources,anchors}=dualExpected(input,refs,expectedEdges),assetNodes=[...refs].filter(([,n])=>isAsset(n.kind)).map(([id])=>id)
  const nodes=(values:unknown,ids:string[],ds=new Map<string,DigestRecord>())=>{const rows=list(values);if(rows.length!==ids.length)bad();rows.forEach((n,i)=>{node(n,ds);if(object(n).id!==ids[i])bad()})}
  if(ref==='graph:assets'){
   keys(v,['resources','snapshots','relations','anchors']);exactRows(v.resources,[...resources.values()]);nodes(v.snapshots,assetNodes)
   exactRows(v.relations,[...expectedEdges.values()].filter(e=>isAsset(refs.get(e.from)!.kind)&&isAsset(refs.get(e.to)!.kind)));exactRows(v.anchors,anchors)
  }else if(ref==='graph:exploration'){
   keys(v,['nodes','relations','anchors','digests']);const ds=digests(v.digests,refs,input,hash)
   nodes(v.nodes,[...refs].filter(([,n])=>!isAsset(n.kind)).map(([id])=>id).concat([...ds.keys()]),ds)
   const edges=[...expectedEdges.values()].filter(e=>!isAsset(refs.get(e.from)!.kind)&&!isAsset(refs.get(e.to)!.kind))
   for(const [id,d] of ds)for(const member of d.members)edges.push({id:id+':'+member,taskId:input.scope.taskId,from:id,to:String(member),relation:'covers',sourceSeq:0})
   exactRows(v.relations,edges);exactRows(v.anchors,anchors)
  }else{
   keys(v,['resource','snapshots','relations','anchors','explorationRefs','evidenceRefs']);const r=resources.get(ref);if(!r||!equal(v.resource,r))bad()
   nodes(v.snapshots,r.snapshots);const seen=connected(r.snapshots,expectedEdges)
   exactRows(v.relations,[...expectedEdges.values()].filter(e=>seen.has(e.from)&&seen.has(e.to)&&isAsset(refs.get(e.from)!.kind)&&isAsset(refs.get(e.to)!.kind)))
   exactRows(v.anchors,anchors.filter(e=>seen.has(e.from)&&seen.has(e.to)))
   exactRows(v.explorationRefs,[...seen].filter(id=>!isAsset(refs.get(id)!.kind)).sort());exactRows(v.evidenceRefs,[...seen].filter(id=>refs.get(id)!.kind==='evidence').sort())
  }
 }
 else if(ref==='graph'){keys(v,['nodes','edges','digests']);const ds=digests(v.digests,refs,input,hash);const nodes=list(v.nodes),edges=list(v.edges),nodeIds=new Set(),edgeIds=new Set();for(const n of nodes){node(n,ds);const id=object(n).id;if(nodeIds.has(id))bad();nodeIds.add(id)}
 if(nodeIds.size!==refs.size+ds.size)bad();for(const e of edges){edge(e,input,refs,ds,expectedEdges);const id=object(e).id;if(edgeIds.has(id))bad();edgeIds.add(id)}
 const expectedCount=expectedEdges.size+[...ds.values()].reduce((sum,d)=>sum+d.members.size,0);if(edgeIds.size!==expectedCount)bad()}
 else if(ref.startsWith('digest-')){if(v.id!==ref)bad();digests([v],refs,input,hash)}
 else{if(v.id!==ref)bad();node(v,new Map())}
 return v
}
