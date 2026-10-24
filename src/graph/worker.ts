/** Owned task workers. Failures cannot alter journals, permissions or business facts. */
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import { sameRunScope, validRunScope } from '../task-scope.ts'
import { validateView, validateDetail } from './validation.ts'
import {BinaryVerifier} from './binary.ts'
import type {Binary} from './binary.ts'
import { Frames, GraphError, frame, record } from './protocol.ts'
import type { GraphConfig, GraphInput, GraphRequest, JsonRecord, ProcessHandle, SubprocessPort } from './protocol.ts'

/** @param bytes - complete input. @returns SHA-256 identity. */
export function graphHash(bytes: string | Buffer): string {return createHash('sha256').update(bytes).digest('hex')}
/** @param inputHash - exact safe replay input digest. @returns External continuation identity including the kernel serialization version. */
export function graphProjectionId(inputHash:string):string {return graphHash(JSON.stringify(['task-graph','5',inputHash]))}
function packagedBinary():()=>Binary {
 let verifier:BinaryVerifier|undefined
 return ()=>{
  if(process.platform!=='win32'||process.arch!=='x64')throw new GraphError('unsupported_platform')
  verifier??=new BinaryVerifier(dirname(createRequire(import.meta.url).resolve('@negentropy/dsh-browser-flow/package.json')))
  return verifier.resolve()
 }
}
interface Pending {request: GraphRequest; resolve: (value: unknown)=>void; reject: (error: GraphError)=>void; timer: ReturnType<typeof setTimeout>}
class Worker {
  readonly generation=randomUUID();readonly handle: ProcessHandle;readonly scope: GraphInput['scope']
  closing=false;stopped=false;private pending: Pending | undefined;private counter=0
  cleanup: {state:'pending'|'failed';code?:string} | undefined
  private readonly drainError=()=>{}
  private idle: ReturnType<typeof setTimeout> | undefined;private stopping: Promise<void> | undefined
  private readonly decoder: Frames;private readonly onData: (chunk: Buffer)=>void
  private readonly onEnd: ()=>void;private readonly onError: ()=>void
  cached: {hash:string;budget:number;value: JsonRecord} | undefined
  detailCache:{hash:string;ref:string;value:unknown}|undefined
  private ready=false;private prepared:string|undefined
  private queue:Promise<void>=Promise.resolve();private queued=0
  /** @param runtime - actual Host service. @param config - resolved limits. @param binary - verified package artifact. @param input - initial run. @param now - Host monotonic clock. */
  constructor(runtime: SubprocessPort,private readonly config: GraphConfig,binary: Binary,input: GraphInput,private readonly now:()=>number) {
    this.scope={...input.scope}
    this.handle=runtime.spawn({argv:[binary.path,'--max-frame',String(config.graphMaxFrameBytes),'--max-detail',String(config.graphMaxDetailBytes)],cwd:binary.cwd,stdio:{stdin:'pipe',stdout:'pipe',stderr:{maxBytes:config.graphStderrBytes}},graceMs:config.graphTerminateGraceMs})
    this.decoder=new Frames(config.graphMaxFrameBytes,value=>this.receive(value))
    this.onData=chunk=>{try{this.decoder.push(chunk)}catch{this.fail('invalid_response')}}
    this.onEnd=()=>this.fail(this.decoder.incomplete?'truncated_frame':'worker_exit')
    this.onError=()=>this.fail('worker_io')
    this.handle.stdout?.on('data',this.onData);this.handle.stdout?.on('end',this.onEnd);this.handle.stdout?.on('error',this.onError);this.handle.stdin?.on('error',this.onError)
    void this.handle.done.then(()=>this.fail('worker_exit'),()=>this.fail('worker_exit'))
    this.armIdle()
  }
  private armIdle():void {
    clearTimeout(this.idle)
    if(this.closing)return
    this.idle=setTimeout(()=>{void this.stop().catch(()=>{})},this.config.graphIdleMs)
    this.idle.unref()
  }
  private fail(code: string): void {this.pending?.reject(new GraphError(code));void this.stop().catch(()=>{})}
  private receive(value: unknown): void {
    const pending=this.pending
    if(!pending||!record(value)||Object.keys(value).some(key=>!['protocolVersion','id','generation','scope','version','tailHash','inputHash','ok','code','value'].includes(key)))throw new GraphError('invalid_response')
    const q=pending.request
    if(value.protocolVersion!==2||value.id!==q.id||value.generation!==q.generation||!validRunScope(value.scope)||!sameRunScope(value.scope,q.scope)||value.version!==q.version||value.tailHash!==q.tailHash||value.inputHash!==q.inputHash||typeof value.ok!=='boolean')throw new GraphError('binding_mismatch')
    this.pending=undefined;clearTimeout(pending.timer)
    if(!value.ok){
      const code=typeof value.code==='string'&&['stale_reference','stale_projection','detail_capacity','invalid_offset','invalid_budget','projection_failed','frame_limit','protocol_mismatch','invalid_input','binding_mismatch'].includes(value.code)?value.code:'kernel_rejected'
      pending.reject(new GraphError(code));return
    }
    pending.resolve(value.value)
  }
  /** @param op - fixed RPC. @param input - safe snapshot. @param hash - its identity. @param budget - view size. @param deadline - Host monotonic deadline. @param ref - scoped projection detail. @returns Validated envelope payload. */
  async rpc(op: GraphRequest['op'],input: GraphInput,hash:string,budget:number,deadline:number,ref?:string,offsetBytes?:number): Promise<unknown> {
    if(this.closing||this.pending)throw new GraphError('graph_busy')
    const remaining=Math.floor(deadline-this.now());if(remaining<=0)throw new GraphError('graph_timeout')
    clearTimeout(this.idle)
    const q: GraphRequest={protocolVersion:2,id:String(++this.counter),generation:this.generation,scope:this.scope,version:input.version,tailHash:input.tailHash,inputHash:hash,op,budgetMs:remaining,budget,...(op==='project'?{input}:{}),...(ref?{ref}:{}),...(offsetBytes===undefined?{}:{offsetBytes})}
    const encoded=frame(q,this.config.graphMaxFrameBytes)
    try{return await new Promise<unknown>((resolve,reject)=>{
      const timeout=Math.floor(deadline-this.now());if(timeout<=0){reject(new GraphError('graph_timeout'));return}
      const timer=setTimeout(()=>this.fail('graph_timeout'),timeout)
      this.pending={request:q,resolve,reject,timer}
      if(!this.handle.stdin||!this.handle.stdout){this.fail('worker_io');return}
      this.handle.stdin.write(encoded,error=>{if(error)this.fail('worker_io')})
    })}finally{this.armIdle()}
  }
  /** @param job - serial RPC operation. @param deadline - original request deadline. @param current - live binding. @returns One bounded queued operation; expired work never dispatches. */
  run<T>(job:()=>Promise<T>,deadline:number,current:()=>boolean):Promise<T>{
    if(this.closing)return Promise.reject(new GraphError('cleanup_pending'))
    if(this.queued>=this.config.queueLimit)return Promise.reject(new GraphError('graph_busy'))
    this.queued++
    const result=this.queue.then(async()=>{
      this.queued--
      if(this.closing)throw new GraphError('cleanup_pending')
      if(this.now()>=deadline)throw new GraphError('graph_timeout')
      if(!current())throw new GraphError('stale_projection')
      return job()
    })
    this.queue=result.then(()=>{},()=>{});return result
  }
  /** @param input - complete safe input. @param hash - projection identity. @param budget - optional requested view budget. @param deadline - original deadline. @param current - current binding. @returns Validated view, or no view when already prepared for a detail read. */
  async load(input:GraphInput,hash:string,budget:number|undefined,deadline:number,current:()=>boolean):Promise<JsonRecord|undefined>{
    if(!this.ready){const hello=await this.rpc('hello',input,hash,0,deadline);if(!record(hello)||hello.kernelVersion!=='5'||hello.rulesVersion!=='structural-v1')throw new GraphError('protocol_mismatch');this.ready=true}
    if(this.cached?.hash===hash&&this.cached.budget===budget)return this.cached.value
    if(this.prepared===hash&&budget===undefined)return
    const value=validateView(await this.rpc('project',input,hash,budget??0,deadline),input,hash)
    if(this.closing||!current())throw new GraphError('stale_projection')
    if(this.now()>=deadline)throw new GraphError('graph_timeout')
    if(this.prepared!==hash)this.detailCache=undefined
    this.prepared=hash
    if(budget!==undefined)this.cached={hash,budget,value}
    return value
  }
  /** @returns Completion only after the managed range is empty. */
  stop(): Promise<void> {
    if(this.stopped)return Promise.resolve()
    if(this.stopping)return this.stopping
    this.closing=true;this.cached=undefined;this.detailCache=undefined;clearTimeout(this.idle);this.cleanup={state:'pending'}
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new GraphError('worker_stopped'));this.pending=undefined}
    this.handle.stdout?.off('data',this.onData);this.handle.stdout?.off('end',this.onEnd)
    this.handle.stdout?.off('error',this.onError);this.handle.stdin?.off('error',this.onError)
    this.handle.stdout?.off('error',this.drainError);this.handle.stdin?.off('error',this.drainError)
    this.handle.stdout?.on('error',this.drainError);this.handle.stdin?.on('error',this.drainError);this.handle.stdout?.resume()
    this.stopping=Promise.resolve().then(async()=>{
      try{
        this.handle.terminate()
        if(!await this.handle.waitForExit())throw new GraphError('cleanup_failed')
        await this.handle.done.catch(()=>{})
        this.stopped=true;this.cleanup=undefined
        this.handle.stdout?.off('error',this.drainError);this.handle.stdin?.off('error',this.drainError)
      }catch{this.cleanup={state:'failed',code:'cleanup_failed'};throw new GraphError('cleanup_failed')}
      finally{this.stopping=undefined}
    })
    return this.stopping
  }
}
/** Task-scoped registry. Missing services affect graph reads, never permission withdrawal. */
export class GraphWorkers {
  private runtime: SubprocessPort | undefined;private workers=new Map<string,Worker>();private closed=false
  private acquisitions=new Map<string,{tail:Promise<void>;count:number}>()
  /** @param config - resolved settings. @param binary - package resolver; tests may supply an owned helper. @param now - monotonic clock, injectable for deadline tests. */
  constructor(private readonly config: GraphConfig,private readonly binary: ()=>Binary=packagedBinary(),private readonly now:()=>number=()=>performance.now()) {}
  /** @param runtime - newly mounted service. @returns Disposal joined before the provider is released. */
  attach(runtime: SubprocessPort): ()=>Promise<void> {this.runtime=runtime;return async()=>{if(this.runtime===runtime)this.runtime=undefined;await this.disposeWorkers()}}
  private async stopAll(): Promise<void> {
    const results=await Promise.allSettled([...this.workers.values()].map(worker=>worker.stop()))
    for(const [key,worker]of this.workers)if(worker.stopped)this.workers.delete(key)
    if(results.some(row=>row.status==='rejected'))throw new GraphError('cleanup_failed')
  }
  private async disposeWorkers():Promise<void>{
    const result=await Promise.allSettled([this.stopAll(),...[...this.acquisitions.values()].map(entry=>entry.tail)])
    if(result.some(row=>row.status==='rejected'))throw new GraphError('cleanup_failed')
  }
  private worker(input: GraphInput,deadline:number,current:()=>boolean,signal?:AbortSignal): Promise<{worker:Worker;fresh:boolean}> {
    const key=input.scope.taskId,entry=this.acquisitions.get(key)??{tail:Promise.resolve(),count:0}
    if(entry.count>=this.config.queueLimit)return Promise.reject(new GraphError('graph_busy'))
    entry.count++
    const result=this.bounded(entry.tail.then(()=>this.acquire(input,deadline,current,signal)),deadline,signal),settled=result.then(()=>{},()=>{})
    entry.tail=settled;this.acquisitions.set(key,entry)
    void settled.then(()=>{entry.count--;if(entry.count===0&&this.acquisitions.get(key)===entry)this.acquisitions.delete(key)})
    return result
  }
  private async acquire(input: GraphInput,deadline:number,current:()=>boolean,signal?:AbortSignal): Promise<{worker:Worker;fresh:boolean}> {
    if(this.now()>=deadline)throw new GraphError('graph_timeout')
    if(!current()||signal?.aborted)throw new GraphError('stale_projection')
    if(this.closed)throw new GraphError('graph_closed');if(!this.runtime)throw new GraphError('subprocess_unavailable')
    const key=input.scope.taskId;let worker=this.workers.get(key)
    if(worker?.closing&&!worker.stopped)await this.bounded(worker.stop(),deadline,signal)
    if(worker&&(worker.stopped||!sameRunScope(worker.scope,input.scope))){await this.bounded(worker.stop(),deadline,signal);if(this.workers.get(key)===worker)this.workers.delete(key);worker=undefined}
    if(this.now()>=deadline)throw new GraphError('graph_timeout')
    if(!current()||signal?.aborted)throw new GraphError('stale_projection')
    if(this.closed||!this.runtime)throw new GraphError('graph_closed')
    if(worker)return {worker,fresh:false}
    for(const [id,entry]of this.workers)if(entry.stopped)this.workers.delete(id)
    if(this.workers.size>=this.config.graphMaxWorkers)throw new GraphError('graph_capacity')
    if(this.closed||!this.runtime)throw new GraphError('graph_closed')
    if(this.now()>=deadline)throw new GraphError('graph_timeout')
    // No await between the capacity check and claiming this task's worker.
    const binary=this.binary();if(this.now()>=deadline)throw new GraphError('graph_timeout')
    const entry=new Worker(this.runtime,this.config,binary,input,this.now);this.workers.set(key,entry);return {worker:entry,fresh:true}
  }
  /** @param input - complete sanitized snapshot. @param budget - display limit. @param current - recheck after every asynchronous operation. @param signal - caller cancellation. @returns Four derived modules; no Host facts. */
  async project(input:GraphInput,budget:number,current:()=>boolean,signal?:AbortSignal): Promise<JsonRecord> {
    if(!Number.isSafeInteger(budget)||budget<=0)throw new GraphError('invalid_budget')
    const deadline=this.now()+this.config.graphRequestTimeoutMs
    if(this.closed)throw new GraphError('graph_closed');if(!this.runtime)throw new GraphError('subprocess_unavailable')
    const hash=graphHash(JSON.stringify(input));const {worker,fresh}=await this.bounded(this.worker(input,deadline,current,signal),deadline,signal)
    if(!current()||signal?.aborted){if(fresh)void worker.stop().catch(()=>{});throw new GraphError('stale_projection')}
    const guard=()=>current()&&!signal?.aborted
    const value=await this.bounded(worker.run(async()=>{
      try{const value=await worker.load(input,hash,budget,deadline,guard);if(!value)throw new GraphError('invalid_response');return value}
      catch(error){void worker.stop().catch(()=>{});throw error}
    },deadline,guard),deadline,signal)
    if(worker.closing||!guard())throw new GraphError('stale_projection')
    return value
  }
  /** @param input - current snapshot. @param ref - task-owned projection reference. @param current - current binding check. @param signal - caller cancellation. @returns Sanitized immutable detail. */
  async detail(input:GraphInput,ref:string,current:()=>boolean,signal?:AbortSignal): Promise<unknown> {
    const deadline=this.now()+this.config.graphRequestTimeoutMs,hash=graphHash(JSON.stringify(input)),guard=()=>current()&&!signal?.aborted
    const {worker}=await this.bounded(this.worker(input,deadline,guard,signal),deadline,signal)
    return this.bounded(worker.run(async()=>{
      try{
        await worker.load(input,hash,undefined,deadline,guard)
        if(worker.detailCache?.hash===hash&&worker.detailCache.ref===ref)return worker.detailCache.value
        let offset=0,total:number|undefined,bytes:Buffer|undefined
        for(;;){
          const part=await worker.rpc('detail',input,hash,0,deadline,ref,offset)
          if(worker.closing||!guard())throw new GraphError('stale_projection')
          if(this.now()>=deadline)throw new GraphError('graph_timeout')
          if(!record(part)||Object.keys(part).sort().join(',')!=='chunkBase64,complete,offsetBytes,ref,totalBytes'||part.ref!==ref||part.offsetBytes!==offset||typeof part.totalBytes!=='number'||!Number.isSafeInteger(part.totalBytes)||part.totalBytes<1||typeof part.complete!=='boolean'||typeof part.chunkBase64!=='string')throw new GraphError('invalid_detail_chunk')
          if(part.totalBytes>this.config.graphMaxDetailBytes)throw new GraphError('detail_capacity')
          if(total!==undefined&&part.totalBytes!==total)throw new GraphError('invalid_detail_chunk')
          total=part.totalBytes
          if(part.chunkBase64.length>Math.ceil(this.config.graphMaxFrameBytes/3)*4)throw new GraphError('invalid_detail_chunk')
          const chunk=Buffer.from(part.chunkBase64,'base64')
          if(chunk.toString('base64')!==part.chunkBase64||chunk.length===0||offset+chunk.length>total||part.complete!==(offset+chunk.length===total))throw new GraphError('invalid_detail_chunk')
          bytes??=Buffer.alloc(total);chunk.copy(bytes,offset);offset+=chunk.length
          if(!part.complete)continue
          let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new GraphError('invalid_detail_json')}
          const value=validateDetail(parsed,ref,input,hash)
          if(worker.closing||!guard())throw new GraphError('stale_projection')
          if(this.now()>=deadline)throw new GraphError('graph_timeout')
          worker.detailCache={hash,ref,value};return value
        }
      }catch(error){if(!(error instanceof GraphError)||!['stale_reference','detail_capacity','invalid_offset'].includes(error.code))void worker.stop().catch(()=>{});throw error}
    },deadline,guard),deadline,signal)
  }
  private async bounded<T>(promise:Promise<T>,deadline:number,signal?:AbortSignal):Promise<T> {
    const remaining=Math.floor(deadline-this.now())
    if(remaining<=0||signal?.aborted){void promise.catch(()=>{});throw new GraphError(remaining<=0?'graph_timeout':'stale_projection')}
    // Promise.race retains rejection handlers even after the caller times out.
    let abort:()=>void=()=>{},timer:ReturnType<typeof setTimeout>|undefined
    try{return await Promise.race([promise,new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>reject(new GraphError('graph_timeout')),remaining)
      abort=()=>reject(new GraphError('graph_cancelled'));signal?.addEventListener('abort',abort,{once:true})
    })])}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
  }
  /** @param taskId - owned task being ended or revised. @returns Quiescent worker disposal. */
  async retire(taskId:string):Promise<void>{const worker=this.workers.get(taskId);if(worker){await worker.stop();if(this.workers.get(taskId)===worker)this.workers.delete(taskId)}}
  /** @param taskId - owned task. @returns Pending or failed cleanup, independent of durable task status. */
  cleanup(taskId:string):Worker['cleanup']{return this.workers.get(taskId)?.cleanup}
  /** @returns All workers have stopped before plugin disposal completes. */
  async close():Promise<void>{this.closed=true;this.runtime=undefined;await this.disposeWorkers()}
}
