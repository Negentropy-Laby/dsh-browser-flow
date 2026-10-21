export type LiveAgent = {
    id: string;
    session?: { id?:string; vars?: Record<string, unknown> };
};
export type ToolExec = {
    agent?: LiveAgent | undefined;
    signal: AbortSignal;
};
export type FetchRoute = {
    path: string;
    methods: string[];
    requestBody?: "buffered" | undefined;
    fetch: (request: Request) => Promise<Response>;
};
export type HostContext = {
    get?: ((name: string, strict: boolean) => import("./task-definitions.ts").Profile | undefined) | undefined;
    profileContext?: import("./task-definitions.ts").Profile | undefined;
    tools?: {
        register: (definition: ToolDefinition) => () => void;
    } | undefined;
    agents?: {
        get: (id: string) => LiveAgent | undefined;
    } | undefined;
    skills?: {
        register: (skill: import("./task-definitions.ts").LocalSkill) => () => void;
    } | undefined;
    subprocess?: import("./graph/protocol.ts").SubprocessPort | undefined;
    connection?: {
        fetch: {
            register: (route: FetchRoute) => () => void;
        };
    } | undefined;
    inject?: ((dependencies: string[], callback: (scope: HostContext) => void) => void) | undefined;
    effect?: ((callback: () => (() => void | Promise<void>), label?: string) => void) | undefined;
    logger?: {
        info: (message: string) => void;
        warn: (message: string) => void;
        error: (message: string) => void;
    } | undefined;
};
export type ResolvedCaller = {
    agent: LiveAgent;
    sessionId: string;
    agentInstanceToken: string;
};
export type ControlStore = ReturnType<typeof createControlState>;

/**
 * The browser-flow Host service and plugin entry.
 *
 * Responsibilities:
 *
 * - Mint a non-persistent `agentInstanceToken` for every live Agent object the
 *   plugin sees, so two Agents of the same Session are distinguishable (E06:
 *   the Harness exposes no `runId`).
 * - Own the control state machine (`src/state.ts`).
 * - Serve the panel channel as exact routes on the existing authenticated
 *   `/api` connection (`ctx.connection.fetch.register`), which is the mechanism
 *   this Host version actually loads for external plugins.
 * - Register the six tools and answer them through the same state machine, so
 *   the model path and the panel path cannot diverge.
 *
 * The plugin registers no `ctx.browserUse` and modifies no Host source.
 *
 * @module @negentropy/dsh-browser-flow
 */

import { pagePolicy, navigationVerdict } from './task-adapters.ts'
import { TaskStore, TaskError } from './task-store.ts'
import { sameRunScope } from './task-scope.ts'
import { randomUUID } from 'node:crypto'
import { Config, resolveConfig } from './config.ts'
import { PROTOCOL_VERSION, ROUTE_PREFIX, failure, success, validateHello, validateResult } from './protocol.ts'
import { join } from 'node:path'
import { ImportFiles } from './import-files.ts'
import { importScope, extractIdentity, judgeIdentity, judgeImport } from './import-rules.ts'
import { decodeImportEvidence } from './import-evidence.ts'
import { createControlState, monotonicNow } from './state.ts'
import { redactUrl } from './pagecode.ts'
import { createTools, type ToolDefinition } from './tools.ts'
import { type ControlLease } from './state.ts'
import { type Result, type PageOperation, type FindQuery, type ActionInput, type WaitInput, isRecord } from './protocol.ts'
import { GraphWorkers } from './graph/worker.ts'
import { taskFacts } from './task-facts.ts'
import { taskView } from './task-projections.ts'
import { tasksRoot, listDefinitions, definitionSkills } from './task-definitions.ts'

export { Config }
export const name = 'browser-flow'
/** Required Host services: tool registration and the Agent registry. */
export const inject = ['tools', 'agents']

/**
 * A short stable digest of one instance token.
 *
 * The panel shows this so the user can confirm which live Agent instance would
 * receive control. The token itself never leaves the Host; a 32-bit digest is
 * enough to tell two instances apart and cannot be used to address one.
 * @param {string} token - the plugin-minted instance token.
 * @returns {string} eight hexadecimal characters.
 */
