/** Inspector transport for the already-owned synthetic Desktop fixture. */
import {expectRecord,expectList,expectString} from './assertions.ts'
export async function attachInspector(port:number){
 const targets=expectList(await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(5000)})).json())
 const target=targets.map(expectRecord).find(target=>target.type==='node')
 const ws=new WebSocket(expectString(target?.webSocketDebuggerUrl))
 await new Promise<void>((resolve,reject)=>{ws.addEventListener('open',()=>resolve(),{once:true});ws.addEventListener('error',reject,{once:true})})
 let sequence=0
 const pending=new Map<number,{resolve:(value:Record<string,unknown>)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
 ws.addEventListener('message',event=>{
  const value=expectRecord(JSON.parse(String(event.data)))
  if(typeof value.id!=='number')return
  const entry=pending.get(value.id);if(!entry)return
  pending.delete(value.id);clearTimeout(entry.timer)
  if(value.error)entry.reject(new Error(JSON.stringify(value.error)));else entry.resolve(expectRecord(value.result))
 })
 function rpc(method:string,params:object):Promise<Record<string,unknown>> {return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('inspector timeout'))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
 return {async evaluate(expression:string):Promise<unknown>{const result=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return expectRecord(result.result).value},close(){for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('inspector closed'))}pending.clear();ws.close()}}
}
