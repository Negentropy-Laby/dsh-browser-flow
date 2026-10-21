/** Internal graph protocol v2. Page control remains Browser Flow v3. */
import type { Readable, Writable } from 'node:stream'
import type { RunScope } from '../task-scope.ts'

/** Consumed subset of the pinned Host subprocess service. No provider is created. */
export interface SubprocessPort {
  spawn(spec: { argv: readonly string[]; cwd: string; stdio: { stdin: 'pipe'; stdout: 'pipe'; stderr: { maxBytes: number } }; graceMs: number; signal?: AbortSignal }): ProcessHandle
}
/** A managed process range, including its quiescent exit signal. */
export interface ProcessHandle {
  readonly stdin: Writable | undefined
  readonly stdout: Readable | undefined
  readonly done: Promise<unknown>
  terminate(): void
  waitForExit(signal?: AbortSignal): Promise<boolean>
}
/** Deployment choices resolved with the plugin configuration. */
export interface GraphConfig {
  graphMaxWorkers: number; graphIdleMs: number; graphRequestTimeoutMs: number
  graphMaxFrameBytes: number; graphMaxDetailBytes:number; graphStderrBytes: number; graphTerminateGraceMs: number
  graphColdRounds: number; graphMinGroup: number; queueLimit: number
}
/** Sanitized closed event; original asset data cannot enter a worker. */
export interface GraphEvent {
  seq: number; hash: string; type: string; run: RunScope
  id?: string; kind?: string; source?: string; action?: string; outcome?: string
  from?: string; to?: string; relation?: string; goal?: string; documentToken?: string
}
/** Code-owned display criterion. It never becomes authority by crossing IPC. */
export interface Criterion {
  id: string; label: string; status: string; source: string; validatorId?: string; version?: number
}
/** A complete replay snapshot, scoped before projection. */
export interface GraphInput {
  scope: RunScope; version: number; tailHash: string; goal: string; constraints: string[]
  criteria: Criterion[]; events: GraphEvent[]; protected: string[]; proofRef: string; proofSeq: number
  coldRounds: number; minGroup: number; liveDocumentToken: string
}
/** Closed request envelope. All replies must echo its immutable binding. */
export interface GraphRequest {
  protocolVersion: 2; id: string; generation: string; scope: RunScope; version: number
  tailHash: string; inputHash: string; op: 'hello' | 'project' | 'detail'
  budgetMs: number; budget: number; input?: GraphInput; ref?: string; offsetBytes?:number
}
/** A sanitized record decoded from a worker. */
export type JsonRecord = Record<string, unknown>
/** @param value - wire value. @returns Whether it is a non-array JSON record. */
export function record(value: unknown): value is JsonRecord { return value !== null && typeof value === 'object' && !Array.isArray(value) }
/** Expected component failures are safe to expose without raw stderr or paths. */
export class GraphError extends Error {
  /** @param code - bounded code, never original process diagnostics. */
  constructor(readonly code: string) { super(code) }
}
/** @param value - JSON message. @param limit - maximum payload bytes. @returns A length-prefixed UTF-8 frame. */
export function frame(value: unknown, limit: number): Buffer {
  const body=Buffer.from(JSON.stringify(value));if(body.length===0||body.length>limit)throw new GraphError('frame_limit')
  const prefix=Buffer.alloc(4);prefix.writeUInt32BE(body.length);return Buffer.concat([prefix,body])
}
/** Bounded incremental decoder; allocation is rejected before reading the body. */
export class Frames {
  private prefix=Buffer.alloc(4);private prefixBytes=0;private body: Buffer | undefined;private bodyBytes=0
  /** @param limit - payload byte limit. @param receive - one complete JSON value. */
  constructor(private readonly limit: number, private readonly receive: (value: unknown)=>void) {}
  /** @param chunk - raw stdout bytes. @returns Nothing; malformed data throws. */
  push(chunk: Buffer): void {
    let offset=0
    while(offset<chunk.length) {
      if(!this.body){const take=Math.min(4-this.prefixBytes,chunk.length-offset);chunk.copy(this.prefix,this.prefixBytes,offset,offset+take);this.prefixBytes+=take;offset+=take
        if(this.prefixBytes<4)continue
        const size=this.prefix.readUInt32BE();if(size===0||size>this.limit)throw new GraphError('frame_limit')
        this.body=Buffer.alloc(size);this.bodyBytes=0
      }
      const take=Math.min(this.body.length-this.bodyBytes,chunk.length-offset);chunk.copy(this.body,this.bodyBytes,offset,offset+take);this.bodyBytes+=take;offset+=take
      if(this.bodyBytes===this.body.length){const body=this.body;this.body=undefined;this.prefixBytes=0;this.bodyBytes=0
        let parsed: unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body))}catch{throw new GraphError('invalid_json')};this.receive(parsed)
      }
    }
  }
  /** @returns Whether EOF would truncate a frame. */
  get incomplete(): boolean {return this.prefixBytes!==0||this.body!==undefined}
}
