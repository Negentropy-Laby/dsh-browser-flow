/**
 * Plugin entry: validate config, create the service, register tools and routes.
 * @param {object} ctx - Host plugin context.
 * @param {unknown} config - raw plugin config.
 * @returns {Promise<void>} after registration.
 */
export function apply(ctx: HostContext, config: unknown): Promise<void>;
export const name: "browser-flow";
/** Required Host services: tool registration and the Agent registry. */
export const inject: string[];
/**
 * A resolved caller: the exact live Agent plus its plugin-minted token.
 * @typedef {object} ResolvedCaller
 * @property {LiveAgent} agent - the exact live Agent object.
 * @property {string} sessionId - its Session.
 * @property {string} agentInstanceToken - its plugin-minted token.
 */
/**
 * The control-state store this service adapts.
 *
 * Declared structurally so the service can be tested with a stand-in and stays
 * independent of the state module's internals.
 * @typedef {object} ControlStore
 * @property {() => void} close - end calls and discard every binding.
 * @property {(hello: object) => any} registerConnection - register a panel connection.
 * @property {(sessionId: string) => any[]} connectionsFor - connections of one Session.
 * @property {(idleMs: number) => string[]} expireIdleConnections - drop idle connections.
 * @property {(input: object) => any} authorize - bind an authorization.
 * @property {(agent: LiveAgent, token: string, sessionId: string) => any} leaseFor - resolve a caller's lease.
 * @property {(sessionId: string) => number} leaseCountForSession - active leases of one Session, whoever holds them.
 * @property {(sessionId: string, liveAgent: object) => string[]} retireLeasesOfReplacedAgents - retire leases a replaced Agent holds.
 * @property {(instanceId: string, generation: number) => any} listPages - pages visible to one connection.
 * @property {(instanceId: string, generation: number, guestLease: string, event: string, documentToken?: string) => any} reportInvalidation - apply a page event.
 * @property {(input: object, reason: string) => any} revoke - detach control.
 * @property {(lease: any, op: object, limits: object, signal?: AbortSignal) => Promise<any>} run - enqueue an operation.
 * @property {(limits: object) => void} pumpAll - dispatch what the leases can take.
 * @property {(instanceId: string, generation: number, limits: object) => any} takeCommands - hand commands to a panel.
 * @property {(result: object, limits: object) => any} settle - accept a result.
 * @property {(leaseId: string) => any} describeLease - describe one lease.
 * @property {() => number} connectionCount - live connections.
 * @property {() => number} leaseCount - leases.
 */
