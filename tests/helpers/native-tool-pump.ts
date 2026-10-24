import assert from 'node:assert/strict'
import type {BrowserFlowService} from '../../src/index.ts'
import {validateCommand} from '../../src/protocol.ts'
import {programFor,type PageOperation} from '../../src/clientcore.ts'
import {PAGE_CODE} from '../../src/panel.ts'
import {expectOk,expectRecord,expectString,present} from './assertions.ts'
/** Drive the actual six-tool command channel against one owned native page. */
export function nativeToolPump(service:BrowserFlowService,agent:{id:string},page:(program:string)=>Promise<unknown>,instanceId='panel',generation=1) {
 return async(name:string,args:Record<string,unknown>)=>{
  let ready!:()=>void;const signal=new Promise<void>(r=>{ready=r}),original=service.state.run
  service.state.run=(...args)=>{const pending=original(...args);ready();return pending}
  try{
   const result=present(service.tools.get(name)).execute(args,{agent,signal:new AbortController().signal})
   const first=await Promise.race([signal.then(()=>({queued:true as const})),result.then(value=>({queued:false as const,value}))])
   if(!first.queued)return first.value
   const command=expectOk(service.state.takeCommands(instanceId,generation,service.config)).commands[0];assert.ok(command)
   const checked=validateCommand({...command,kind:'command'});assert.ok(checked.ok)
   const value=expectRecord(await page(programFor(PAGE_CODE,checked.command.op as PageOperation))),error=expectRecord(value.error??{})
   service.state.settle({task:command.task,id:command.id,leaseId:command.leaseId,instanceId,connectionGeneration:generation,epoch:command.epoch,sequence:command.sequence,...(value.ok?{outcome:'ok',payload:expectRecord(value.value)}:{outcome:'failed',error:{code:expectString(error.code),message:expectString(error.message)}})},service.config)
   return await result
  }finally{service.state.run=original}
 }
}
