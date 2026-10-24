/** Shared ownership, confirmation and single-use lifecycle; file policies stay in callers. */
import {bindingKey,type FileLease} from './file-core.ts'
export interface BoundFileGrant {id:string;lease:FileLease;binding:string;state:'prepared'|'confirmed'|'consumed'}
export class FileGrants<T extends BoundFileGrant> {
  readonly entries=new Map<string,T>();readonly preparing=new Set<FileLease>();readonly tasks=new Set<Promise<unknown>>();closed=false
  assertLive(entry:T,lease:FileLease):void {
    if(this.closed||lease.state!=='active'||entry.lease!==lease||entry.binding!==bindingKey(lease))throw new Error('file-binding-changed')
  }
  prune():void {for(const [id,e]of this.entries)if(e.lease.state!=='active'||e.binding!==bindingKey(e.lease))this.entries.delete(id)}
  current(lease:FileLease):T|undefined {this.prune();return [...this.entries.values()].find(e=>e.lease===lease)}
  protected own<R>(f:()=>Promise<R>):Promise<R>{const p=f();this.tasks.add(p);return p.finally(()=>this.tasks.delete(p))}
  protected beginPrepare(lease:FileLease):void {
    this.prune();if(this.closed||lease.state!=='active'||this.preparing.has(lease)||this.current(lease))throw new Error('file-preparation-unavailable')
    this.preparing.add(lease)
  }
  confirm(lease:FileLease,id:string):void {
    const e=this.entries.get(id);if(!e)throw new Error('file-grant-missing');this.assertLive(e,lease)
    if(e.state!=='prepared')throw new Error('file-grant-already-confirmed');e.state='confirmed'
  }
  protected consume(lease:FileLease,id:string):T {
    const e=this.entries.get(id);if(!e)throw new Error('file-grant-missing');this.assertLive(e,lease)
    if(e.state!=='confirmed')throw new Error(e.state==='consumed'?'file-grant-consumed':'file-grant-not-confirmed')
    e.state='consumed';return e
  }
  async close():Promise<void>{this.closed=true;this.entries.clear();await Promise.allSettled([...this.tasks])}
}
/** Every Host lifecycle point retires both strategies through this one collection. */
export class FileGrantCollection {
 constructor(private readonly members:readonly {prune():void;close():Promise<void>}[]){}
 prune():void {for(const member of this.members)member.prune()}
 async close():Promise<void>{await Promise.all(this.members.map(m=>m.close()))}
}
