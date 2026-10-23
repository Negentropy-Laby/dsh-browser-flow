/** Versioned disk vocabulary. Unknown events cannot be interpreted as harmless history. */
import { validRunScope, sameRunScope } from './task-scope.ts'
import { validExplorationEvent, isExploration } from './task-exploration.ts'
import { validUserWait } from './task-wait.ts'
import { validOrigins } from './task-definitions.ts'

/** The first explicit task storage generation; unversioned predecessors are read-only. */
export const TASK_FORMAT_VERSION = 1
export const EXPLORATION_FORMAT_VERSION = 2
export const supportedTaskFormat=(v:unknown)=>v===1||v===2
/** @param {unknown} value - JSON. @returns {value is Record<string, unknown>} object. */
export const taskRecord = (value: unknown) : value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
/** @param {unknown} value - text. @param {number} max - maximum length. @returns {value is string} bounded text. */
const text = (value: unknown,max: number=1000) : value is string => typeof value==='string' && value.length>0 && value.length<=max
/** @param {unknown} value - declared conditions. @returns {value is string[]} bounded conditions. */
const conditions = (value: unknown) : value is string[] => Array.isArray(value) && value.length<=32 && value.every(item=>text(item))
/** @param {unknown} raw - manifest from disk. @param {boolean} [legacy] - accept the predecessor's missing version only for inspection. @returns {raw is import('./task-store.ts').Manifest} supported manifest fields. */
export function validTaskManifest(raw: unknown,legacy: boolean=false) : raw is import('./task-store.ts').Manifest {
  if(!taskRecord(raw) || !(supportedTaskFormat(raw.schemaVersion) || (legacy && (raw.schemaVersion===undefined||Number.isSafeInteger(raw.schemaVersion))))
    || !taskRecord(raw.scope) || !validRunScope({...raw.scope,runId:raw.runId,workflowRef:raw.workflowRef}) || !text(raw.goal,2000)
    || !conditions(raw.constraints) || !conditions(raw.criteria) || !validOrigins(raw.origins)
    || !['generic','bjrsj'].includes(String(raw.adapter)) || raw.adapterVersion!==1)return false
  if(raw.schemaVersion===2 && (!(raw.adapter==='generic'&&raw.workflowRef==='exploration')||!String(raw.goal).trim()||(raw.criteria as string[]).some(c=>!c.trim())))return false
  if(raw.adapter==='bjrsj' && !['navigation','import'].includes(String(raw.workflowRef)))return false
  return raw.definitionId===undefined || (text(raw.definitionId,100)&&text(raw.definitionVersion,100)&&typeof raw.definitionDigest==='string'&&/^[a-f0-9]{64}$/.test(raw.definitionDigest))
}
/** @param {string} type - event discriminator. @param {Record<string,unknown>} row - disk payload. @param {import('./task-store.ts').Manifest} manifest - preceding manifest. @param {string | undefined} pending - original pending write. @param {import('./task-wait.ts').UserWait} [waiting] - active human dependency. @param {{kind:string,inputRef:string}} [waitInput] - input observed after the wait. @returns {boolean} understood event semantics. */
export function validTaskEvent(type: string,row: Record<string, unknown>,manifest: import('./task-store.ts').Manifest,pending: string | undefined,waiting?: import('./task-wait.ts').UserWait,waitInput?: {
    kind: string;
    inputRef: string;
}) : boolean {
  const fields={wait_requested:['id','kind','reason','resumeCondition','owner','source','run'],wait_input:['waitId','kind','inputRef','source','run'],wait_resolved:['waitId','source','inputRef','userInput','run'],created:['manifest'],revise:['manifest'],attempt:['attemptId','action','run',...(isExploration(manifest)?['intentId']:[])],receipt:['attemptId','outcome','run','fileGrantId'],status:['state','run'],asset:['id','kind','data','source','run'],edge:['id','from','to','relation','run'],waiting:['condition','for','source','run'],exploration:['requestId','expectedVersion','command','changes','result','run'],business_verdict:['verdict','qualified','source','run','pageRef','resultRef','reason','proofRef','criterionId','validatorId','validatorVersion']}
  const allowed=(fields as Record<string, string[]>)[type]
  if(!allowed || Object.keys(row).some(key=>!allowed.includes(key)))return false
  if(type==='created')return validTaskManifest(row.manifest) && JSON.stringify(row.manifest)===JSON.stringify(manifest)
  if(type==='revise'){
    const next=row.manifest,current=manifest
    return validTaskManifest(next) && next.scope.profileId===current.scope.profileId && next.scope.taskId===current.scope.taskId
      && next.scope.ownerSessionId===current.scope.ownerSessionId && next.scope.scopeRevision===current.scope.scopeRevision+1
      && next.runId!==current.runId && next.adapter===current.adapter && next.adapterVersion===current.adapterVersion && next.definitionDigest===current.definitionDigest
  }
  if(!validRunScope(row.run) || !sameRunScope(row.run,{...manifest.scope,runId:manifest.runId,workflowRef:manifest.workflowRef}))return false
  switch(type){
    case 'exploration':return isExploration(manifest)&&validExplorationEvent(row)
    case 'wait_requested':return !pending&&!waiting&&text(row.id,100)&&row.owner==='user'&&row.source==='model_declared'&&validUserWait({kind:row.kind,reason:row.reason,resumeCondition:row.resumeCondition})
    case 'wait_input':return !!waiting&&row.waitId===waiting.id&&row.kind===waiting.kind&&row.source==='host_verified'&&text(row.inputRef,1000)
    case 'wait_resolved':return !!waiting&&row.waitId===waiting.id&&(['page_authorization','file_input','file_confirmation'].includes(waiting.kind)?row.source==='host_verified'&&text(row.inputRef,1000)&&waitInput?.inputRef===row.inputRef:row.source==='user_declared'&&text(row.userInput,1000))
    case 'attempt':return (!waiting||['prepare_file','confirm_file'].includes(String(row.action)))&&pending===undefined && typeof row.attemptId==='string' && /^attempt-[a-f0-9-]{36}$/.test(row.attemptId) && ['click','type','select','check','set_file','prepare_file','confirm_file'].includes(String(row.action))
    case 'receipt':return text(row.attemptId,100) && pending===row.attemptId && ['executed','not_executed','not_dispatched','unknown_outcome'].includes(String(row.outcome))
    case 'status':return ['cancelled','handed_off'].includes(String(row.state))
    case 'asset':return text(row.id,100) && ['page','file','unit_check','import_result','evidence'].includes(String(row.kind)) && ['host','code_verified'].includes(String(row.source)) && taskRecord(row.data)
    case 'edge':return text(row.id,100)&&text(row.from,200)&&text(row.to,200)&&['observed_on','validated_by','derived_from','selected_from','proves','yields'].includes(String(row.relation))
    case 'waiting':return row.source==='host' && (['present','absent','text'].includes(String(row.condition)) || text(row.for))
    case 'business_verdict':return text(row.verdict,100) && ['code_verified','model_intent'].includes(String(row.source)) && (row.qualified===undefined||typeof row.qualified==='boolean')
    default:return false
  }
}
