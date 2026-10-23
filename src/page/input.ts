/** Fixed-program inputs and outputs shared with Node; no DOM runtime types. */
export type PageResult = {ok:true;value:Record<string,unknown>} | {ok:false;error:{code:string;message:string}}
export type BatchKind = 'add' | 'modify' | 'reduce'
export interface PagePolicy {adapter?:string; workflow?:string; kind?:BatchKind}
interface ActionTarget {documentToken:string;elementRef:string;pagePolicy?:PagePolicy;importScope?:PagePolicy}
/** Action-specific fields are validated before a fixed program is selected. */
export type PageActionInput = ActionTarget & (
  {action:'set_file';file:{fileGrantId:string;name:string;base64:string;bytes:number;sha256:string}} | {action:'click'} | {action:'type'|'select';value:string} | {action:'check';checked:boolean}
)
export interface PageWaitInput {target:{documentToken:string;elementRef:string};condition:string;text?:string;timeoutMs:number}
export interface ImportFile {fileGrantId:string;name:string;base64:string;bytes:number;kind:BatchKind;expectedIdentity:{unitId:string;legalIdentity:string}}
interface ImportOwner {owner:string;scope:PagePolicy;windowMs:number}
export type ImportInput = {mode:'dispose';owner:string} | ImportOwner & (
  {mode:'observe'} | {mode:'set_file';target:{documentToken:string;elementRef:string};file:ImportFile}
)
export interface ImportConfig {
  origin:string;paths:Record<BatchKind,string>;tabs:Record<BatchKind,string>;limit:number
  knowledge:{unitPathSuffixes:readonly string[];failureHeader:string;successHeader:string;excludedHeader:string;nameHeader:string;identityHeaders:readonly string[];uploadLabel:string}
}
