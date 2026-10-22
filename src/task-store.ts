export type TaskScope = import("./task-scope.ts").TaskScope;
export type RunScope = import("./task-scope.ts").RunScope;
export type Manifest = {
    schemaVersion?: number;
    scope: TaskScope;
    runId: import("./task-scope.ts").RunId;
    workflowRef: string;
    goal: string;
    constraints: string[];
    criteria: string[];
    origins: string[];
    adapter: string;
    adapterVersion: number;
    definitionId?: string;
    definitionDigest?: string;
    definitionVersion?: string;
};
export type TaskEvent = {
    schemaVersion?: number;
    seq: number;
    prev: string;
    type: string;
    data: Record<string, unknown>;
    hash: string;
};
export type TaskData = {
    manifest: Manifest;
    snapshot?: import("./task-definitions.ts").DefinitionSnapshot;
    events: TaskEvent[];
    dir: string;
    blocked: boolean;
    unhealthy: boolean;
    state: string;
    pendingWrite?: string;
    readOnly?: boolean;
    storageIssue?: string;
    checkedProofs?: Map<string, import("./task-criteria.ts").CheckedProof>;
    evidenceIssues?: string[];
    liveDocumentToken?: string;
    waiting?: import("./task-wait.ts").UserWait;
    waitInput?: {
        kind: string;
        inputRef: string;
    };
};
export type TaskAccess = {
    readonly scope: TaskScope;
    readonly run: RunScope;
};

/** Profile-owned task store. Durable ownership never grants page control or replays commands. */
import { graphInput, taskView } from './task-projections.ts'
import { taskFacts, taskReferences, taskCoverage, currentRunReferences } from './task-facts.ts'
import { pageIdentity, resourceDescriptor } from './task-resources.ts'
import { GraphError } from './graph/protocol.ts'
import { graphHash, graphProjectionId } from './graph/worker.ts'
import { resolveConfig } from './config.ts'
import { validUserWait } from './task-wait.ts'
import { trustedCriterion, validArtifact } from './task-criteria.ts'
import { TASK_FORMAT_VERSION, validTaskManifest, validTaskEvent } from './task-journal.ts'
import { createHash, randomUUID } from 'node:crypto'
import { open, readFile, mkdir, readdir, lstat, rm } from 'node:fs/promises'
import type { Stats, BigIntStats } from 'node:fs'
import { hostname } from 'node:os'
import { join, dirname, resolve, relative, isAbsolute } from 'node:path'
import { validTaskScope, validRunScope, sameTaskScope, sameRunScope } from './task-scope.ts'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { privateDirectory } from './import-files.ts'
import { loadDefinition, noLinks, validOrigins } from './task-definitions.ts'

/** Expected task failures are sanitized at the tool/HTTP boundary. */
export class TaskError extends Error {
code: string;

  /** @param {string} code - machine identity. @param {string} message - public next step. */
  constructor(code: string, message: string) { super(message); this.code = code }
}
/** @param {string | Uint8Array} value - complete content. @returns {string} digest. */
const hash = (value: string | Uint8Array) : string => createHash('sha256').update(value).digest('hex')
/** @param {unknown} value - JSON value. @returns {value is Record<string, unknown>} record. */
const record = (value: unknown) : value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
/** @param {unknown} value - bounded user text. @param {number} max - limit. @returns {value is string} safe nonempty text. */
const text = (value: unknown,max: number) : value is string => typeof value === 'string' && value.length > 0 && value.length <= max
/** @param {unknown} value - list of conditions. @returns {value is string[]} bounded list. */
const conditions = (value: unknown) : value is string[] => Array.isArray(value) && value.length <= 32 && value.every(item => text(item,1000))

function sameArtifactState(left:BigIntStats,right:BigIntStats):boolean {
  return right.isFile()&&!right.isSymbolicLink()&&left.dev===right.dev&&left.ino===right.ino&&left.size===right.size&&left.mtimeNs===right.mtimeNs&&left.ctimeNs===right.ctimeNs&&left.birthtimeNs===right.birthtimeNs
}

/** The service owns one writer lease, access capabilities and a serialized append queue. */
export class TaskStore {
graph: import("./graph/worker.ts").GraphWorkers | undefined;
graphConfig: import("./graph/protocol.ts").GraphConfig;
controlDocument: ((access: TaskAccess) => string | undefined) | undefined;
root: string | undefined;
profileId: import("./task-scope.ts").ProfileId | undefined;
runtime: string | undefined;
waitMs: number;
tasks: Map<string, TaskData>;
bindings: Map<string, string>;
private creationFailures = new Map<string, TaskError>();
private evidenceReads = new WeakMap<TaskData, symbol>();
private detailLengths = new WeakMap<TaskData,{projectionId:string;ref:string;totalChars:number}>();
handles: WeakMap<TaskAccess, TaskData>;
ready: Promise<void> | undefined;
writer: Promise<unknown> | undefined;
releaseWriter: (() => void) | undefined;
abort: AbortController;
closed: boolean;
writable: boolean;
tail: Promise<void>;

