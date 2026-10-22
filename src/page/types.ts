/** DOM runtime state for the fixed page programs. */
import type {PagePolicy} from './input.ts'
export type {PageResult,BatchKind,PagePolicy,PageActionInput,PageWaitInput,ImportFile,ImportInput,ImportConfig} from './input.ts'
export interface PageRegistry {documentToken:string;refs:Map<string,Element>;nextRef:number;importState?:ImportState}
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