/** The Host service: control state plus the panel channel. */
export class BrowserFlowService {
    /**
     * @param {HostContext} ctx - Host plugin context.
     * @param {import('./config.js').BrowserFlowConfig} config - resolved config.
     * @param {GraphWorkers} [graph] - derived graph service; defaults to the packaged helper.
     */
    constructor(ctx: HostContext, config: import("./config.js").BrowserFlowConfig, graph?: GraphWorkers);
    graph: GraphWorkers;
    ctx: HostContext;
    config: import("./config.js").BrowserFlowConfig;
    tasks: TaskStore;
    importFiles: ImportFiles;
    /** @type {WeakMap<object,string>} */ instanceTokens: WeakMap<object, string>;
    now: typeof monotonicNow;
    state: ControlStore;
    /** @type {Map<string, object>} */
    tools: Map<string, object>;
    /** @type {(() => void | Promise<void>)[]} */
    disposers: (() => void | Promise<void>)[];
    /** @type {(() => Promise<void>) | undefined} */
    idleTimer: (() => Promise<void>) | undefined;
    closed: boolean;
    /** @type {Set<Promise<object>>} */
    pending: Set<Promise<object>>;
    /** @type {Promise<void> | undefined} */
    closing: Promise<void> | undefined;
    /** @param {() => Promise<object>} operation - admitted operation including its final durable record. @returns {Promise<any>} terminal result; shutdown drains it before storage closes. */
    own(operation: () => Promise<object>): Promise<any>;
    /** @param {any} lease - live lease. @returns {string} immutable comparison for every asynchronous resumption. */
    leaseStamp(lease: any): string;
    /** @param {ResolvedCaller} caller - original Agent. @param {import('./task-store.js').TaskAccess} access - original task/run. @param {any} lease - original lease. @param {string} stamp - captured binding. @param {boolean} [write] - enforce task write admission. @returns {void} no changed authorization is allowed to reach a guest. */
    assertCurrent(caller: ResolvedCaller, access: import("./task-store.js").TaskAccess, lease: any, stamp: string, write?: boolean): void;
    /**
     * Token for one live Agent object, minted on first sight.
     * @param {object} agent - live Agent object.
     * @returns {string} opaque token; never persisted.
     */
    tokenOf(agent: object): string;
    /**
     * Resolve the caller of one tool invocation to its exact live Agent.
     *
     * The registered object must be the calling object and the Session must
     * match; comparing Session ids alone is not enough (E06).
     * @param {ToolExec} exec - tool execution context.
     * @returns {any} caller verdict.
     */
    resolveCaller(exec: ToolExec): any;
    /** @param {ResolvedCaller} caller - exact live caller. @param {boolean} [write] - page mutation or file grant. @returns {import('./task-store.js').TaskAccess} current task capability. */
    taskOf(caller: ResolvedCaller, write?: boolean): import("./task-store.js").TaskAccess;
    /** @param {unknown} error - expected task failure or unexpected defect. @returns {ReturnType<typeof failure>} sanitized failure. */
    taskFailure(error: unknown): ReturnType<typeof failure>;
    /** @param {import('./task-store.js').TaskAccess} access - verified task. @param {boolean} [withGraph] - explicitly request derived graph computation. @param {AbortSignal} [signal] - caller cancellation. @returns {Promise<object>} logged task summary. */
    taskSummary(access: import("./task-store.js").TaskAccess, withGraph?: boolean, signal?: AbortSignal): Promise<object>;
    /** @param {ResolvedCaller} caller - tool caller. @param {any} result - owned canonical result. @returns {any} task identity/state attached without reading any other task. */
    annotate(caller: ResolvedCaller, result: any): any;
    /**
     * Resolve the control lease of one caller.
     * @param {ResolvedCaller} caller - resolved caller.
     * @returns {any} lease verdict.
     */
    leaseOf(caller: ResolvedCaller): any;
    /**
     * List the pages this caller could be authorized for.
     * @param {ResolvedCaller} caller - resolved caller.
     * @returns {any} page list.
     */
    listTabs(caller: ResolvedCaller): any;
    /**
     * Dispatch one page operation through the caller's lease.
     * @param {ResolvedCaller} caller - resolved caller.
     * @param {any} op - validated operation payload.
     * @param {AbortSignal} signal - caller cancellation.
     * @param {number} [startedAt] - original Host monotonic admission time, before durable/file work.
     * @param {string} [writeAttemptId] - internal task-owned durable attempt required for writes.
     * @returns {Promise<any>} validated dynamic page result or structured refusal.
     */
    dispatch(caller: ResolvedCaller, op: any, signal: AbortSignal, startedAt?: number, writeAttemptId?: string): Promise<any>;
    /**
     * Redact URLs inside one page result before it reaches a model.
     * @param {any} value - page result.
     * @returns {any} redacted copy.
     */
    redactResult(value: any): any;
    /**
     * Observe the authorized page.
     * @param {ResolvedCaller} caller - resolved caller.
     * @param {AbortSignal} signal - cancellation.
     * @param {string} [view] - page, scoped import evidence or task.
     * @param {{ref:string,offset:number}} [detail] - task detail only.
     * @returns {Promise<any>} observation.
     */
    observe(caller: ResolvedCaller, signal: AbortSignal, view?: string, detail?: {
        ref: string;
        offset: number;
    }): Promise<any>;
    /** @param {ResolvedCaller} caller - actual caller. @param {AbortSignal} signal - cancellation. @param {string} [view] - fixed view. @param {{ref:string,offset:number}} [detail] - task-local continuation. @returns {Promise<any>} owned observation. */
    observeOwned(caller: ResolvedCaller, signal: AbortSignal, view?: string, detail?: {
        ref: string;
        offset: number;
    }): Promise<any>;
    /**
     * Locate elements on the authorized page.
     * @param {ResolvedCaller} caller - resolved caller.
     * @param {any} query - `{ by, value, name? }`.
     * @param {AbortSignal} signal - cancellation.
     * @returns {Promise<any>} single match or structured ambiguity.
     */
    find(caller: ResolvedCaller, query: any, signal: AbortSignal): Promise<any>;
    /**
     * Dispatch one action on one element.
     * @param {ResolvedCaller} caller - resolved caller.
     * @param {any} input - action input.
     * @param {AbortSignal} signal - cancellation.
     * @returns {Promise<any>} dispatch receipt.
     */
    act(caller: ResolvedCaller, input: any, signal: AbortSignal): Promise<any>;
    /** @param {ResolvedCaller} caller - live caller. @param {any} input - validated action. @param {AbortSignal} signal - cancellation. @returns {Promise<any>} durable write result, with unknowns latched before returning. */
    actOwned(caller: ResolvedCaller, input: any, signal: AbortSignal): Promise<any>;
    /** @param {any} lease - exact live lease; the control store owns its dynamic metadata. @returns {object} fixed scope and lifetime for the Client. */
    importMetadata(lease: any): object;
    /** @param {ResolvedCaller} caller - original caller. @param {any} lease - exact lease. @param {any} value - wire value validated below. @returns {Promise<object>} safe domain judgment; raw evidence stays private. */
    importObservation(caller: ResolvedCaller, lease: any, value: any): Promise<object>;
    /**
     * Wait for one listed condition.
     * @param {ResolvedCaller} caller - resolved caller.
     * @param {object} input - wait input.
     * @param {AbortSignal} signal - cancellation.
     * @returns {Promise<any>} wait result.
     */
    wait(caller: ResolvedCaller, input: object, signal: AbortSignal): Promise<any>;
    /**
     * Detach this caller's control. The page is untouched.
     * @param {ResolvedCaller} caller - resolved caller.
     * @returns {object} release receipt.
     */
    release(caller: ResolvedCaller): object;
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
    start(): void;
    /**
     * Register the exact `/api/browser-flow/*` routes on the authenticated connection.
     * @param {HostContext} scope - the context carrying the `connection` service.
     * @returns {void}
     */
    registerRoutes(scope: HostContext): void;
    /**
     * Read one JSON request body.
     * @param {Request} request - request.
     * @returns {Promise<unknown>} parsed body, or undefined when unparseable.
     */
    bodyOf(request: Request): Promise<unknown>;
    /**
     * `POST /hello`: register one panel connection.
     * @param {Request} request - request.
     * @returns {Promise<Response>} verdict.
     */
    handleHello(request: Request): Promise<Response>;
    /**
     * `POST /poll`: take pending commands and refresh the page list.
     * @param {Request} request - request.
     * @returns {Promise<Response>} commands.
     */
    handlePoll(request: Request): Promise<Response>;
    /**
     * `POST /result`: settle one dispatched command.
     * @param {Request} request - request.
     * @returns {Promise<Response>} settlement.
     */
    handleResult(request: Request): Promise<Response>;
    /**
     * `POST /invalidate`: report a page lifecycle change.
     * @param {Request} request - request.
     * @returns {Promise<Response>} applied invalidations.
     */
    handleInvalidate(request: Request): Promise<Response>;
    /**
     * `POST /authorize`: the user's explicit authorization of one page.
     *
     * The panel supplies the Session and the page; the Host resolves the live
     * Agent itself and refuses when the Session has no live Agent. The panel
     * never supplies an Agent identity.
     * @param {Request} request - request.
     * @returns {Promise<Response>} authorization receipt.
     */
    handleAuthorize(request: Request): Promise<Response>;
    /** @param {Request} request - existing authenticated authorize route. @returns {Promise<Response>} owned task/page/file operation. */
    authorizeOwned(request: Request): Promise<Response>;
    /**
     * `POST /revoke`: the user's explicit revocation.
     * @param {Request} request - request.
     * @returns {Promise<Response>} revocation receipt.
     */
    handleRevoke(request: Request): Promise<Response>;
    /**
     * `GET /status`: page and authorization state for the panel.
     * @param {Request} request - request.
     * @returns {Promise<Response>} status.
     */
    handleStatus(request: Request): Promise<Response>;
    /**
     * Expire abandoned panel connections so a closed panel cannot hold a lease.
     * @returns {void}
     */
    startIdleSweep(): void;
    /**
     * Release everything this plugin acquired.
     * @returns {Promise<void>} completion.
     */
    close(): Promise<void>;
}
/**
 * The live Agent object the Host hands to a tool call.
 */
