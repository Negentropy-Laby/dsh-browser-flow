/** JSON response decoding for the panel's existing authenticated routes. */
import {isRecord,validateCommand,type CommandEnvelope} from './protocol.ts'
import type {PageOperation} from './clientcore.ts'
import {validRunScope,type RunScope} from './task-scope.ts'
import type {PagePolicy} from './page/input.ts'

export interface PanelError {code:string;message:string}
export interface TaskSummary extends Record<string,unknown> {
  task:RunScope;state:string;goal:string;adapter:string;writeBlocked:boolean
  active_context?:{waiting?:{id:string;reason:string;resumeCondition:string}|null}
}
export interface DefinitionOption {id:string;workflows:{id:string;description:string}[]}
export interface AgentSummary {id:string;instance:string;authorizedLeaseCount?:number;controlLeaseIds?:string[]}
export interface FilePreview {fileGrantId:string;path:string;sha256:string;bytes:number;rows:number;kind:string;confirmed?:boolean}
export interface PanelValue extends Record<string,unknown> {
  protocolVersion?:number;generation?:number;task?:RunScope|TaskSummary|null
  commands?:PanelCommand[];dropped?:string[];controls?:string[];definitions?:DefinitionOption[];agent?:AgentSummary|null
  controlLeaseId?:string;epoch?:number;documentToken?:string;nextSequence?:number;origins?:string[];pagePolicy?:PagePolicy
  affected?:{controlLeaseId:string;state:string;epoch:number}[]
}
export type PanelCommand=Omit<CommandEnvelope,'op'|'kind'> & {op:PageOperation;budgetMs?:number}
export type PanelReply={ok:true;value:PanelValue;error?:undefined}|{ok:false;error:PanelError;value?:undefined}
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(item=>typeof item==='string')
/** @param value - route data. @returns Whether it contains the task fields displayed by the panel. */
export function isTaskSummary(value:unknown):value is TaskSummary {
  if(!isRecord(value)||!validRunScope(value.task)||typeof value.state!=='string'||typeof value.goal!=='string'||typeof value.adapter!=='string'||typeof value.writeBlocked!=='boolean')return false
  if(value.active_context!==undefined){
    if(!isRecord(value.active_context))return false
    const wait=value.active_context.waiting
    if(wait!==undefined&&wait!==null&&(!isRecord(wait)||typeof wait.id!=='string'||typeof wait.reason!=='string'||typeof wait.resumeCondition!=='string'))return false
  }
  return true
}
/** @param value - private panel preview. @returns Whether all displayed file fields are present. */
export function isFilePreview(value:unknown):value is FilePreview {
  return isRecord(value)&&['fileGrantId','path','sha256','kind'].every(key=>typeof value[key]==='string')&&typeof value.bytes==='number'&&typeof value.rows==='number'&&(value.confirmed===undefined||typeof value.confirmed==='boolean')
}
/** @param raw - untrusted response JSON. @returns A decoded reply or a visible protocol refusal. */
export function decodePanelReply(raw:unknown):PanelReply {
  const invalid:PanelReply={ok:false,error:{code:'protocol_violation',message:'Host response fields are invalid; reload the paired Host and Client'}}
  if(!isRecord(raw))return invalid
  if(raw.ok!==true)return isRecord(raw.error)&&typeof raw.error.code==='string'&&typeof raw.error.message==='string'?{ok:false,error:{code:raw.error.code,message:raw.error.message}}:invalid
  const value=raw.value
  if(!isRecord(value))return invalid
  for(const key of ['protocolVersion','generation','epoch','nextSequence'])if(value[key]!==undefined&&(typeof value[key]!=='number'||!Number.isSafeInteger(value[key])))return invalid
  for(const key of ['controlLeaseId','documentToken'])if(value[key]!==undefined&&typeof value[key]!=='string')return invalid
  for(const key of ['dropped','controls','origins'])if(value[key]!==undefined&&!strings(value[key]))return invalid
  if(value.task!==undefined&&value.task!==null&&!validRunScope(value.task)&&!isTaskSummary(value.task))return invalid
  if(value.commands!==undefined&&(!Array.isArray(value.commands)||!value.commands.every(command=>isRecord(command)&&validateCommand({...command,kind:'command'}).ok&&(command.budgetMs===undefined||(typeof command.budgetMs==='number'&&Number.isFinite(command.budgetMs)&&command.budgetMs>=0)))))return invalid
  if(value.definitions!==undefined&&(!Array.isArray(value.definitions)||!value.definitions.every(row=>isRecord(row)&&typeof row.id==='string'&&Array.isArray(row.workflows)&&row.workflows.every(workflow=>isRecord(workflow)&&typeof workflow.id==='string'&&typeof workflow.description==='string'))))return invalid
  if(value.affected!==undefined&&(!Array.isArray(value.affected)||!value.affected.every(row=>isRecord(row)&&typeof row.controlLeaseId==='string'&&typeof row.state==='string'&&typeof row.epoch==='number')))return invalid
  if(value.agent!==undefined&&value.agent!==null&&(!isRecord(value.agent)||typeof value.agent.instance!=='string'||typeof value.agent.id!=='string'||(value.agent.authorizedLeaseCount!==undefined&&(typeof value.agent.authorizedLeaseCount!=='number'||!Number.isSafeInteger(value.agent.authorizedLeaseCount)||value.agent.authorizedLeaseCount<0))||(value.agent.controlLeaseIds!==undefined&&!strings(value.agent.controlLeaseIds))))return invalid
  if(value.pagePolicy!==undefined&&(!isRecord(value.pagePolicy)||typeof value.pagePolicy.adapter!=='string'||typeof value.pagePolicy.workflow!=='string'||(value.pagePolicy.kind!==undefined&&(typeof value.pagePolicy.kind!=='string'||!['add','modify','reduce'].includes(value.pagePolicy.kind)))))return invalid
  return {ok:true,value:value as PanelValue}
}