function instanceDigest(token: string) : string {
  let hash = 0x811c9dc5
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** The Host service: control state plus the panel channel. */
export class BrowserFlowService {
graph: GraphWorkers;
ctx: HostContext;
config: import("./config.ts").BrowserFlowConfig;
tasks: TaskStore;
importFiles: ImportFiles;
instanceTokens: WeakMap<object, string>;
now: typeof monotonicNow;
state: ControlStore;
tools: Map<string, ToolDefinition>;
disposers: (() => void | Promise<void>)[];
idleTimer: (() => Promise<void>) | undefined;
closed: boolean;
pending: Set<Promise<object>>;
closing: Promise<void> | undefined;

  /**
   * @param {HostContext} ctx - Host plugin context.
   * @param {import('./config.ts').BrowserFlowConfig} config - resolved config.
   * @param {GraphWorkers} [graph] - derived graph service; defaults to the packaged helper.
   */
  constructor(ctx: HostContext, config: import('./config.ts').BrowserFlowConfig, graph: GraphWorkers=new GraphWorkers(config)) {
    this.graph=graph
    this.ctx = ctx
    this.config = config
    const profile=ctx.get ? ctx.get('profileContext',false) : ctx.profileContext
    this.tasks=new TaskStore(tasksRoot(config.localTasksDir,profile),profile,config.commandBudgetMs,graph,config)
    this.importFiles = new ImportFiles(undefined)
     this.instanceTokens=new WeakMap()
    this.now=monotonicNow
    this.state =  createControlState({now:()=>this.now()})
    this.tasks.controlDocument=access=>{
      const agent=this.ctx.agents?.get(access.scope.ownerSessionId),lease=agent?this.state.leaseFor(agent,this.tokenOf(agent),access.scope.ownerSessionId):undefined
      return lease?.state==='active'&&lease.task&&sameRunScope(lease.task,access.run)?lease.documentToken:undefined
    }

    this.tools = new Map()

    this.disposers = []

    this.idleTimer = undefined
    this.closed = false

    this.pending = new Set()

    this.closing = undefined
  }

  /** @param {() => Promise<object>} operation - admitted operation including its final durable record. @returns  terminal result; shutdown drains it before storage closes. */
  own<T extends object>(operation: () => Promise<T>) {
    if(this.closed)return Promise.resolve(failure('connection_stale','the service was unloaded; control is suspended'))
    let pending
    try{pending=operation()}catch(error){pending=Promise.reject(error)}
    this.pending.add(pending)
    return pending.finally(()=>this.pending.delete(pending))
  }
  /** @param  lease - live lease. @returns {string} immutable comparison for every asynchronous resumption. */
  leaseStamp(lease: ControlLease) : string {return JSON.stringify([lease.task,lease.id,lease.epoch,lease.documentToken,lease.connectionInstanceId,lease.connectionGeneration])}
  /** @param {ResolvedCaller} caller - original Agent. @param {import('./task-store.ts').TaskAccess} access - original task/run. @param  lease - original lease. @param {string} stamp - captured binding. @param {boolean} [write] - enforce task write admission. @returns {void} no changed authorization is allowed to reach a guest. */
  assertCurrent(caller: ResolvedCaller,access: import('./task-store.ts').TaskAccess,lease: ControlLease,stamp: string,write: boolean=true) : void {
    this.tasks.openTask(access,write)
    if(this.closed || this.ctx.agents?.get(caller.sessionId)!==caller.agent || lease.state!=='active' || this.state.leaseFor(caller.agent,caller.agentInstanceToken,caller.sessionId)!==lease || this.leaseStamp(lease)!==stamp)throw new TaskError('revoked','authorization changed during the operation; no new page dispatch is permitted')
  }
  /**
   * Token for one live Agent object, minted on first sight.
   * @param {object} agent - live Agent object.
   * @returns {string} opaque token; never persisted.
   */
  tokenOf(agent: object) : string {
    let token = this.instanceTokens.get(agent)
    if (token === undefined) {
      token = `agent-${randomUUID()}`
      this.instanceTokens.set(agent, token)
    }
    return token
  }

  /**
   * Resolve the caller of one tool invocation to its exact live Agent.
   *
   * The registered object must be the calling object and the Session must
   * match; comparing Session ids alone is not enough (E06).
   * @param {ToolExec} exec - tool execution context.
   * @returns  caller verdict.
   */
  resolveCaller(exec: Pick<ToolExec,'agent'> & Partial<Pick<ToolExec,'signal'>>) {
    const agent = exec?.agent
    if (agent === undefined || agent === null) {
      return failure('no_live_agent', 'this tool runs only inside an Agent turn; start the Session\'s Agent first')
    }
    const sessionId = agent.id
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return failure('no_live_agent', 'the calling Agent has no Session identity')
    }
    const registered = this.ctx.agents?.get(sessionId)
    if (registered !== agent) {
      return failure('agent_mismatch', 'the calling Agent is not the registered live Agent for this Session; authorize again')
    }
    return success({ agent, sessionId, agentInstanceToken: this.tokenOf(agent) })
  }

  /** @param {ResolvedCaller} caller - exact live caller. @param {boolean} [write] - page mutation or file grant. @returns {import('./task-store.ts').TaskAccess} current task capability. */
  taskOf(caller: ResolvedCaller,write: boolean=false) : import('./task-store.ts').TaskAccess {
    const access=this.tasks.current(caller.sessionId)
    if(!access)throw new TaskError('task_not_bound','bind a task in Browser Flow or open view=task to recover this Session’s binding')
    this.tasks.openTask(access,write)
    return access
  }
  /** @param {unknown} error - expected task failure or unexpected defect. @returns {ReturnType<typeof failure>} sanitized failure. */
  taskFailure(error: unknown) : ReturnType<typeof failure> {
    if(error instanceof TaskError)return failure(error.code,error.message)
    this.ctx.logger?.error?.('browser-flow: task operation failed; dependent writes remain disabled')
    return failure('task_storage_failed','task operation could not be recorded; revoke and hand off')
  }
  /** @param {import('./task-store.ts').TaskAccess} access - verified task. @param {boolean} [withGraph] - explicitly request derived graph computation. @param {AbortSignal} [signal] - caller cancellation. @returns {Promise<object>} logged task summary. */
  async taskSummary(access: import('./task-store.ts').TaskAccess,withGraph: boolean=false,signal: AbortSignal | undefined=undefined) {
    const data=this.tasks.openTask(access)
    data.liveDocumentToken=this.tasks.controlDocument?.(access)
    const budget=Math.max(1800,Math.floor(this.config.observeMaxChars*3/4))
    const view=withGraph?await this.tasks.view(access,budget,signal):taskView(data,budget,undefined,'not_requested',this.tasks.writable,undefined,this.graph.cleanup(access.scope.taskId))
    const workflow=data.snapshot?.definition.workflows.find(row=>row.id===data.manifest.workflowRef)
    const resources=workflow ? [...workflow.instructions,...workflow.resources] : []
    const instructions=(workflow?.instructions ?? []).map(name=>({name,text:data.snapshot?.files[name] ?? ''}))
    const instructionBudget=Math.floor(this.config.observeMaxChars/2/Math.max(1,instructions.length))
    return {task:access.run,state:data.readOnly?'read_only':data.blocked?'write_blocked':data.waiting&&data.state==='active'?'awaiting_user':data.state,contextVersion:data.events.length,goal:data.manifest.goal.slice(0,1000),origins:data.manifest.origins,adapter:data.manifest.adapter,
      definition:data.manifest.definitionId ? {id:data.manifest.definitionId,version:data.manifest.definitionVersion,digest:data.manifest.definitionDigest} : null,
      workflow:workflow ? {id:workflow.id,stopBoundary:workflow.stopBoundary} : null,
      instructions:instructions.map(row=>({...row,text:row.text.slice(0,instructionBudget),complete:row.text.length<=instructionBudget})),resources,
      ...view,
      businessVerdict:taskFacts(data).verdict,
      writeBlocked:!!data.readOnly||data.blocked||data.unhealthy||!this.tasks.writable,logHealthy:!data.unhealthy}
  }

  /** @param {ResolvedCaller} caller - tool caller. @param  result - owned canonical result. @returns  task identity/state attached without reading any other task. */
  annotate<T extends object>(caller: ResolvedCaller,result: Result<T>) {
    try {
      const access=this.taskOf(caller)
      const data=this.tasks.openTask(access)
      return result.ok ? success({...result.value,task:access.run,taskState:data.readOnly?'read_only':data.blocked?'write_blocked':data.waiting&&data.state==='active'?'awaiting_user':data.state,contextVersion:data.events.length})
        : {...result,task:access.run,taskState:data.readOnly?'read_only':data.blocked?'write_blocked':data.waiting&&data.state==='active'?'awaiting_user':data.state,contextVersion:data.events.length}
    }catch{return result}
  }

  /**
   * Resolve the control lease of one caller.
   * @param {ResolvedCaller} caller - resolved caller.
   * @returns  lease verdict.
   */
  leaseOf(caller: ResolvedCaller) {
    const lease = this.state.leaseFor(caller.agent, caller.agentInstanceToken, caller.sessionId)
    if (lease === undefined) {
      // Distinguish "nothing was authorized" from "it was authorized for a
      // different Agent instance". The plan requires re-authorization when the
      // Agent is recreated, so the caller must be told which case it is.
      const held = this.state.leaseCountForSession(caller.sessionId)
      if (held > 0) {
        return failure('agent_replaced', 'the page is authorized for a different Agent instance of this Session; authorize it again in the panel')
      }
      return failure('not_authorized', 'no page is authorized for this Agent; open the Browser Flow panel and authorize the page')
    }
    return success(lease)
  }

  /**
   * List the pages this caller could be authorized for.
   * @param {ResolvedCaller} caller - resolved caller.
   * @returns  page list.
   */
  listTabs(caller: ResolvedCaller) {
    try{this.taskOf(caller)}catch(error){return this.taskFailure(error)}
    const connections = this.state.connectionsFor(caller.sessionId)
    if (connections.length === 0) {
      return failure('page_unavailable', 'the Browser Flow panel is not connected in this Session; open the panel and authorize a page')
    }
    // One page is one guest lease. A Session can have several live panels (a
    // reopened tab, a second window), and each reports the same guests, so the
    // list is keyed by lease rather than concatenated: a duplicate entry would
    // present the same physical page twice with different control leases.

    const byLease: Map<string, Extract<ReturnType<ControlStore['listPages']>, {ok:true}>['value']['pages'][number]> = new Map()
    for (const connection of connections) {
      const listed = this.state.listPages(connection.instanceId, connection.generation)
      if (!listed.ok) continue
      for (const page of listed.value.pages) {
        const existing = byLease.get(page.lease)
        // Prefer an authorized entry, so the caller sees the lease it can act on.
        if (existing !== undefined && existing.authorized === true && page.authorized !== true) continue
        byLease.set(page.lease, { ...page, url: redactUrl(page.url) })
      }
    }
    const lease = this.leaseOf(caller)
    const file = lease.ok ? this.importFiles.current(lease.value) : undefined
    return success({ sessionId: caller.sessionId, pages: [...byLease.values()], authorization: 'explicit',
      ...(file ? {fileGrant:{state:file.state,kind:file.scope.kind,sha256:file.sha256,rows:file.input.people.length,boundary:'import_confirmed',...(file.state==='confirmed'?{fileGrantId:file.id}:{})}} : {}) })
  }

  /**
   * Dispatch one page operation through the caller's lease.
   * @param {ResolvedCaller} caller - resolved caller.
   * @param  op - validated operation payload.
   * @param {AbortSignal} signal - caller cancellation.
   * @param {number} [startedAt] - original Host monotonic admission time, before durable/file work.
   * @param {string} [writeAttemptId] - internal task-owned durable attempt required for writes.
   * @returns  validated dynamic page result or structured refusal.
   */
  async dispatch( caller: ResolvedCaller,  op: PageOperation,  signal: AbortSignal, startedAt: number=this.now(), writeAttemptId: string | undefined=undefined): Promise<Result<Record<string, unknown>>> {
    if (this.closed) return failure('connection_stale', 'the browser control service was unloaded')
    let access
    try {access=this.taskOf(caller,op.kind==='act')}catch(error){return this.taskFailure(error)}
    const lease = this.leaseOf(caller)
    if (!lease.ok) return lease
    if(op.kind==='act'&&(!writeAttemptId||this.tasks.openTask(access).pendingWrite!==writeAttemptId))return failure('invalid_request','writes must enter through the task-owned action path')
    if(op.kind==='act')this.tasks.assertReady(access)
    const originalStamp=this.leaseStamp(lease.value)
    if(!lease.value.task || !sameRunScope(access.run,lease.value.task))return failure('task_scope_mismatch','page control belongs to another task revision; explicitly authorize again')
    const remaining=this.config.commandBudgetMs-(this.now()-startedAt)
    if(remaining<=0||signal?.aborted)return failure('deadline_exceeded','the total command budget expired before delivery')
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), remaining)

    let completion: Promise<object> | undefined
    try {
      const cancellation = signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal])
      const policy=pagePolicy(this.tasks.openTask(access).manifest,lease.value.importKind)
      const operation = this.state.run(lease.value, {...op,...(policy?{pagePolicy:policy}:{})}, {...this.config,commandBudgetMs:remaining}, cancellation)
      completion = operation
      this.pending.add(operation)
      const outcome = await operation
      if (!outcome.ok) return outcome
      try{this.assertCurrent(caller,access,lease.value,originalStamp,false)}catch(error){return this.taskFailure(error)}
      if (op.view === 'bjrsj_import') {
        const processing=this.importObservation(caller,lease.value,outcome.value)
        this.pending.add(processing)
        try{return await processing}finally{this.pending.delete(processing)}
      }
      const redacted=this.redactResult(outcome.value ?? {})
      if(op.kind==='observe'){
        try{
          const pageRef=await this.tasks.asset(access,'page',{documentToken:lease.value.documentToken,...redacted})
          const judged=navigationVerdict(this.tasks.openTask(access).manifest,redacted)
          if(judged.verdict==='entry_reached'&&!this.tasks.openTask(access).blocked){const proofRef=await this.tasks.proof(access,{schemaVersion:1,kind:'navigation',run:access.run,pageRef});await this.tasks.relate(access,proofRef,pageRef,'observed_on');const verified=await this.tasks.verdict(access,judged,proofRef);redacted.navigation=verified===judged.verdict?judged:{verdict:'unverified',reason:'task-evidence-unverified'}}
        }catch(error){return success({...redacted,recording:'failed',writeBlocked:true})}
      }
      try{this.assertCurrent(caller,access,lease.value,originalStamp,false)}catch(error){return this.taskFailure(error)}
      return success(redacted)
    } finally {
      clearTimeout(timer)
      if (completion !== undefined) this.pending.delete(completion)
    }
  }

  /**
   * Redact URLs inside one page result before it reaches a model.
   * @param  value - page result.
   * @returns  redacted copy.
   */
  redactResult(value: Record<string, unknown>) {
    const copy = { ...value }
    delete copy.privateImport
    delete copy.file
    if (typeof copy.url === 'string') copy.url = redactUrl(copy.url)
    for (const key of ['matches', 'nodes']) {
      if (!Array.isArray(copy[key])) continue
      copy[key] = copy[key].map(item => (typeof item?.href === 'string' ? { ...item, href: redactUrl(item.href) } : item))
    }
    return copy
  }

  /**
   * Observe the authorized page.
   * @param {ResolvedCaller} caller - resolved caller.
   * @param {AbortSignal} signal - cancellation.
   * @param {string} [view] - page, scoped import evidence or task.
   * @param {{ref:string,offset:number,projectionId?:string}} [detail] - task detail only.
   * @returns  observation.
   */
  observe(caller: ResolvedCaller,signal: AbortSignal,view?: string,detail?: {
    ref: string;
    offset: number;projectionId?:string;
}) {return this.own(()=>this.observeOwned(caller,signal,view,detail))}
  /** @param {ResolvedCaller} caller - actual caller. @param {AbortSignal} signal - cancellation. @param {string} [view] - fixed view. @param {{ref:string,offset:number,projectionId?:string}} [detail] - task-local continuation. @returns  owned observation. */
  async observeOwned(caller: ResolvedCaller, signal: AbortSignal, view?: string, detail?: {
    ref: string;
    offset: number;projectionId?:string;
}) {
    if(view==='task'){
      try{const access=await this.tasks.forSession(caller.sessionId);await this.tasks.refreshEvidence(access);return success(detail ? await this.tasks.detail(access,detail.ref,detail.offset,this.config.observeMaxChars,detail.projectionId) : await this.taskSummary(access,true,signal))}catch(error){return this.taskFailure(error)}
    }
    try{this.taskOf(caller)}catch(error){return this.taskFailure(error)}
    if (view === 'bjrsj_import') {
      const held=this.leaseOf(caller)
      if(!held.ok)return Promise.resolve(held)
      if(!this.importFiles.current(held.value))return Promise.resolve(failure('invalid_request','prepare a scoped file in the panel before observing import evidence'))
      return this.dispatch(caller,{kind:'observe',maxChars:this.config.observeMaxChars,maxNodes:this.config.observeMaxNodes,view,...this.importMetadata(held.value)},signal)
    }
    return this.dispatch(caller, {
      kind: 'observe', maxChars: this.config.observeMaxChars, maxNodes: this.config.observeMaxNodes,
    }, signal)
  }

  /**
   * Locate elements on the authorized page.
   * @param {ResolvedCaller} caller - resolved caller.
   * @param  query - `{ by, value, name? }`.
   * @param {AbortSignal} signal - cancellation.
   * @returns  single match or structured ambiguity.
   */
  async find(caller: ResolvedCaller, query: FindQuery, signal: AbortSignal) {

    const outcome = await this.dispatch(caller, { kind: 'find', query, limit: this.config.findMaxMatches }, signal)
    if (!outcome.ok) return outcome
    const value = outcome.value
    const matches: unknown[] = Array.isArray(value.matches) ? value.matches : []
    if (!matches.every(isRecord)) return failure('internal', 'page find returned malformed matches')
    if (value.ambiguous === true || matches.length > 1) {
      const count = matches.length > 1 ? String(matches.length) : 'multiple'
      return failure('ambiguous_match', `${count} elements match this query; narrow it`, {
        documentToken: value.documentToken,
        matches: matches.map(match => ({
          elementRef: match.elementRef, tag: match.tag, label: match.label, text: match.text,
        })),
      })
    }
    if (matches.length === 0) {
      return failure('not_found', 'no element matches this query', { documentToken: value.documentToken })
    }
    return success({ documentToken: value.documentToken, match: matches[0] })
  }

  /**
   * Dispatch one action on one element.
   * @param {ResolvedCaller} caller - resolved caller.
   * @param  input - action input.
   * @param {AbortSignal} signal - cancellation.
   * @returns  dispatch receipt.
   */
  act(caller: ResolvedCaller,input: ActionInput,signal: AbortSignal): Promise<Result<Record<string, unknown>>> {return this.own(()=>this.actOwned(caller,input,signal))}
  /** @param {ResolvedCaller} caller - live caller. @param  input - validated action. @param {AbortSignal} signal - cancellation. @returns  durable write result, with unknowns latched before returning. */
  async actOwned(caller: ResolvedCaller,input: ActionInput,signal: AbortSignal): Promise<Result<Record<string, unknown>>> {
    const startedAt=this.now()
    let access
    try{access=this.taskOf(caller,true)}catch(error){return this.taskFailure(error)}
    if(input.action==='await_user'){
      if(signal?.aborted)return failure('deadline_exceeded','the task declaration was cancelled')
      try{const waiting=await this.tasks.declareWait(access,input.wait);if(this.ctx.agents?.get(caller.sessionId)!==caller.agent)return failure('agent_mismatch','the Agent was replaced while recording this declaration');return success({wait:waiting})}catch(error){return this.taskFailure(error)}
    }
    try{this.tasks.assertReady(access)}catch(error){return this.taskFailure(error)}
    const held=this.leaseOf(caller)
    if(!held.ok)return held
    const lease=held.value
    const stamp=this.leaseStamp(lease)
    let attempt
    let result
    let dispatchEntered=false
    try{
      this.assertCurrent(caller,access,lease,stamp)
      attempt=await this.tasks.beginAttempt(access,input.action)
      this.assertCurrent(caller,access,lease,stamp)
      if(this.now()-startedAt>=this.config.commandBudgetMs||signal?.aborted)throw new TaskError('deadline_exceeded','the command expired during durable preparation; no page command was delivered')
      const entry=this.importFiles.current(lease)
      let file
      if(input.action==='set_file'){
        if(!entry?.identityVerified||entry.id!==input.fileGrantId)throw new TaskError('not_authorized','a confirmed file and both current identity anchors are required')
        try{file=await this.importFiles.dispatch(lease,input.fileGrantId)}catch{throw new TaskError('not_authorized','file authorization, source or snapshot changed; do not retry implicitly')}
        this.assertCurrent(caller,access,lease,stamp)
      }
      dispatchEntered=true
      const dispatched=await this.dispatch(caller, {
      kind: 'act',
      action: input.action,
      target: { documentToken: input.documentToken, elementRef: input.elementRef },
      ...(held.value.importKind ? this.importMetadata(held.value) : {}),
      ...(file ? {file} : {}),
      ...(input.value === undefined ? {} : { value: input.value }),
      ...(input.checked === undefined ? {} : { checked: input.checked }),
    }, signal,startedAt,attempt)

      if(file&&entry){entry.selectionAttemptId=attempt;entry.selectionAcknowledged=dispatched.ok===true&&dispatched.value?.action==='set_file'&&dispatched.value?.dispatched===true&&dispatched.value?.fileGrantId===entry.id}
      result=dispatched
    }catch(error){result=dispatchEntered ? failure('unknown_outcome','write completion could not be established; do not retry') : this.taskFailure(error)}
    if(attempt){
      try{await this.tasks.receipt(access,attempt,(result && !result.ok && result.error.code==='unknown_outcome')?'unknown_outcome':result?.ok?'executed':'not_executed',input.action==='set_file'?{fileGrantId:input.fileGrantId}:{})}catch(error){return this.taskFailure(error)}
    }
    return result
  }

  /** @param  lease - exact live lease; the control store owns its dynamic metadata. @returns {object} fixed scope and lifetime for the Client. */
  importMetadata(lease: ControlLease) {
    return {importScope:{kind:lease.importKind},importOwner:JSON.stringify([lease.task,lease.id,lease.epoch,lease.connectionInstanceId,lease.connectionGeneration]),windowMs:this.config.importWindowMs}
  }

  /** @param {ResolvedCaller} caller - original caller. @param  lease - exact lease. @param  value - wire value validated below. @returns {Promise<object>} safe domain judgment; raw evidence stays private. */
  async importObservation(caller: ResolvedCaller,lease: ControlLease,value: Record<string, unknown>) {
    const entry=this.importFiles.current(lease)
    if(!entry||this.ctx.agents?.get(caller.sessionId)!==caller.agent)return failure('revoked','import binding changed during observation')
    try {
      this.importFiles.assertLive(entry,lease)
      if(value?.documentToken!==lease.documentToken)throw new Error('document-mismatch')
      const evidence=decodeImportEvidence(value.privateImport)
      const anchors={unitIds:new Set<string>(),legalIdentities:new Set<string>()}
      for(const body of evidence.unitBodies){const actual=extractIdentity(JSON.parse(body));for(const id of actual.unitIds)anchors.unitIds.add(id);for(const id of actual.legalIdentities)anchors.legalIdentities.add(id)}
      const identity=judgeIdentity({unitIds:[...anchors.unitIds],legalIdentities:[...anchors.legalIdentities]},entry.scope)
      entry.identityVerified=identity==='verified'&&evidence.coverage&&!evidence.closed&&evidence.unitPending===0
      const judged=entry.state==='consumed'&&entry.selectionAcknowledged&&evidence.fileGrantId===entry.id&&evidence.coverage
        ? judgeImport(entry.scope,entry.input.people,evidence.facts)
        : {verdict:'not_dispatched',reason:'selection-not-proven',serverAcceptance:'unknown',rowValidation:'unknown',importBatch:'unknown'}
      const qualified=judged.verdict==='import_confirmed'&&identity==='verified'&&evidence.unitPending===0&&evidence.closed&&!evidence.cleanupFailed
      const result={...judged,...(judged.verdict==='import_confirmed'&&!qualified?{verdict:'unknown',reason:'identity-or-cleanup-unconfirmed',businessJudgment:judged}:{}),identity,cleanupStatus:evidence.cleanupFailed?'failed':evidence.closed?'complete':'pending',evidenceStatus:'recorded',qualified}
      await this.importFiles.write(entry,'observation-'+randomUUID()+'.json',{evidence,result})
      this.importFiles.assertLive(entry,lease)
      if(this.ctx.agents?.get(caller.sessionId)!==caller.agent)return failure('revoked','import binding changed during observation')
      const access=this.taskOf(caller)
      if(!lease.task||!sameRunScope(access.run,lease.task))throw new TaskError('revoked','import task/run changed')
      const resultRef=await this.tasks.asset(access,'import_result',{...result},'code_verified')
      if(entry.assetRef)await this.tasks.relate(access,resultRef,entry.assetRef,'validated_by')
      if(result.qualified){
        const proofRef=await this.tasks.proof(access,{schemaVersion:1,kind:'import',run:access.run,scope:entry.scope,documentToken:lease.documentToken,fileRef:entry.assetRef,resultRef,fileGrantId:entry.id,attemptId:entry.selectionAttemptId,evidence,files:[await this.tasks.artifact(access,entry.snapshot,'snapshot'),await this.tasks.artifact(access,join(entry.runDir,'dispatch.json'),'dispatch')]})
        if(entry.selectionAttemptId)await this.tasks.relate(access,entry.selectionAttemptId,resultRef,'yields')
        await this.tasks.relate(access,proofRef,resultRef,'derived_from')
        if(await this.tasks.verdict(access,{verdict:result.verdict,qualified:true},proofRef)!=='import_confirmed'){result.verdict='unknown';result.qualified=false;result.reason='task-evidence-unverified'}
      }else await this.tasks.append(access,'business_verdict',{verdict:result.verdict,qualified:false,source:'code_verified',run:access.run,resultRef})
      this.importFiles.assertLive(entry,lease)
      return success({documentToken:lease.documentToken,import:result})
    } catch {return failure('invalid_request','private import evidence could not be validated or recorded')}
  }

  /**
   * Wait for one listed condition.
   * @param {ResolvedCaller} caller - resolved caller.
   * @param {object} input - wait input.
   * @param {AbortSignal} signal - cancellation.
   * @returns  wait result.
   */
  wait(caller: ResolvedCaller, input: WaitInput, signal: AbortSignal) {

    const fields = input
    return this.own(async()=>{
      try{const access=this.taskOf(caller);const data=this.tasks.openTask(access);if(!data.unhealthy&&this.tasks.writable)await this.tasks.append(access,'waiting',{condition:fields.condition,source:'host',run:access.run})}catch(error){return this.taskFailure(error)}
      return this.dispatch(caller, {
      kind: 'wait',
      condition: fields.condition,
      target: { documentToken: fields.documentToken, elementRef: fields.elementRef },
      timeoutMs: fields.timeoutMs,
      ...(fields.text === undefined ? {} : { text: fields.text }),
    }, signal)
    })
  }

  /**
   * Detach this caller's control. The page is untouched.
   * @param {ResolvedCaller} caller - resolved caller.
   * @returns {object} release receipt.
   */
  release(caller: ResolvedCaller) {
    const lease = this.state.leaseFor(caller.agent, caller.agentInstanceToken, caller.sessionId)
    if (lease === undefined) return failure('not_authorized', 'no page is authorized for this Agent')
    const revoked = this.state.revoke({ controlLeaseId: lease.id }, 'released by the Agent')
    this.importFiles.prune()
    if (!revoked.ok) return revoked
    return success({ released: revoked.value.revoked, pageRetained: true })
  }

  /**
   * Register the panel routes and the six tools.
   *
   * The routes are registered through `ctx.inject(['connection'], ...)`, not a
   * synchronous `ctx.get('connection')`: in the real Host composition the
   * connection service mounts after this plugin, and a synchronous read at
   * `apply` time returns `undefined` and silently drops the channel. Injection
   * defers registration until the service exists and withdraws it with it.
   * @returns {void}
   */
  start() : void {
    for (const definition of createTools(this, this.config)) {
      const named =  ((definition) as {
    name: string;
})
      this.tools.set(named.name, definition)
      this.disposers.push( ((this.ctx.tools?.register(definition)) as () => void))
    }
    this.ctx.inject?.(['connection'], scope => this.registerRoutes(scope))
    this.ctx.inject?.(['subprocess'], scope => {
      if(scope.subprocess&&!this.closed){const detach=this.graph.attach(scope.subprocess);scope.effect?.(()=>detach,'browser-flow: graph provider')}
    })
  }

  /**
   * Register the exact `/api/browser-flow/*` routes on the authenticated connection.
   * @param {HostContext} scope - the context carrying the `connection` service.
   * @returns {void}
   */
  registerRoutes(scope: HostContext) : void {
    const connection = scope.connection
    const fetch = connection?.fetch
    if (fetch === undefined || typeof fetch.register !== 'function') {
      scope.logger?.warn?.('browser-flow: the connection service has no fetch registry; the panel channel is unavailable')
      return
    }
    const routes = [
      { path: `${ROUTE_PREFIX}/hello`, method: 'POST', handler: ( request: Request) => this.handleHello(request) },
      { path: `${ROUTE_PREFIX}/poll`, method: 'POST', handler: ( request: Request) => this.handlePoll(request) },
      { path: `${ROUTE_PREFIX}/result`, method: 'POST', handler: ( request: Request) => this.handleResult(request) },
      { path: `${ROUTE_PREFIX}/invalidate`, method: 'POST', handler: ( request: Request) => this.handleInvalidate(request) },
      { path: `${ROUTE_PREFIX}/authorize`, method: 'POST', handler: ( request: Request) => this.handleAuthorize(request) },
      { path: `${ROUTE_PREFIX}/revoke`, method: 'POST', handler: ( request: Request) => this.handleRevoke(request) },
      { path: `${ROUTE_PREFIX}/status`, method: 'GET', handler: ( request: Request) => this.handleStatus(request) },
    ]
    for (const route of routes) {
      const registered = fetch.register({
        path: route.path,
        methods: [route.method],
        requestBody: 'buffered',
        fetch: async request => {
          try {
            if (this.closed) return Response.json(failure('connection_stale', 'the browser control service was unloaded'), { status: 409 })
            return await route.handler(request)
          } catch (error) {
            if(error instanceof TaskError)return Response.json(this.taskFailure(error),{status:409})
            this.ctx.logger?.error?.(`browser-flow: ${route.path} failed: ${error instanceof Error ? error.message : String(error)}`)
            return Response.json(failure('internal', 'the Host could not complete this request'), { status: 500 })
          }
        },
      })
      if (typeof registered === 'function') this.disposers.push(registered)
    }
  }

  /**
   * Read one JSON request body.
   * @param {Request} request - request.
   * @returns {Promise<unknown>} parsed body, or undefined when unparseable.
   */
  async bodyOf(request: Request) : Promise<unknown> {
    try {
      return await request.json()
    } catch {
      return undefined
    }
  }

  /**
   * `POST /hello`: register one panel connection.
   * @param {Request} request - request.
   * @returns {Promise<Response>} verdict.
   */
  async handleHello(request: Request) : Promise<Response> {
    const hello = validateHello(await this.bodyOf(request))
    if (!hello.ok) return Response.json(failure('protocol_violation', hello.reason), { status: 400 })
    const registered = this.state.registerConnection(hello.hello)
    this.importFiles.prune()
    if (!registered.ok) return Response.json(registered, { status: 409 })
    return Response.json(success({
      protocolVersion: PROTOCOL_VERSION,
      generation: registered.value.generation,
      capabilities: {
        observe: true, find: true, act: true, wait: true, release: true,
        screenshot: 'unsupported', crossFrame: 'unsupported', visual: 'unsupported',
      },
      tools: [...this.tools.keys()],
    }))
  }

  /**
   * `POST /poll`: take pending commands and refresh the page list.
   * @param {Request} request - request.
   * @returns {Promise<Response>} commands.
   */
  async handlePoll(request: Request) : Promise<Response> {
    const raw = await this.bodyOf(request)
    if (typeof raw !== 'object' || raw === null) {
      return Response.json(failure('protocol_violation', 'poll body must be an object'), { status: 400 })
    }

    const body = raw as Record<string, unknown>
    if(body.protocolVersion!==PROTOCOL_VERSION)return Response.json(failure('protocol_violation','Host and Client must both reload with protocol v3'),{status:400})
    const { instanceId, connectionGeneration, sessionId, pages } = body
    if (typeof instanceId !== 'string' || typeof sessionId !== 'string' || !(typeof connectionGeneration === 'number' && Number.isSafeInteger(connectionGeneration))) {
      return Response.json(failure('protocol_violation', 'poll requires instanceId, sessionId and connectionGeneration'), { status: 400 })
    }
    const hello = validateHello({
      kind: 'hello', protocolVersion: PROTOCOL_VERSION, connectionGeneration, sessionId,
      panel: { instanceId, pages },
    })
    if (!hello.ok) return Response.json(failure('protocol_violation', hello.reason), { status: 400 })
    const registered = this.state.registerConnection(hello.hello)
    if (!registered.ok) return Response.json(registered, { status: 409 })
    const taken = this.state.takeCommands(instanceId, connectionGeneration, this.config)
    if (!taken.ok) return Response.json(taken, { status: 409 })
    const live = this.ctx.agents?.get(sessionId)
    // The plan requires the panel to show the Session and an instance summary,
    // so the user grants control to a named live Agent rather than to whatever
    // caller arrives next.
    const agent = live === undefined || live === null
      ? null
      : { id: sessionId, instance: instanceDigest(this.tokenOf(live)) }
    this.importFiles.prune()
    const listed=this.state.listPages(instanceId,connectionGeneration)
    const controls=listed.ok?listed.value.pages.filter(( page: { authorized: boolean; controlLeaseId?: string })=>page.authorized).map(( page: { authorized: boolean; controlLeaseId?: string })=>page.controlLeaseId):[]
    const task=this.tasks.current(sessionId)
    return Response.json(success({ task:task ? await this.taskSummary(task) : null,
      definitions:listDefinitions(this.tasks.root).map(item=>({id:item.definition.id,workflows:item.definition.workflows.map(row=>({id:row.id,description:row.description}))})),
      protocolVersion:PROTOCOL_VERSION,commands: taken.value.commands, dropped: taken.value.dropped, agent, controls }))
  }

  /**
   * `POST /result`: settle one dispatched command.
   * @param {Request} request - request.
   * @returns {Promise<Response>} settlement.
   */
  async handleResult(request: Request) : Promise<Response> {
    const result = validateResult(await this.bodyOf(request))
    if (!result.ok) return Response.json(failure('protocol_violation', result.reason), { status: 400 })
    const settled = this.state.settle(result.result, this.config)
    return Response.json(settled, { status: settled.ok ? 200 : 409 })
  }

  /**
   * `POST /invalidate`: report a page lifecycle change.
   * @param {Request} request - request.
   * @returns {Promise<Response>} applied invalidations.
   */
  async handleInvalidate(request: Request) : Promise<Response> {
    const raw = await this.bodyOf(request)
    if (typeof raw !== 'object' || raw === null) {
      return Response.json(failure('protocol_violation', 'invalidate body must be an object'), { status: 400 })
    }

    const body = raw as Record<string, unknown>
    const { instanceId, connectionGeneration, lease, event, documentToken } = body
    if (typeof instanceId !== 'string' || typeof lease !== 'string' || typeof event !== 'string'
      || !(typeof connectionGeneration === 'number' && Number.isSafeInteger(connectionGeneration))) {
      return Response.json(failure('protocol_violation', 'invalidate requires instanceId, connectionGeneration, lease and event'), { status: 400 })
    }
    if (documentToken !== undefined && typeof documentToken !== 'string') {
      return Response.json(failure('protocol_violation', 'documentToken must be a string when present'), { status: 400 })
    }
    const applied = this.state.reportInvalidation(instanceId, connectionGeneration, lease, event, documentToken)
    this.importFiles.prune()
    return Response.json(applied, { status: applied.ok ? 200 : 409 })
  }

  /**
   * `POST /authorize`: the user's explicit authorization of one page.
   *
   * The panel supplies the Session and the page; the Host resolves the live
   * Agent itself and refuses when the Session has no live Agent. The panel
   * never supplies an Agent identity.
   * @param {Request} request - request.
   * @returns {Promise<Response>} authorization receipt.
   */
  async handleAuthorize(request: Request): Promise<Response> {
    const result=await this.own(()=>this.authorizeOwned(request))
    return result instanceof Response ? result : Response.json(result,{status:409})
  }
  /** @param {Request} request - existing authenticated authorize route. @returns {Promise<Response>} owned task/page/file operation. */
  async authorizeOwned(request: Request) : Promise<Response> {
    const raw = await this.bodyOf(request)
    if (typeof raw !== 'object' || raw === null) {
      return Response.json(failure('protocol_violation', 'authorize body must be an object'), { status: 400 })
    }

    const body = raw as Record<string, unknown>
    const { instanceId, connectionGeneration, sessionId, lease, partition, documentToken, tabId } = body
    if(body.protocolVersion!==PROTOCOL_VERSION)return Response.json(failure('protocol_violation','reload Host and Client together with protocol v3'),{status:400})
    if(body.taskOperation!==undefined){
      if(body.fileOperation!==undefined || body.lease!==undefined || typeof sessionId!=='string' || typeof instanceId!=='string' || !(typeof connectionGeneration === 'number' && Number.isSafeInteger(connectionGeneration)))return Response.json(failure('invalid_request','task and page/file authorization are distinct operations'),{status:400})
      const connected=this.state.connectionsFor(sessionId).some(( connection: import('./state.ts').PanelConnection)=>connection.instanceId===instanceId&&connection.generation===connectionGeneration)
      if(!connected)return Response.json(failure('connection_stale','task operation requires the current authenticated panel connection'),{status:409})
      // Permission withdrawal precedes disk access, including when the task scope is stale.
      if(typeof body.taskOperation==='string'&&['revise','cancel','finish'].includes(body.taskOperation)){this.state.revoke({sessionId},'task scope or lifecycle changed');this.importFiles.prune()}
      try {
        const access=body.taskOperation==='create' ? await this.tasks.create(sessionId,body.spec) : await this.tasks.forSession(sessionId,body.task)
        let current=access
        if(body.taskOperation==='revise')current=await this.tasks.revise(access,body.spec)
        else if(body.taskOperation==='cancel'||body.taskOperation==='finish'){await this.tasks.end(access,body.taskOperation==='cancel'?'cancelled':'handed_off');if(this.tasks.openTask(access).readOnly)return Response.json(success({...await this.taskSummary(access),handoff:'read_only',historicalLifecycleUnchanged:true}))}
        else if(body.taskOperation==='resume')await this.tasks.resumeWait(access,body.waitId,body.userInput,(kind,inputRef)=>{const agent=this.ctx.agents?.get(sessionId);if(!agent)return false;const held=this.state.leaseFor(agent,this.tokenOf(agent),sessionId);if(!held||held.state!=='active'||!held.task||!sameRunScope(held.task,access.run))return false;if(kind==='page_authorization')return this.leaseStamp(held)===inputRef;const entry=this.importFiles.current(held);return !!entry&&entry.id===inputRef&&(kind!=='file_confirmation'||entry.state==='confirmed')})
        else if(typeof body.taskOperation!=='string'||!['create','open'].includes(body.taskOperation))throw new TaskError('invalid_request','unsupported task operation')
        return Response.json(success(await this.taskSummary(current)))
      }catch(error){return Response.json(this.taskFailure(error),{status:409})}
    }

    if (typeof instanceId !== 'string' || typeof sessionId !== 'string' || typeof lease !== 'string'
      || typeof partition !== 'string' || typeof documentToken !== 'string' || !(typeof connectionGeneration === 'number' && Number.isSafeInteger(connectionGeneration))) {
      return Response.json(failure('invalid_request', 'authorize requires instanceId, connectionGeneration, sessionId, lease, partition and documentToken'), { status: 400 })
    }
    const agent = this.ctx.agents?.get(sessionId)
    if (agent === undefined) {
      return Response.json(failure('no_live_agent', 'this Session has no live Agent; start the Session\'s Agent, then authorize'), { status: 409 })
    }
    const access=await this.tasks.forSession(sessionId,body.task)
    this.tasks.openTask(access,body.fileOperation!==undefined)
    if(body.fileOperation!==undefined){
      const held=this.state.leaseFor(agent,this.tokenOf(agent),sessionId)
      if(!held||held.connectionInstanceId!==instanceId||held.connectionGeneration!==connectionGeneration||held.lease!==lease||held.partition!==partition||held.documentToken!==documentToken)return Response.json(failure('not_authorized','the current page must be explicitly authorized first'),{status:409})
      if(!held.task||!sameRunScope(held.task,access.run)||(this.tasks.openTask(access).manifest.adapter!=='bjrsj'||this.tasks.openTask(access).manifest.workflowRef!=='import'))return Response.json(failure('task_scope_mismatch','file preparation requires the current Beijing task/run'),{status:409})
      try {
        if(body.fileOperation==='prepare'){
          const scope=importScope(body.scope)
          held.importKind=scope.kind
          const stamp=this.leaseStamp(held)
          const attempt=await this.tasks.beginAttempt(access,'prepare_file')
          let preview
          try{this.assertCurrent({agent,sessionId,agentInstanceToken:this.tokenOf(agent)},access,held,stamp);preview=await this.importFiles.prepare(held,body.path,scope);this.assertCurrent({agent,sessionId,agentInstanceToken:this.tokenOf(agent)},access,held,stamp)}finally{await this.tasks.receipt(access,attempt,'not_dispatched')}
          this.assertCurrent({agent,sessionId,agentInstanceToken:this.tokenOf(agent)},access,held,stamp)
          if(this.ctx.agents?.get(sessionId)!==agent){this.state.retireLeasesOfReplacedAgents(sessionId,this.ctx.agents?.get(sessionId)??{});this.importFiles.prune();throw new Error('agent-replaced')}
          const entry=this.importFiles.current(held)
          if(entry){entry.assetRef=await this.tasks.asset(access,'file',{sha256:entry.sha256,bytes:entry.bytes.length,rows:entry.input.people.length,kind:entry.scope.kind},'code_verified');await this.tasks.noteWaitInput(access,'file_input',entry.id)}
          this.assertCurrent({agent,sessionId,agentInstanceToken:this.tokenOf(agent)},access,held,stamp)
          return Response.json(success(preview))
        }
        if(body.fileOperation==='confirm'&&typeof body.fileGrantId==='string'){
          const stamp=this.leaseStamp(held)
          const attempt=await this.tasks.beginAttempt(access,'confirm_file')
          try{this.assertCurrent({agent,sessionId,agentInstanceToken:this.tokenOf(agent)},access,held,stamp);this.importFiles.confirm(held,body.fileGrantId)}finally{await this.tasks.receipt(access,attempt,'not_dispatched')}
          this.assertCurrent({agent,sessionId,agentInstanceToken:this.tokenOf(agent)},access,held,stamp)
          await this.tasks.noteWaitInput(access,'file_confirmation',body.fileGrantId)
          return Response.json(success({confirmed:true,fileGrantId:body.fileGrantId,boundary:'import_confirmed'}))
        }
        throw new Error('file-operation-invalid')
      } catch(error){if(error instanceof TaskError)return Response.json(this.taskFailure(error),{status:409});const reason=error instanceof Error&&/^[a-z][a-z0-9-]{0,100}$/.test(error.message)?error.message:'file-preparation-failed';return Response.json(failure('invalid_request',reason),{status:409})}
    }
    // A replaced Agent object can never use its leases again, so retire them
    // first: otherwise they occupy the page and refuse the re-authorization the
    // plan requires.
    const page=this.state.connectionsFor(sessionId).find(( connection: import('./state.ts').PanelConnection)=>connection.instanceId===instanceId&&connection.generation===connectionGeneration)?.pages.find(( page: import('./state.ts').PanelPage)=>page.lease===lease&&page.partition===partition&&page.documentToken===documentToken)
    if(!page)return Response.json(failure('page_unavailable','the reported page is no longer current'),{status:409})
    const taskData=this.tasks.openTask(access)
    if(taskData.state!=='active')throw new TaskError('task_write_blocked','the task is ended; only read its task view, revoke and hand off')
    this.tasks.assertPage(access,page.url)
    this.state.retireLeasesOfReplacedAgents(sessionId, agent)
    const authorized = this.state.authorize({
      task:access.run,
      sessionId,
      agentInstanceToken: this.tokenOf(agent),
      agent,
      connectionInstanceId: instanceId,
      connectionGeneration,
      lease,
      partition,
      documentToken,
      ...(typeof tabId === 'string' ? { tabId } : {}),
    })
    this.importFiles.prune()
    if(authorized.ok){const selected=this.state.leaseFor(agent,this.tokenOf(agent),sessionId);if(selected){delete selected.importKind;selected.evidenceRoot=join(this.tasks.openTask(access).dir,'evidence',access.run.runId);await this.tasks.noteWaitInput(access,'page_authorization',this.leaseStamp(selected))}}
    return Response.json(authorized.ok ? success({...authorized.value,task:access.run,origins:taskData.manifest.origins,...(pagePolicy(taskData.manifest)?{pagePolicy:pagePolicy(taskData.manifest)}:{})}) : authorized, { status: authorized.ok ? 200 : 409 })
  }

  /**
   * `POST /revoke`: the user's explicit revocation.
   * @param {Request} request - request.
   * @returns {Promise<Response>} revocation receipt.
   */
  async handleRevoke(request: Request) : Promise<Response> {
    const raw = await this.bodyOf(request)
    if (typeof raw !== 'object' || raw === null) {
      return Response.json(failure('protocol_violation', 'revoke body must be an object'), { status: 400 })
    }

    const body = raw as Record<string, unknown>
    const controlLeaseId = typeof body.controlLeaseId === 'string' ? body.controlLeaseId : undefined
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
    if (controlLeaseId === undefined && sessionId === undefined) {
      return Response.json(failure('invalid_request', 'revoke requires controlLeaseId or sessionId'), { status: 400 })
    }
    const revoked = this.state.revoke(
      { ...(controlLeaseId === undefined ? {} : { controlLeaseId }), ...(sessionId === undefined ? {} : { sessionId }) },
      'revoked by the user',
    )
    this.importFiles.prune()
    return Response.json(revoked, { status: revoked.ok ? 200 : 409 })
  }

  /**
   * `GET /status`: page and authorization state for the panel.
   * @param {Request} request - request.
   * @returns {Promise<Response>} status.
   */
  async handleStatus(request: Request) : Promise<Response> {
    const url = new URL(request.url)
    const instanceId = url.searchParams.get('instanceId')
    const generation = Number(url.searchParams.get('connectionGeneration'))
    const sessionId = url.searchParams.get('sessionId')
    if (instanceId === null || !Number.isSafeInteger(generation) || sessionId === null) {
      return Response.json(failure('invalid_request', 'status requires instanceId, connectionGeneration and sessionId'), { status: 400 })
    }
    const listed = this.state.listPages(instanceId, generation)
    const agent = this.ctx.agents?.get(sessionId)
    return Response.json(success({
      liveAgent: agent !== undefined,
      ...(listed.ok ? listed.value : { pages: [] }),
    }))
  }

  /**
   * Expire abandoned panel connections so a closed panel cannot hold a lease.
   * @returns {void}
   */
  startIdleSweep() : void {
    const interval = Math.max(1_000, Math.floor(this.config.connectionIdleMs / 4))

    const timer = setInterval(() => {
      if (this.closed) return
      this.state.expireIdleConnections(this.config.connectionIdleMs)
      this.importFiles.prune()
    }, interval)
    timer.unref?.()
    this.idleTimer = () => {
      clearInterval(timer)
      return Promise.resolve()
    }
  }

  /**
   * Release everything this plugin acquired.
   * @returns {Promise<void>} completion.
   */
  close() : Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closed = true
    this.closing = (async () => {
      this.state.close()
      const graphClosed=this.graph.close().then(()=>true,()=>false)
      const filesClosed=this.importFiles.close()
      await Promise.allSettled([...this.pending])
      await filesClosed
      await this.tasks.close()
      const graphClean=await graphClosed
      for (const dispose of [...this.disposers].reverse()) {
        try {
          await dispose()
        } catch (error) {
          this.ctx.logger?.error?.(`browser-flow: cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      this.disposers.length = 0
      await this.idleTimer?.()
      if(!graphClean)throw new Error('browser-flow: graph cleanup failed')
    })()
    return this.closing
  }
}

/**
 * Plugin entry: validate config, create the service, register tools and routes.
 * @param {object} ctx - Host plugin context.
 * @param {unknown} config - raw plugin config.
 * @returns {Promise<void>} after registration.
 */
export async function apply( ctx: HostContext,  config: unknown) : Promise<void> {
  const resolved = resolveConfig(config)
  const service = new BrowserFlowService(ctx, resolved)
  service.start()
  service.startIdleSweep()
  ctx.effect?.(() => async () => { await service.close() }, 'browser-flow: service')
  ctx.inject?.(['skills'], scope => {
    if (scope.skills !== undefined) {
      const definitions = listDefinitions(tasksRoot(resolved.localTasksDir, (ctx.get ? ctx.get('profileContext', false) : ctx.profileContext)), id => ctx.logger?.warn?.(`browser-flow: unavailable local definition ${id}`))
      for (const definition of definitions) for (const skill of definitionSkills(definition)) scope.skills.register(skill)
    }
  })
  ctx.logger?.info?.('browser-flow: ready (authorization is explicit per page; screenshots and cross-frame access are unsupported)')
}

export { monotonicNow }