export type LiveAgent = {
    /**
     * - Session identity.
     */
    id: string;
};
/**
 * One tool call's execution context, as the Host supplies it.
 */
export type ToolExec = {
    /**
     * - the live Agent making the call.
     */
    agent?: LiveAgent | undefined;
    /**
     * - caller cancellation.
     */
    signal: AbortSignal;
};
/**
 * One exact Fetch route, as the authenticated connection accepts it.
 */
export type FetchRoute = {
    /**
     * - exact pathname.
     */
    path: string;
    /**
     * - accepted methods.
     */
    methods: string[];
    /**
     * - body handling.
     */
    requestBody?: "buffered" | undefined;
    /**
     * - handler.
     */
    fetch: (request: Request) => Promise<Response>;
};
/**
 * The Host services this plugin reads off its context.
 *
 * Declared structurally so the plugin stays a plain Cordis plugin: it needs no
 * import from the Host to be typechecked.
 */
export type HostContext = {
    /**
     * - optional launcher context lookup.
     */
    get?: ((name: string, strict: boolean) => import("./task-definitions.js").Profile | undefined) | undefined;
    /**
     * - actual dsh profile identity and home.
     */
    profileContext?: import("./task-definitions.js").Profile | undefined;
    /**
     * - tool registry.
     */
    tools?: {
        register: (definition: object) => () => void;
    } | undefined;
    /**
     * - Agent registry.
     */
    agents?: {
        get: (id: string) => LiveAgent | undefined;
    } | undefined;
    /**
     * - Optional existing skill registry; its registrations are Cordis effects.
     */
    skills?: {
        register: (skill: import("./task-definitions.js").LocalSkill) => () => void;
    } | undefined;
    /**
     * - optional managed process provider.
     */
    subprocess?: import("./graph/protocol.ts").SubprocessPort | undefined;
    /**
     * - authenticated connection.
     */
    connection?: {
        fetch: {
            register: (route: FetchRoute) => () => void;
        };
    } | undefined;
    /**
     * - deferred injection.
     */
    inject?: ((dependencies: string[], callback: (scope: HostContext) => void) => void) | undefined;
    /**
     * - effect-scoped registration.
     */
    effect?: ((callback: () => (() => void | Promise<void>), label?: string) => void) | undefined;
    /**
     * - Host logger.
     */
    logger?: {
        info: (message: string) => void;
        warn: (message: string) => void;
        error: (message: string) => void;
    } | undefined;
};
/**
 * A resolved caller: the exact live Agent plus its plugin-minted token.
 */
