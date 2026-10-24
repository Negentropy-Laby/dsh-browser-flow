/** Bounded derived values only. A hit never establishes source availability. */
export class DerivedCache {
  private entries=new Map<string,{owner:string;value:unknown;bytes:number}>()
  private bytes=0
  constructor(private maxBytes:number,private maxEntries=32){}
  get<T>(key:string):T|undefined {
    const e=this.entries.get(key);if(!e)return undefined
    this.entries.delete(key);this.entries.set(key,e);return e.value as T
  }
  set(key:string,owner:string,value:unknown,bytes:number):void {
    const old=this.entries.get(key);if(old){this.bytes-=old.bytes;this.entries.delete(key)}
    if(bytes>this.maxBytes||bytes<0)return
    this.entries.set(key,{owner,value,bytes});this.bytes+=bytes
    while(this.entries.size>this.maxEntries||this.bytes>this.maxBytes){const first=this.entries.keys().next().value!;this.bytes-=this.entries.get(first)!.bytes;this.entries.delete(first)}
  }
  clear(owner?:string):void {
    for(const [key,e] of this.entries)if(owner===undefined||e.owner===owner){this.entries.delete(key);this.bytes-=e.bytes}
  }
}
export function immutableValue<T>(value:T):T {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const v of Object.values(value))immutableValue(v);Object.freeze(value)}
  return value
}
