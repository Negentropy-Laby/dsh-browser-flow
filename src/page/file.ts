import type {PageResult} from './types.ts'
export interface FileMaterializationPolicy {
  mime:string;digest:boolean;inputComposed:boolean;changeComposed:boolean;elementRef?:string
  recheck:()=>PageResult|undefined;beforeAssign?:()=>void
}
/** Fixed shared materialization; callers retain distinct target and business policies. */
export function materializeFile(node:HTMLInputElement,file:{base64:string;bytes:number;sha256?:string;name:string;fileGrantId:string},policy:FileMaterializationPolicy):PageResult|Promise<PageResult> {
  const refusal=(code:string,message:string):PageResult=>({ok:false,error:{code,message}})
  let bytes:Uint8Array<ArrayBuffer>
  try{const raw=atob(file.base64);bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(bytes.length!==file.bytes)throw new Error('size')}catch{return refusal('invalid_request','file encoding or size is invalid')}
  const assign=():PageResult=>{
    const refused=policy.recheck();if(refused)return refused
    const transfer=new DataTransfer();transfer.items.add(new File([bytes],file.name,{type:policy.mime}))
    try{
      policy.beforeAssign?.();node.files=transfer.files
      node.dispatchEvent(new Event('input',{bubbles:true,composed:policy.inputComposed}))
      node.dispatchEvent(new Event('change',{bubbles:true,composed:policy.changeComposed}))
    }catch{return refusal('unknown_outcome','file selection may have run')}
    return {ok:true,value:{action:'set_file',fileGrantId:file.fileGrantId,dispatched:true,...(policy.elementRef?{elementRef:policy.elementRef}:{})}}
  }
  if(!policy.digest)return assign()
  if(!globalThis.crypto?.subtle)return refusal('unsupported','secure file digest is unavailable in this document')
  return crypto.subtle.digest('SHA-256',bytes).then(digest=>{
    const actual=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('')
    return actual===file.sha256?assign():refusal('invalid_request','file digest mismatch')
  })
}