export type ResolvedCaller = {
    /**
     * - the exact live Agent object.
     */
    agent: LiveAgent;
    /**
     * - its Session.
     */
    sessionId: string;
    /**
     * - its plugin-minted token.
     */
    agentInstanceToken: string;
};
/**
 * The control-state store this service adapts.
 *
 * Declared structurally so the service can be tested with a stand-in and stays
 * independent of the state module's internals.
 */
export type ControlStore = {
    /**
     * - end calls and discard every binding.
     */
    close: () => void;
    /**
     * - register a panel connection.
     */
    registerConnection: (hello: object) => any;
    /**
     * - connections of one Session.
     */
    connectionsFor: (sessionId: string) => any[];
    /**
     * - drop idle connections.
     */
    expireIdleConnections: (idleMs: number) => string[];
    /**
     * - bind an authorization.
     */
    authorize: (input: object) => any;
    /**
     * - resolve a caller's lease.
     */
    leaseFor: (agent: LiveAgent, token: string, sessionId: string) => any;
    /**
     * - active leases of one Session, whoever holds them.
     */
    leaseCountForSession: (sessionId: string) => number;
    /**
     * - retire leases a replaced Agent holds.
     */
    retireLeasesOfReplacedAgents: (sessionId: string, liveAgent: object) => string[];
    /**
     * - pages visible to one connection.
     */
    listPages: (instanceId: string, generation: number) => any;
    /**
     * - apply a page event.
     */
    reportInvalidation: (instanceId: string, generation: number, guestLease: string, event: string, documentToken?: string) => any;
    /**
     * - detach control.
     */
    revoke: (input: object, reason: string) => any;
    /**
     * - enqueue an operation.
     */
    run: (lease: any, op: object, limits: object, signal?: AbortSignal) => Promise<any>;
    /**
     * - dispatch what the leases can take.
     */
    pumpAll: (limits: object) => void;
    /**
     * - hand commands to a panel.
     */
    takeCommands: (instanceId: string, generation: number, limits: object) => any;
    /**
     * - accept a result.
     */
    settle: (result: object, limits: object) => any;
    /**
     * - describe one lease.
     */
    describeLease: (leaseId: string) => any;
    /**
     * - live connections.
     */
    connectionCount: () => number;
    /**
     * - leases.
     */
    leaseCount: () => number;
};
import { Config } from './config.js';
import { GraphWorkers } from './graph/worker.ts';
import { TaskStore } from './task-store.js';
import { ImportFiles } from './import-files.js';
import { monotonicNow } from './state.js';
import { failure } from './protocol.js';
export { Config, monotonicNow };
