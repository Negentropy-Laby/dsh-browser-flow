/** Host-issued identities describe resources; they confer no control or proof. */
import { createHash } from 'node:crypto'
import { record } from './graph/protocol.ts'
import { orderedRunScope, runIdentity, sameRunScope } from './task-scope.ts'
import type { RunScope } from './task-scope.ts'
import type { TaskEvent } from './task-store.ts'
export { runIdentity } from './task-scope.ts'

export interface ResourceIdentity {
  version: 1
  key: string
  basis: 'document_instance' | 'source_path'
  snapshotKind: 'observation' | 'context' | 'file'
}
export interface ResourceDescriptor {
  id: string
  basis: 'document_instance' | 'source_path' | 'independent' | 'unavailable'
  snapshotKind: 'observation' | 'context' | 'file' | 'record' | 'unknown'
  groupingReason: string
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
/** Called only after Host guest/lease validation, never with model-supplied identity. */
export function pageIdentity(run: RunScope,guest: {connectionInstanceId:string;connectionGeneration:number;lease:string;partition:string;documentToken:string},snapshotKind:'observation'|'context'):ResourceIdentity {
  // The control store identifies the physical guest by lease + partition across
  // panel remounts. Transport generations and control grant IDs are not documents.
  return {version:1,key:digest(['page',runIdentity(run),guest.lease,guest.partition,guest.documentToken]),basis:'document_instance',snapshotKind}
}
/** The caller supplies the checked canonical source from the existing file preparation. */
export function fileIdentity(run:RunScope,canonicalSource:string):ResourceIdentity {
  return {version:1,key:digest(['file',runIdentity(run),canonicalSource]),basis:'source_path',snapshotKind:'file'}
}
/** Allowlisted projection metadata. Unknown/old metadata never invents grouping. */
export function resourceDescriptor(run:RunScope,kind:string,id:string,data:unknown):ResourceDescriptor {
  const identity=record(data)?data.resourceIdentity:undefined
  const known=record(identity)&&identity.version===1&&typeof identity.key==='string'&&/^[a-f0-9]{64}$/.test(identity.key)
    && ((kind==='page'&&identity.basis==='document_instance'&&['observation','context'].includes(String(identity.snapshotKind)))
      ||(kind==='file'&&identity.basis==='source_path'&&identity.snapshotKind==='file'))
  return {
    id:'resource-'+digest(['resource',1,runIdentity(run),kind,known?identity.key:id]),
    basis:known?identity.basis as ResourceDescriptor['basis']:['page','file'].includes(kind)?'unavailable':'independent',
    snapshotKind:known?identity.snapshotKind as ResourceDescriptor['snapshotKind']:['page','file'].includes(kind)?'unknown':'record',
    groupingReason:known?'host_identity':['page','file'].includes(kind)?'reliable_identity_unavailable':'independent_record',
  }
}

const descriptors=new WeakMap<TaskEvent,{run:RunScope;value:ResourceDescriptor}>()
/** Immutable journal rows share one descriptor across safe input and lookup paths. */
export function eventResourceDescriptor(event:TaskEvent,run:RunScope):ResourceDescriptor {
  const cached=descriptors.get(event)
  if(cached&&sameRunScope(cached.run,run))return cached.value
  const value=Object.freeze(resourceDescriptor(run,String(event.data.kind),String(event.data.id),event.data.data))
  descriptors.set(event,{run:orderedRunScope(run),value})
  return value
}

/** Matches Go json.Marshal, separate from the existing Host tuple encoding. */
export function kernelFallbackDescriptor(run:RunScope,kind:string,id:string):ResourceDescriptor {
  const encoded=JSON.stringify([orderedRunScope(run),kind,id]).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))
  return {id:'resource-'+createHash('sha256').update(encoded).digest('hex'),basis:'unavailable',snapshotKind:'unknown',groupingReason:'reliable_identity_unavailable'}
}
