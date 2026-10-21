/** DOM-side types describe fixed programs; Host authority never comes from them. */
export type PageResult = {ok:true;value:Record<string,unknown>} | {ok:false;error:{code:string;message:string}}
export type BatchKind = 'add' | 'modify' | 'reduce'
export interface PagePolicy {adapter?:string; workflow?:string; kind?:BatchKind}
export interface PageRegistry {documentToken:string;refs:Map<string,Element>;nextRef:number;importState?:ImportState}
interface ActionTarget {documentToken:string;elementRef:string;pagePolicy?:PagePolicy;importScope?:PagePolicy}
/** Action-specific fields are validated before a fixed program is selected. */
export type PageActionInput = ActionTarget & (
  {action:'click'} | {action:'type'|'select';value:string} | {action:'check';checked:boolean}
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
export interface ObservedRequest {
  id:string;method:string;url:string;unit:boolean;check:boolean;owned:boolean;startedAt:number
  complete:boolean;status:number;body:string;failed:boolean;finished?:boolean;responseUrl?:string
}
interface ImportPerson {name:string;certificateNumber:string}
interface ImportTables {fresh:boolean;complete:boolean;accepted:ImportPerson[];rejected:ImportPerson[]}
interface ImportSummary {total:number;success:number;failure:number}
export interface ImportFacts {
  requestCount:number;pending:number;interference:boolean
  response?:{requestId:string;responseRequestId:string;method:string;url:string;status:number;complete:boolean;body:string}
  tables?:ImportTables;summary?:ImportSummary
}
export interface ImportState {
  owner:string;scope:PagePolicy;documentToken:string;closed:boolean;cleanupFailed:boolean;coverage:boolean
  requests:ObservedRequest[];resources:{name:string;startTime:number;responseEnd:number}[]
  unitBodies:string[];unitPending:number;selectedAt:number|null;fileGrantId:string|null;selectedNode:HTMLInputElement|null
  acceptedChange:number;rejectedChange:number;version:number;summary:ImportSummary|null;summaryAt:number
  issue:boolean;expired:boolean;cache:ImportFacts|null
  listeners:{target:XMLHttpRequest;listener:EventListener}[];timer:number|null
  observer:MutationObserver|null;resourceObserver:PerformanceObserver|null
  hooksIntact:()=>boolean;dispose:()=>void;snapshot:()=>ImportFacts
}