  /** @param {string | undefined} root - localTasksDir. @param {import('./task-definitions.ts').Profile | undefined} profile - actual dsh profile. @param {number} waitMs - bounded writer acquisition. @param {import('./graph/worker.ts').GraphWorkers|undefined} [graph] - optional derived view service. @param {import('./graph/protocol.ts').GraphConfig} [graphConfig] - resolved limits. */
  constructor(root: string | undefined, profile: import('./task-definitions.ts').Profile | undefined, waitMs: number, graph: import('./graph/worker.ts').GraphWorkers | undefined=undefined, graphConfig: import('./graph/protocol.ts').GraphConfig=resolveConfig(undefined)) {
    this.graph=graph;this.graphConfig=graphConfig
     this.controlDocument=undefined
    this.root = root
    this.profileId = profile ? ('profile-'+hash(JSON.stringify([profile.name,resolve(profile.home)])).slice(0,32) as import('./task-scope.ts').ProfileId) : undefined
    this.runtime = root && this.profileId ? join(root,'.runtime',this.profileId) : undefined
    this.waitMs = waitMs
     this.tasks = new Map()
     this.bindings = new Map()
     this.handles = new WeakMap()
     this.ready = undefined
     this.writer = undefined
     this.releaseWriter = undefined
    this.abort = new AbortController()
    this.closed = false
    this.writable = false
    this.tail = Promise.resolve()
  }
  /** @param {string} path - owned descendant. @returns {Promise<void>} private directory after all existing ancestors have passed link checks. */
  async directory(path: string) : Promise<void> {
    if(!this.root)throw new TaskError('task_unavailable','task root unavailable')
    const rel=relative(resolve(this.root),resolve(path))
    if(rel.startsWith('..')||isAbsolute(rel))throw new TaskError('task_unavailable','task path escaped its root')
    let existing=path
    for(;;){
      try{await lstat(existing);break}catch(error){if(!record(error)||error.code!=='ENOENT')throw error;const parent=dirname(existing);if(parent===existing)throw error;existing=parent}
    }
    noLinks(existing,existing)
    await privateDirectory(path)
    noLinks(this.root,path)
  }
  /** @returns {Promise<void>} lazy initialization; failure prevents writes without impairing revocation. */
  initialize() : Promise<void> {
    if (this.closed) return Promise.reject(new TaskError('task_unavailable','task storage is closed; hand off safely'))
    if (this.ready) return this.ready
    this.ready = this.initializeOwned()
    return this.ready
  }
  /** @returns {Promise<void>} writer ready after existing ownership and journals have been read. */
  async initializeOwned() : Promise<void> {
    if (!this.root || !this.runtime || !this.profileId) throw new TaskError('task_unavailable','launch with a dsh profile and configure localTasksDir before creating a task')
    const runtime = this.runtime
    try {
      await this.directory(runtime)
      noLinks(this.root,runtime)
      const namespace=join(runtime,'writer-host.json')
      try { await this.writeNew(namespace,{platform:process.platform,hostname:hostname()}) } catch(error) {
        if (!record(error) || error.code !== 'EEXIST') throw error
      }
      const host=JSON.parse(await readFile(namespace,'utf8'))
      if (host.platform !== process.platform || host.hostname !== hostname()) throw new Error('task-writer-host-mismatch')
      let readyResolve=()=>{}
       let readyReject: (reason: unknown) => void=(): void =>{}
      const ready=new Promise((resolve,reject)=>{readyResolve=()=>resolve(undefined);readyReject=reject})
      const lifetime=new Promise(resolve=>{this.releaseWriter=()=>resolve(undefined)})
      this.writer=withFileLock(join(runtime,'writer'),async()=>{
        if(this.closed)throw new Error('task-store-closed')
        await this.recover()
        this.writable=true
        readyResolve()
        await lifetime
      },{waitMs:this.waitMs,signal:this.abort.signal})
      void this.writer.catch(readyReject)
      await ready
    } catch(error) {
      try{await this.recover();if(this.bindings.size>0)return}catch(readError){void readError}
      throw new TaskError('task_unavailable','task storage could not establish exclusive private ownership; keep reads/revocation safe and correct the storage configuration')
    }
  }
  /** @param {string} path - owned new file. @param {unknown} value - complete JSON. @returns {Promise<void>} synced new content. */
  async writeNew(path: string,value: unknown) : Promise<void> {
    await mkdir(dirname(path),{recursive:true,mode:0o700})
    if(this.root) noLinks(this.root,dirname(path))
    const handle=await open(path,'wx',0o600)
    try { await handle.writeFile(JSON.stringify(value)+'\n'); await handle.sync() } finally { await handle.close() }
  }
  /** @param path - exact Session registry path. @returns Absence only when the private path can be inspected conclusively. */
  async registrationState(path: string): Promise<'absent'|'present'|'unknown'> {
    try {
      if(!this.root)return 'unknown'
      noLinks(this.root,dirname(path))
      await lstat(path)
      return 'present'
    }catch(error){return record(error)&&error.code==='ENOENT'?'absent':'unknown'}
  }
  /** @param dir - this creation's exclusively allocated leaf. @param identity - identity captured after allocation. @returns Removal only if the original directory is still present without links. */
  async removeNewDirectory(dir: string,identity: Stats): Promise<void> {
    if(!this.root)throw new Error('task-root-unavailable')
    noLinks(this.root,dir)
    const current=await lstat(dir)
    if(!current.isDirectory()||current.isSymbolicLink()||current.dev!==identity.dev||current.ino!==identity.ino||current.birthtimeMs!==identity.birthtimeMs)throw new Error('task-directory-replaced')
    await rm(dir,{recursive:true})
  }
  /** @template T @param {() => Promise<T>} operation - serialized mutation. @returns {Promise<T>} operation result. */
  serial<T>(operation: () => Promise<T>) : Promise<T> {
    const result=this.tail.then(operation)
    this.tail=result.then(()=>{},()=>{})
    return result
  }
  /** @param {string} sessionId - caller's verified Session. @param {unknown} raw - user task declaration. @returns {Promise<TaskAccess>} newly created task, permanently owned by this Session. */
  async create(sessionId: string,raw: unknown) : Promise<TaskAccess> {
    await this.initialize()
    return this.serial(async()=>{
      if (this.closed || !this.writable || !this.root || !this.runtime || !this.profileId) throw new TaskError('task_unavailable','task storage is closed')
      const creationFailure=this.creationFailures.get(sessionId)
      if(creationFailure)throw creationFailure
      if (this.bindings.has(sessionId)) throw new TaskError('task_bound','this Session already owns a task; use a new Session for another batch')
      if (!record(raw) || Object.keys(raw).some(key=>!['definitionId','workflowRef','goal','constraints','criteria','origins'].includes(key)) || !text(raw.goal,2000)
        || !conditions(raw.constraints ?? []) || !conditions(raw.criteria ?? [])) throw new TaskError('invalid_request','supply a bounded goal, constraints and criteria')
      let snapshot
      if (raw.definitionId !== undefined) {
        if (typeof raw.definitionId !== 'string') throw new TaskError('definition_unavailable','local definition unavailable')
        try { snapshot=loadDefinition(this.root,raw.definitionId) } catch { throw new TaskError('definition_unavailable','local definition unavailable; correct it before creating this task') }
      }
      const workflow=snapshot?.definition.workflows.find(item=>item.id === raw.workflowRef)
      if (snapshot && !workflow) throw new TaskError('definition_unavailable','select an available workflow in this definition')
      const origins=snapshot?.definition.origins ?? raw.origins
      if (!validOrigins(origins) || (snapshot && raw.origins !== undefined)) throw new TaskError('invalid_request','supply exact allowed origins for a generic task')
      const taskId=('task-'+randomUUID() as import('./task-scope.ts').TaskId)
      const scope={profileId:this.profileId,taskId,ownerSessionId:sessionId,scopeRevision:1}
       const manifest: Manifest={schemaVersion:TASK_FORMAT_VERSION,scope,runId:('run-'+randomUUID() as import('./task-scope.ts').RunId),workflowRef:workflow?.id ?? 'generic',goal:raw.goal,constraints:((raw.constraints ?? []) as string[]),criteria:((raw.criteria ?? []) as string[]),origins:[...origins],adapter:snapshot?.definition.adapter ?? 'generic',adapterVersion:1,
        ...(snapshot?{definitionId:snapshot.definition.id,definitionDigest:snapshot.digest,definitionVersion:snapshot.definition.version}:{})}
      const dir=join(this.runtime,'tasks',taskId)
      const registry=join(this.runtime,'registry',hash(sessionId)+'.json')
      let owned=false,identity:Stats|undefined
       const data: TaskData={manifest,snapshot,dir,events:[],blocked:false,unhealthy:false,state:'active'}
      try {
      await this.directory(dirname(dir))
      await mkdir(dir,{mode:0o700})
      owned=true;identity=await lstat(dir)
      await this.directory(dir)
      if(snapshot)for(const [name,body] of Object.entries(snapshot.files)){
        const file=join(dir,'definition-snapshot',name)
        await mkdir(dirname(file),{recursive:true,mode:0o700})
        const handle=await open(file,'wx',0o600)
        try{await handle.writeFile(body);await handle.sync()}finally{await handle.close()}
      }
      await this.writeNew(join(dir,'manifest.json'),manifest)
      await this.appendOwned(data,'created',{manifest})
      await this.writeNew(registry,{schemaVersion:TASK_FORMAT_VERSION,sessionId,taskId,profileId:this.profileId})
      this.tasks.set(taskId,data);this.bindings.set(sessionId,taskId)
      return this.access(data)
      }catch(error){
        const registration=await this.registrationState(registry)
        if(registration!=='absent'){
          const failure=new TaskError('task_storage_failed',registration==='present'?'task creation failed after a Session registration became visible; preserve history and reopen this Session after correcting storage':'task creation registration could not be confirmed; preserve history and correct storage before reopening this Session')
          this.creationFailures.set(sessionId,failure)
          throw failure
        }
        if(owned){
          try{if(!identity)throw new Error('task-directory-identity-unavailable');await this.removeNewDirectory(dir,identity)}
          catch(cleanupError){
            const failure=new TaskError('task_storage_failed','unregistered task creation could not be cleaned safely; preserve its directory and correct storage before reopening this Session')
            this.creationFailures.set(sessionId,failure)
            throw failure
          }
        }
        throw new TaskError('task_storage_failed','task creation was not registered; its new directory was removed if allocated, correct storage before retrying')
      }
    })
  }
  /** @param {TaskData} data - owned data. @returns {TaskAccess} unforgeable in-process capability. */
  access(data: TaskData) : TaskAccess {
    const scope=Object.freeze({...data.manifest.scope})
    const handle=Object.freeze({scope,run:Object.freeze({...scope,runId:data.manifest.runId,workflowRef:data.manifest.workflowRef})})
    this.handles.set(handle,data)
    return handle
  }
  /** @param {string} sessionId - actual caller. @param {unknown} [requested] - optional scope to compare, never an authority source. @returns {Promise<TaskAccess>} verified current ownership. */
  async forSession(sessionId: string,requested?: unknown) : Promise<TaskAccess> {
    await this.initialize()
    const creationFailure=this.creationFailures.get(sessionId)
    if(creationFailure)throw creationFailure
    const taskId=this.bindings.get(sessionId)
    const data=taskId ? this.tasks.get(taskId) : undefined
    if(!data && taskId)throw new TaskError('task_unavailable','this Session retains its original task ownership, but the history cannot be decoded; revoke and hand off')
    if (!data || (requested !== undefined && (!validTaskScope(requested) || !sameTaskScope(requested,data.manifest.scope)))) throw new TaskError('task_not_bound','no accessible task binding; create or open this Session’s own task in the panel')
    return this.access(data)
  }
  /** @param {string} sessionId - verified Session. @returns {TaskAccess | undefined} current in-memory binding; use forSession to recover after restart. */
  current(sessionId: string) : TaskAccess | undefined {
    const id=this.bindings.get(sessionId)
    const data=id ? this.tasks.get(id) : undefined
    return data ? this.access(data) : undefined
  }
  /** @param {TaskAccess} access - store-issued capability. @param {boolean} [write] - operation can change a page or file authority. @returns {TaskData} private data available only after full verification. */
  openTask(access: TaskAccess,write: boolean=false) : TaskData {
    const data=this.handles.get(access)
    if (!data || !sameRunScope(access.run,{...data.manifest.scope,runId:data.manifest.runId,workflowRef:data.manifest.workflowRef}) || this.closed) throw new TaskError('task_not_bound','task binding is no longer current')
    if(write && data.readOnly)throw new TaskError('task_read_only','this task uses unsupported or legacy storage; read its history, revoke and hand off in a new Session')
    if(write && !this.writable)throw new TaskError('task_unavailable','task storage is read-only; only read, revoke and hand off')
    if(write && (data.blocked || data.unhealthy)) throw new TaskError('task_write_blocked','this task has an unknown write or damaged log; only read, revoke and hand off')
    if(write && data.state !== 'active') throw new TaskError('task_write_blocked','this task is ended or awaiting user action; only read, revoke and hand off')
    return data
  }
  /** @param {TaskAccess} access - verified task. @param {string} url - actual page address. @returns {void} allowed source with supported adapter version. */
  assertPage(access: TaskAccess,url: string) : void {
    const data=this.openTask(access)
    let origin
    try {origin=new URL(url).origin}catch{throw new TaskError('task_scope_mismatch','page is outside the task’s allowed sites')}
    if(data.readOnly)throw new TaskError('task_read_only','legacy history cannot acquire new page control; use a new Session')
    if(data.manifest.adapterVersion!==1 || !data.manifest.origins.includes(origin))throw new TaskError('task_scope_mismatch','page is outside the task’s supported sites')
  }
  /** @param {TaskData} data - private task. @param {string} type - event category. @param {Record<string,unknown>} payload - bounded event facts. @returns {Promise<TaskEvent>} durable append. */
  async appendOwned(data: TaskData,type: string,payload: Record<string, unknown>) : Promise<TaskEvent> {
    if(data.readOnly)throw new TaskError('task_read_only','legacy task history is immutable; read, revoke and hand off')
    if((type==='created'&&data.events.length!==0)||!validTaskEvent(type,payload,data.manifest,data.pendingWrite,data.waiting,data.waitInput))throw new TaskError('invalid_request','unsupported task event or invalid event payload')
    if(!this.writable && data.events.length>0)throw new TaskError('task_unavailable','task storage has no writer; only read, revoke and hand off')
    if(data.unhealthy)throw new TaskError('task_storage_failed','the task journal is damaged; do not write again')
    const unsigned={schemaVersion:TASK_FORMAT_VERSION,seq:data.events.length+1,prev:data.events.at(-1)?.hash ?? '',type,data:payload}
    const event={...unsigned,hash:hash(JSON.stringify(unsigned))}
    const bytes=Buffer.from(JSON.stringify(event)+'\n')
    if(bytes.length>2_000_000)throw new TaskError('invalid_request','task record exceeds its bounded size')
    try {
      const dir=join(data.dir,'basic_law_index');await mkdir(dir,{recursive:true,mode:0o700})
      if(this.root)noLinks(this.root,dir)
      const path=join(dir,'events.jsonl')
      try {const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw new Error('task-journal-link')}catch(error){if(!record(error)||error.code!=='ENOENT')throw error}
      const handle=await open(path,'a',0o600)
      try {await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}
      data.events.push(event)
      this.reduce(data,event)
      return event
    }catch(error){data.unhealthy=true;data.blocked=true;throw new TaskError('task_storage_failed','task log could not be synchronized; writes are blocked, revoke and hand off')}
  }
  /** @param {TaskData} data - recovered or live task. @param {TaskEvent} event - validated event. @returns {void} monotonic state projection. */
  reduce(data: TaskData,event: TaskEvent) : void {
    if(event.type==='wait_requested'){data.waiting=(event.data as import('./task-wait.ts').UserWait);delete data.waitInput}
    if(event.type==='wait_input')data.waitInput={kind:String(event.data.kind),inputRef:String(event.data.inputRef)}
    if(event.type==='wait_resolved'){delete data.waiting;delete data.waitInput}
    if(event.type==='attempt')data.pendingWrite=String(event.data.attemptId)
    if(event.type==='receipt'){
      if(event.data.outcome==='unknown_outcome')data.blocked=true
      if(data.pendingWrite===event.data.attemptId)delete data.pendingWrite
    }
    if(event.type==='revise' && record(event.data.manifest))data.manifest=(event.data.manifest as Manifest)
    if(event.type==='status' && typeof event.data.state==='string')data.state=event.data.state
  }
  /** @param {TaskAccess} access - capability. @param {string} type - event. @param {Record<string,unknown>} payload - facts. @returns {Promise<TaskEvent>} appended event. */
  append(access: TaskAccess,type: string,payload: Record<string, unknown>) : Promise<TaskEvent> {return this.serial(()=>this.appendOwned(this.openTask(access),type,payload))}
  /** @param {TaskAccess} access - capability. @param {string} action - fixed action kind, never private text. @returns {Promise<string>} durable attempt id before any write-related work. */
  beginAttempt(access: TaskAccess,action: string) : Promise<string> {
    return this.serial(async()=>{
      const data=this.openTask(access,true)
      if(data.waiting&&!['prepare_file','confirm_file'].includes(action))throw new TaskError('awaiting_user','this task awaits user input; inspect view=task, read safely, revoke or hand off')
      if(data.pendingWrite)throw new TaskError('task_busy','another write is pending in this task')
      const attemptId='attempt-'+randomUUID()
      await this.appendOwned(data,'attempt',{attemptId,action,run:access.run})
      return attemptId
    })
  }
  /** @param {TaskAccess} access - original run. @param {string} attemptId - original attempt. @param {string} outcome - known result or unknown. @param {{fileGrantId?:string}} [details] - verified file acknowledgement binding. @returns {Promise<void>} durable settlement; unknown is sticky. */
  async receipt(access: TaskAccess,attemptId: string,outcome: string,details: {
    fileGrantId?: unknown;
}={}) : Promise<void> {
    await this.append(access,'receipt',{attemptId,outcome,run:access.run,...details})
  }
  /** @param {TaskAccess} access - current owner. @returns {void} page mutations require no outstanding human dependency. */
  assertReady(access: TaskAccess) : void {
    if(this.openTask(access,true).waiting)throw new TaskError('awaiting_user','this task awaits user input; inspect view=task, read safely, revoke or hand off')
  }
  /** @param {TaskAccess} access - owner. @param {import('./task-wait.ts').UserWaitRequest} request - model declaration. @returns {Promise<import('./task-wait.ts').UserWait>} synchronized wait; identical repeats do not append. */
  declareWait(access: TaskAccess,request: unknown) : Promise<import('./task-wait.ts').UserWait> {
    return this.serial(async()=>{
      const data=this.openTask(access,true)
      if(!validUserWait(request))throw new TaskError('invalid_request','provide a bounded user dependency, reason and resume condition')
      if(data.pendingWrite)throw new TaskError('task_busy','settle the pending write before declaring a user dependency')
      if(data.waiting){if(data.waiting.kind===request.kind&&data.waiting.reason===request.reason&&data.waiting.resumeCondition===request.resumeCondition)return data.waiting;throw new TaskError('task_busy','resolve or hand off the existing user dependency first')}
      const waiting={...request,id:'wait-'+randomUUID(),owner:('user' as const),source:('model_declared' as const),run:access.run}
      await this.appendOwned(data,'wait_requested',waiting)
      return waiting
    })
  }
  /** @param {TaskAccess} access - owner. @param {string} kind - actual prerequisite supplied through the panel. @param {string} inputRef - exact current capability or file fingerprint. @returns {Promise<void>} task-owned new input, never an authorization itself. */
  noteWaitInput(access: TaskAccess,kind: string,inputRef: string) : Promise<void> {
    return this.serial(async()=>{
      const data=this.openTask(access)
      if(data.waiting?.kind===kind&&data.state==='active')await this.appendOwned(data,'wait_input',{waitId:data.waiting.id,kind,inputRef,source:'host_verified',run:access.run})
    })
  }
  /** @param {TaskAccess} access - owner. @param {unknown} waitId - panel reference. @param {unknown} userInput - explicit human input for non-verifiable dependencies. @param {(kind:string,inputRef:string)=>boolean} current - Host rechecks current supplied capabilities. @returns {Promise<void>} records resolution without restoring page control. */
  resumeWait(access: TaskAccess,waitId: unknown,userInput: unknown,current: (kind: string, inputRef: string) => boolean) : Promise<void> {
    return this.serial(async()=>{
      const data=this.openTask(access,true),waiting=data.waiting
      if(!waiting||data.state!=='active'||waitId!==waiting.id)throw new TaskError('task_not_bound','the user dependency is inaccessible or no longer current')
      if(data.pendingWrite)throw new TaskError('task_busy','a preparation is still pending')
      const verified=['page_authorization','file_input','file_confirmation'].includes(waiting.kind)
      if(verified ? !data.waitInput||!current(waiting.kind,data.waitInput.inputRef) : !text(userInput,1000)||!userInput.trim())throw new TaskError('awaiting_user','supply the requested new input before resuming; an acknowledgement cannot replace page or file authorization')
      await this.appendOwned(data,'wait_resolved',{waitId,source:verified?'host_verified':'user_declared',...(verified?{inputRef:data.waitInput?.inputRef}:{userInput}),run:access.run})
    })
  }
  /** @param {TaskAccess} access - original run. @param {string} state - user task lifecycle request. @returns {Promise<TaskAccess>} status, never a business verdict. */
  async end(access: TaskAccess,state: string) : Promise<TaskAccess> {
    if(!['cancelled','handed_off'].includes(state))throw new TaskError('invalid_request','ending a task records cancelled or handed_off, never business success')
    if(this.openTask(access).readOnly)return access
    await this.append(access,'status',{state,run:access.run})
    void this.graph?.retire(access.scope.taskId).catch(()=>{/* The graph registry retains failed process cleanup. */})
    return access
  }
  /** @param {TaskAccess} access - user-owned task. @param {unknown} raw - explicit revised goal/scope or new run. @returns {Promise<TaskAccess>} new revision; unknown write remains blocked. */
  revise(access: TaskAccess,raw: unknown) : Promise<TaskAccess> {
    return this.serial(async()=>{
      const data=this.openTask(access)
      if(data.readOnly)throw new TaskError('task_read_only','legacy task history cannot be revised; use a new Session')
      if(data.waiting)throw new TaskError('awaiting_user','resolve the current human dependency or hand off before revising')
      if(data.pendingWrite)throw new TaskError('task_busy','a write is pending; revoke control and hand off before revising')
      if(!record(raw)||Object.keys(raw).some(key=>!['goal','constraints','criteria','origins','newRun'].includes(key)) || (raw.goal!==undefined&&!text(raw.goal,2000))
        || (raw.constraints!==undefined&&!conditions(raw.constraints)) || (raw.criteria!==undefined&&!conditions(raw.criteria)) || (raw.origins!==undefined&&(!validOrigins(raw.origins)||data.manifest.adapter!=='generic')))throw new TaskError('invalid_request','task revision must be bounded and cannot change its adapter or definition')
      const manifest={...data.manifest,scope:{...data.manifest.scope,scopeRevision:data.manifest.scope.scopeRevision+1},runId:('run-'+randomUUID() as import('./task-scope.ts').RunId),
        ...(raw.goal===undefined?{}:{goal:raw.goal}),...(raw.constraints===undefined?{}:{constraints:(raw.constraints as string[])}),...(raw.criteria===undefined?{}:{criteria:(raw.criteria as string[])}),...(raw.origins===undefined?{}:{origins:(raw.origins as string[])})}
      await this.appendOwned(data,'revise',{manifest})
      void this.graph?.retire(access.scope.taskId).catch(()=>{/* The graph registry retains failed process cleanup. */})
      return this.access(data)
    })
  }
  /** @param {TaskAccess} access - capability. @param {number} budget - projection character limit. @param {AbortSignal} [signal] - caller cancellation. @returns {Promise<Record<string,unknown>>} current Host facts and optional derived graph. */
  async view(access: TaskAccess,budget: number,signal: AbortSignal | undefined=undefined) : Promise<ReturnType<typeof taskView>> {
    if(!Number.isSafeInteger(budget)||budget<=0)throw new TaskError('invalid_request','task view budget must be a positive safe integer')
    const data=this.openTask(access)
    data.liveDocumentToken=this.controlDocument?.(access)
    const input=graphInput(data,this.graphConfig),hash=graphHash(JSON.stringify(input))
    let derived,reason=data.readOnly?'task_read_only':data.unhealthy?'task_unhealthy':'subprocess_unavailable'
    const current=()=>{try{const now=this.openTask(access);now.liveDocumentToken=this.controlDocument?.(access);return graphHash(JSON.stringify(graphInput(now,this.graphConfig)))===hash}catch{return false}}
    try{if(this.graph&&!data.readOnly&&!data.unhealthy){derived=await this.graph.project(input,budget,current,signal);reason='ready'}}catch(error){reason=error instanceof GraphError?error.code:'graph_failed'}
    this.openTask(access);data.liveDocumentToken=this.controlDocument?.(access)
    await this.refreshEvidence(access)
    if(derived&&!current()){derived=undefined;reason='stale_projection'}
    return taskView(data,budget,derived,reason,this.writable,derived?graphProjectionId(hash):undefined,this.graph?.cleanup(access.scope.taskId))
  }
  /** @param {TaskAccess} access - owner. @param {Record<string,unknown>} value - private original facts. @returns {Promise<string>} task-local evidence reference. */
  async proof(access: TaskAccess,value: Record<string, unknown>) : Promise<string> {
    const data=this.openTask(access)
    const path=join('evidence',access.run.runId,'proof-'+randomUUID()+'.json').replaceAll('\\','/')
    await this.directory(join(data.dir,'evidence',access.run.runId))
    await this.writeNew(join(data.dir,path),value)
    const bytes=await this.readArtifact(data,{role:'proof',path,sha256:'',bytes:0},false)
    return this.asset(access,'evidence',{artifact:path,sha256:hash(bytes),bytes:bytes.length},'code_verified')
  }
  /** @param {TaskAccess} access - owner. @param {string} path - existing private original. @param {string} role - fixed evidence role. @returns {Promise<import('./task-criteria.ts').Artifact>} bound artifact without exposing its bytes. */
  async artifact(access: TaskAccess,path: string,role: string) : Promise<import('./task-criteria.ts').Artifact> {
    const data=this.openTask(access),name=relative(data.dir,path).replaceAll('\\','/')
    return this.readArtifact(data,{role,path:name,sha256:'',bytes:0},false).then(bytes=>({role,path:name,sha256:hash(bytes),bytes:bytes.length}))
  }
  /** @param data - opened owner. @param ref - relative evidence file. @returns Current identity and timestamps after checking private ownership and size. */
  async artifactState(data:TaskData,ref:import('./task-criteria.ts').Artifact):Promise<BigIntStats> {
    if(!ref.path.startsWith('evidence/')||ref.path.split('/').some(part=>!part||part==='.'||part==='..')||/[\\:\x00-\x1f]/.test(ref.path))throw new Error('task-evidence-path')
    const path=join(data.dir,ref.path);noLinks(data.dir,path)
    const info=await lstat(path,{bigint:true})
    if(!info.isFile()||info.isSymbolicLink()||info.size<=0n||info.size>16_000_000n)throw new Error('task-evidence-size')
    return info
  }
  /** @param {TaskData} data - owner. @param {import('./task-criteria.ts').Artifact} ref - relative reference. @param {boolean} [verify] - enforce recorded digest. @returns {Promise<Buffer>} complete bytes from an unchanged regular file, allocating and reading at most its initial size plus one byte (16,000,001 maximum). */
  async readArtifact(data: TaskData,ref: import('./task-criteria.ts').Artifact,verify: boolean=true) : Promise<Buffer> {
    const info=await this.artifactState(data,ref),handle=await open(join(data.dir,ref.path),'r')
    try{
      const before=await handle.stat({bigint:true})
      if(!sameArtifactState(info,before))throw new Error('task-evidence-replaced')
      const size=Number(info.size),buffer=Buffer.alloc(size+1)
      let offset=0
      while(offset<buffer.length){
        const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset)
        if(bytesRead===0)break
        offset+=bytesRead
      }
      if(offset!==size)throw new Error('task-evidence-mismatch')
      const bytes=buffer.subarray(0,size)
      if(!sameArtifactState(before,await handle.stat({bigint:true}))||!sameArtifactState(before,await this.artifactState(data,ref)))throw new Error('task-evidence-changed')
      if(BigInt(bytes.length)!==info.size||(verify&&(bytes.length!==ref.bytes||hash(bytes)!==ref.sha256)))throw new Error('task-evidence-mismatch')
      return bytes
    }finally{await handle.close()}
  }
  /** @param {TaskAccess} access - owner. @returns {Promise<void>} request-local verification and final content recheck of each unique original, fenced to the exact run and journal position. */
  async refreshEvidence(access: TaskAccess) : Promise<void> {
    const data=this.openTask(access),events=data.events.slice(),version=events.length,tail=events.at(-1)?.hash,token=Symbol()
    this.evidenceReads.set(data,token)
    const checked=new Map<string,import('./task-criteria.ts').CheckedProof>(),issues=new Set<string>()
    const reads=new Map<string,{ref:import('./task-criteria.ts').Artifact;bytes:Buffer;state:BigIntStats}>(),dependencies=new Map<string,Set<string>>()
    const read=async(ref:import('./task-criteria.ts').Artifact,used:Set<string>)=>{
      const key=JSON.stringify([access.run,ref.path,ref.sha256,ref.bytes]);used.add(key)
      const cached=reads.get(key),state=await this.artifactState(data,ref)
      if(cached){if(!sameArtifactState(state,cached.state))throw new Error('task-evidence-changed');return cached.bytes}
      const bytes=await this.readArtifact(data,ref)
      if(!sameArtifactState(state,await this.artifactState(data,ref)))throw new Error('task-evidence-changed')
      reads.set(key,{ref,bytes,state});return bytes
    }
    if(!data.readOnly&&!data.unhealthy)for(const event of events){
      const row=event.data
      if(event.type!=='asset'||row.kind!=='evidence'||typeof row.id!=='string'||!record(row.data)||typeof row.data.artifact!=='string'||!validRunScope(row.run)||!sameRunScope(row.run,access.run))continue
      const ref={role:'proof',path:row.data.artifact,sha256:row.data.sha256,bytes:row.data.bytes},used=new Set<string>()
      dependencies.set(row.id,used)
      try{
        if(!validArtifact(ref)||!ref.path.startsWith('evidence/'+access.run.runId+'/'))throw new Error('task-evidence-reference')
        const value:unknown=JSON.parse((await read(ref,used)).toString('utf8'))
        if(!record(value))throw new Error('task-evidence-object')
        const files=new Map<string,Buffer>()
        if(value.files!==undefined){
          if(!Array.isArray(value.files)||value.files.length>2)throw new Error('task-evidence-files')
          for(const item of value.files){if(!validArtifact(item)||!item.path.startsWith('evidence/'+access.run.runId+'/')||files.has(item.role))throw new Error('task-evidence-file');files.set(item.role,await read(item,used))}
        }
        checked.set(row.id,{value,files})
      }catch(error){void error;issues.add(row.id)}
    }
    const changed=new Set<string>()
    for(const [key,item]of reads){
      try{
        if(!sameArtifactState(item.state,await this.artifactState(data,item.ref))){changed.add(key);continue}
        await this.readArtifact(data,item.ref)
      }catch(error){void error;changed.add(key)}
    }
    for(const [id,used]of dependencies)if([...used].some(key=>changed.has(key))){checked.delete(id);issues.add(id)}
    this.openTask(access)
    if(this.evidenceReads.get(data)!==token)throw new TaskError('task_busy','a newer evidence read superseded this result; read the current task again')
    if(data.events.length!==version||data.events.at(-1)?.hash!==tail){
      data.checkedProofs=new Map();data.evidenceIssues=[...dependencies.keys()]
      throw new TaskError('task_busy','task history changed during evidence verification; read the current task again')
    }
    data.checkedProofs=checked;data.evidenceIssues=[...issues]
  }
  /** @param {TaskAccess} access - owner. @param {Record<string,unknown>} result - trusted validator result. @param {string} proofRef - private original reference. @returns {Promise<string>} independently checked current verdict. */
  async verdict(access: TaskAccess,result: Record<string, unknown>,proofRef: string) : Promise<string> {
    const criterion=trustedCriterion(this.openTask(access).manifest)
    if(!criterion)throw new TaskError('invalid_request','no trusted criterion exists for this workflow')
    await this.refreshEvidence(access)
    await this.append(access,'business_verdict',{...result,source:'code_verified',run:access.run,proofRef,criterionId:criterion.id,validatorId:criterion.validatorId,validatorVersion:criterion.version})
    return taskFacts(this.openTask(access)).verdict
  }
  /** @param {TaskAccess} access - capability. @param {string} kind - code-owned asset kind. @param {Record<string,unknown>} data - safe facts; raw personnel remain in private evidence. @param {'host'|'code_verified'} [source] - factual authority. @returns {Promise<string>} unique task-local reference, never deduplicated by name or content. */
  async asset(access: TaskAccess,kind: string,data: Record<string, unknown>,source: 'host' | 'code_verified'='host') : Promise<string> {
    if(!['page','file','unit_check','import_result','evidence'].includes(kind))throw new TaskError('invalid_request','unsupported task asset')
    const id='asset-'+randomUUID()
    await this.append(access,'asset',{id,kind,data,source,run:access.run})
    return id
  }
  /** @param {TaskAccess} access - capability. @param {string} from - existing task asset. @param {string} to - existing task asset. @param {string} relation - fixed relation. @returns {Promise<string>} journaled relation after both ownership checks. */
  async relate(access: TaskAccess,from: string,to: string,relation: string) : Promise<string> {
    return this.serial(async()=>{
    const data=this.openTask(access),references=currentRunReferences(data)
    if(!references.has(from)||!references.has(to))throw new TaskError('task_not_bound','one or more task references are inaccessible')
    if(!['observed_on','validated_by','derived_from','selected_from','proves','yields'].includes(relation))throw new TaskError('invalid_request','unsupported task relation')
    const id='edge-'+randomUUID()
    await this.appendOwned(data,'edge',{id,from,to,relation,run:access.run})
    return id
    })
  }
  /** Verified guest context for an operation; a missing observation stays context-only. */
  async pageContext(access:TaskAccess,guest:Parameters<typeof pageIdentity>[1]):Promise<string> {
    const identity=pageIdentity(access.run,guest,'context'),task=this.openTask(access)
    const resource=resourceDescriptor(access.run,'page','context',{resourceIdentity:identity}).id
    const prior=task.events.findLast(e=>e.type==='asset'&&e.data.kind==='page'&&validRunScope(e.data.run)&&sameRunScope(e.data.run,access.run)&&record(e.data.data)&&e.data.data.documentToken===guest.documentToken&&resourceDescriptor(access.run,'page',String(e.data.id),e.data.data).id===resource)
    if(prior)return String(prior.data.id)
    return this.asset(access,'page',{documentToken:guest.documentToken,resourceIdentity:identity,contextOnly:true})
  }
  /** @param {TaskAccess} access - capability. @param {string} id - task-local detail. @param {number} offset - safe character continuation, bounded by configured bytes and any known current derived length. @param {number} budget - character budget. @param projectionId - identity required for graph/digest continuation after offset zero. @returns {Promise<object>} validated detail from one run and journal position, exposed in bounded text pieces; all canonical detail JSON obeys the configured UTF-8 capacity. */
  async detail(access: TaskAccess,id: string,offset: number,budget: number,projectionId?:string) : Promise<object> {
    if(!Number.isSafeInteger(budget)||budget<=0)throw new TaskError('invalid_request','task detail budget must be a positive safe integer')
    const data=this.openTask(access)
    if(!Number.isSafeInteger(offset)||offset<0)throw new TaskError('invalid_request','detail offset must be a nonnegative safe integer')
    if(offset>this.graphConfig.graphMaxDetailBytes)throw new TaskError('invalid_request','detail offset exceeds the configured task detail capacity')
    const position={run:access.run,version:data.events.length,tail:data.events.at(-1)?.hash}
    const row=data.events.findLast(event=>event.type==='asset'&&event.data.id===id)
    const asset=row?{id,taskId:data.manifest.scope.taskId,kind:row.data.kind,source:row.data.source,sourceSeq:row.seq,data:(row.data.data as Record<string, unknown>)}:undefined
    let criterion=taskFacts(data).criteria.find(item=>item.id===id)
    let value,currentProjection:string|undefined,serialized:string|undefined
    if(asset||id==='waiting'||criterion||id==='criteria'||id==='coverage'||id==='goal'||data.snapshot?.definition.resources.includes(id)){
      await this.refreshEvidence(access);this.openTask(access)
      if(data.events.length!==position.version||data.events.at(-1)?.hash!==position.tail)throw new TaskError('task_busy','task history changed during detail verification; read the current task again')
      criterion=taskFacts(data).criteria.find(item=>item.id===id)
    }
    if(asset)value=asset.kind==='evidence'?{...asset,data:{sha256:asset.data.sha256,bytes:asset.data.bytes,originalAvailable:data.checkedProofs?.has(asset.id)??false}}:asset
    else if(id==='waiting')value={current:data.state==='active'?data.waiting??null:null,history:data.events.filter(event=>['wait_requested','wait_input','wait_resolved'].includes(event.type)).map(event=>({sourceSeq:event.seq,type:event.type,...event.data}))}
    else if(criterion)value={id:criterion.id,kind:'criterion',source:criterion.source,data:criterion,proofRefs:taskCoverage(data).conditions.find(c=>c.id===id)?.proofRefs??[],traceRef:'graph:exploration'}
    else if(id==='criteria')value=taskFacts(data).criteria
    else if(id==='coverage'){
      value=taskCoverage(data)
      currentProjection=graphProjectionId(graphHash(JSON.stringify([position,value,data.evidenceIssues??[]])))
      if((offset>0&&!projectionId)||(projectionId!==undefined&&projectionId!==currentProjection))throw new TaskError('task_not_bound','coverage changed or identity is missing; restart detail at offset zero')
    }
    else if(id==='goal')value={goal:data.manifest.goal,constraints:data.manifest.constraints,criteria:data.manifest.criteria,source:'user_declared'}
    else if(data.snapshot?.definition.resources.includes(id))value={name:id,text:data.snapshot.files[id],source:'definition_snapshot',digest:data.manifest.definitionDigest}
    else {
      const resource=data.events.some(e=>e.type==='asset'&&validRunScope(e.data.run)&&resourceDescriptor(e.data.run,String(e.data.kind),String(e.data.id),e.data.data).id===id)
      if(!['graph','graph:assets','graph:exploration'].includes(id)&&!resource&&!id.startsWith('digest-')&&!taskReferences(data).has(id))throw new TaskError('task_not_bound','task reference is inaccessible')
      if(data.readOnly)throw new TaskError('task_read_only','derived details are unavailable for read-only history; original details remain readable')
      if(data.unhealthy)throw new TaskError('task_unavailable','derived details require healthy task history; original details remain readable')
      if(!this.graph)throw new TaskError('task_unavailable','graph component is unavailable')
      data.liveDocumentToken=this.controlDocument?.(access)
      const input=graphInput(data,this.graphConfig),hash=graphHash(JSON.stringify(input));currentProjection=graphProjectionId(hash)
      if((offset>0&&!projectionId) || (projectionId!==undefined&&projectionId!==currentProjection))throw new TaskError('task_not_bound','projection changed or identity is missing; restart detail at offset zero')
      const known=this.detailLengths.get(data)
      if(known?.projectionId===currentProjection&&known.ref===id&&offset>known.totalChars)throw new TaskError('invalid_request','detail offset exceeds its total characters')
      const current=()=>{try{const latest=this.openTask(access);latest.liveDocumentToken=this.controlDocument?.(access);return graphHash(JSON.stringify(graphInput(latest,this.graphConfig)))===hash}catch{return false}}
      try{value=await this.graph.detail(input,id,current)}catch(error){
        const code=error instanceof GraphError?error.code:'graph_failed'
        throw new TaskError(['stale_reference','stale_projection'].includes(code)?'task_not_bound':'task_unavailable',`graph detail unavailable: ${code}`)
      }
      serialized=JSON.stringify(value)
      if(Buffer.byteLength(serialized,'utf8')>this.graphConfig.graphMaxDetailBytes)throw new TaskError('task_unavailable','graph detail unavailable: detail_capacity')
      if(!current())throw new TaskError('task_not_bound','projection changed during detail retrieval; restart detail at offset zero')
      this.detailLengths.set(data,{projectionId:currentProjection,ref:id,totalChars:serialized.length})
      if(offset>serialized.length)throw new TaskError('invalid_request','detail offset exceeds its total characters')
      await this.refreshEvidence(access)
      this.openTask(access);data.liveDocumentToken=this.controlDocument?.(access)
      if(graphHash(JSON.stringify(graphInput(data,this.graphConfig)))!==hash)throw new TaskError('task_not_bound','projection changed during evidence verification; restart detail at offset zero')
    }
    if(serialized===undefined){
      serialized=JSON.stringify(value)
      if(Buffer.byteLength(serialized,'utf8')>this.graphConfig.graphMaxDetailBytes)throw new TaskError('task_unavailable','task detail unavailable: detail_capacity')
    }
    if(offset>serialized.length)throw new TaskError('invalid_request','detail offset exceeds its total characters')
    return {task:position.run,contextVersion:position.version,ref:id,...(currentProjection?{projectionId:currentProjection}:{}),offset,totalChars:serialized.length,text:serialized.slice(offset,offset+budget),complete:offset+budget>=serialized.length}
  }
  /** @returns {Promise<void>} read immutable ownership plus complete validated journal prefixes; no commands or control are restored. */
  async recover() : Promise<void> {
    if(!this.runtime || !this.profileId || !this.root)return
    const registry=join(this.runtime,'registry')
    try{await lstat(registry)}catch(error){if(record(error)&&error.code==='ENOENT')return;throw error}
    noLinks(this.root,registry)
    for(const file of await readdir(registry)) {
      if(!/^[a-f0-9]{64}\.json$/.test(file))throw new Error('task-registry-invalid')
      const path=join(registry,file);noLinks(this.root,path)
      const row=JSON.parse(await readFile(path,'utf8'))
      if(!record(row)||!text(row.sessionId,200)||typeof row.taskId!=='string'||!/^task-[a-f0-9-]{36}$/.test(row.taskId)||row.profileId!==this.profileId||file!==hash(row.sessionId)+'.json')throw new Error('task-registry-invalid')
      this.bindings.set(row.sessionId,row.taskId)
      const dir=join(this.runtime,'tasks',row.taskId)
      try {
        noLinks(this.root,dir)
        const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'))
        if(!validTaskManifest(manifest,true)||manifest.scope.ownerSessionId!==row.sessionId||manifest.scope.taskId!==row.taskId||manifest.scope.profileId!==this.profileId
          || !validOrigins(manifest.origins)||!text(manifest.goal,2000)||!conditions(manifest.constraints)||!conditions(manifest.criteria))throw new Error('task-manifest-invalid')
         const data: TaskData={manifest:(manifest as Manifest),dir,events:[],blocked:false,unhealthy:false,state:'active',readOnly:manifest.schemaVersion!==TASK_FORMAT_VERSION || row.schemaVersion!==TASK_FORMAT_VERSION,storageIssue:manifest.schemaVersion===undefined?'legacy_unversioned':manifest.schemaVersion!==TASK_FORMAT_VERSION?'unsupported_manifest_version':row.schemaVersion!==TASK_FORMAT_VERSION?'unsupported_ownership_version':undefined}
        if(manifest.definitionId){
          const snapshot=loadDefinition(dir, 'definition-snapshot', String(manifest.definitionId))
          if(snapshot.digest!==manifest.definitionDigest || snapshot.definition.version!==manifest.definitionVersion)throw new Error('task-snapshot-changed')
          data.snapshot=snapshot
        }
        await this.recoverJournal(data)
        this.tasks.set(row.taskId,data)
        await this.refreshEvidence(this.access(data))
      }catch(error){
        // Ownership is retained even when its task cannot be decoded: this Session cannot create a replacement task.
        void error
      }
    }
  }
  /** @param {TaskData} data - task being recovered. @returns {Promise<void>} valid history prefix, conservatively blocked on truncation/unfinished writes. */
  async recoverJournal(data: TaskData) : Promise<void> {
    const path=join(data.dir,'basic_law_index','events.jsonl')
    if(this.root)noLinks(this.root,path)
    const bytes=await readFile(path,'utf8')
    const lines=bytes.split('\n');const tail=lines.pop()
    try {
      for(const line of lines){
        const event=JSON.parse(line)
        if(!record(event)||event.seq!==data.events.length+1||event.prev!==(data.events.at(-1)?.hash ?? '')||typeof event.type!=='string'||!record(event.data))throw new Error('task-journal-invalid')
        const unsigned=data.readOnly && event.schemaVersion===undefined ? {seq:event.seq,prev:event.prev,type:event.type,data:event.data} : {schemaVersion:event.schemaVersion,seq:event.seq,prev:event.prev,type:event.type,data:event.data}
        if(event.hash!==hash(JSON.stringify(unsigned)))throw new Error('task-journal-hash')
        if(!data.readOnly && (event.schemaVersion!==TASK_FORMAT_VERSION || (event.type==='created'&&event.seq!==1) || !validTaskEvent(event.type,event.data,data.manifest,data.pendingWrite,data.waiting,data.waitInput)))throw new Error('task-journal-unsupported-semantics')
        if(data.events.length===0 && (event.type!=='created'||JSON.stringify(event.data.manifest)!==JSON.stringify(data.manifest)))throw new Error('task-journal-creation-mismatch')
        if(data.manifest.schemaVersion===undefined){
          const payload={...event.data,...(event.data.manifest && record(event.data.manifest)?{manifest:{...event.data.manifest,schemaVersion:TASK_FORMAT_VERSION}}:{}),...(event.type==='status'&&event.data.run===undefined?{run:{...data.manifest.scope,runId:data.manifest.runId,workflowRef:data.manifest.workflowRef}}:{})}
          if(!validTaskEvent(event.type,payload,{...data.manifest,schemaVersion:TASK_FORMAT_VERSION},data.pendingWrite,data.waiting,data.waitInput))throw new Error('legacy-journal-unsupported-semantics')
        }
        const accepted=(event as TaskEvent)
        data.events.push(accepted);this.reduce(data,accepted)
      }
      if(tail!=='')throw new Error('task-journal-tail')
      if(data.events.length===0 || data.events[0].type!=='created')throw new Error('task-journal-missing')
    }catch(error){data.unhealthy=true;data.blocked=true;data.storageIssue='invalid_or_unsupported_journal';void error}
    if(data.pendingWrite)data.blocked=true
  }
  /** @returns {Promise<void>} drain owned writes before releasing the profile writer lease. */
  async close() : Promise<void> {
    this.closed=true;this.abort.abort()
    await Promise.allSettled([this.ready,this.tail])
    this.releaseWriter?.()
    await this.writer?.catch(()=>{})
    this.handles=new WeakMap()
  }
}
