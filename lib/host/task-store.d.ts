/** @typedef {import('./task-scope.js').TaskScope} TaskScope */
/** @typedef {import('./task-scope.js').RunScope} RunScope */
/** @typedef {{ schemaVersion?: number, scope: TaskScope, runId: import('./task-scope.js').RunId, workflowRef: string, goal: string, constraints: string[], criteria: string[], origins: string[], adapter: string, adapterVersion: number, definitionId?: string, definitionDigest?: string, definitionVersion?: string }} Manifest */
/** @typedef {{ schemaVersion?: number, seq: number, prev: string, type: string, data: Record<string, unknown>, hash: string }} TaskEvent */
/** @typedef {{ manifest: Manifest, snapshot?: import('./task-definitions.js').DefinitionSnapshot, events: TaskEvent[], dir: string, blocked: boolean, unhealthy: boolean, state: string, pendingWrite?: string, readOnly?: boolean, storageIssue?: string, checkedProofs?: Map<string,import('./task-criteria.js').CheckedProof>, evidenceIssues?: string[], liveDocumentToken?: string, waiting?: import('./task-wait.js').UserWait, waitInput?: {kind:string,inputRef:string} }} TaskData */
/** @typedef {{ readonly scope: TaskScope, readonly run: RunScope }} TaskAccess */
/** Expected task failures are sanitized at the tool/HTTP boundary. */
export class TaskError extends Error {
    /** @param {string} code - machine identity. @param {string} message - public next step. */
    constructor(code: string, message: string);
    code: string;
}
/** The service owns one writer lease, access capabilities and a serialized append queue. */
export class TaskStore {
    /** @param {string | undefined} root - localTasksDir. @param {import('./task-definitions.js').Profile | undefined} profile - actual dsh profile. @param {number} waitMs - bounded writer acquisition. @param {import('./graph/worker.ts').GraphWorkers|undefined} [graph] - optional derived view service. @param {import('./graph/protocol.ts').GraphConfig} [graphConfig] - resolved limits. */
    constructor(root: string | undefined, profile: import("./task-definitions.js").Profile | undefined, waitMs: number, graph?: import("./graph/worker.ts").GraphWorkers | undefined, graphConfig?: import("./graph/protocol.ts").GraphConfig);
    graph: import("./graph/worker.ts").GraphWorkers | undefined;
    graphConfig: import("./graph/protocol.ts").GraphConfig;
    /** @type {((access:TaskAccess)=>string|undefined)|undefined} */ controlDocument: ((access: TaskAccess) => string | undefined) | undefined;
    root: string | undefined;
    profileId: import("./task-scope.js").ProfileId | undefined;
    runtime: string | undefined;
    waitMs: number;
    /** @type {Map<string, TaskData>} */ tasks: Map<string, TaskData>;
    /** @type {Map<string, string>} */ bindings: Map<string, string>;
    /** @type {WeakMap<TaskAccess, TaskData>} */ handles: WeakMap<TaskAccess, TaskData>;
    /** @type {Promise<void> | undefined} */ ready: Promise<void> | undefined;
    /** @type {Promise<unknown> | undefined} */ writer: Promise<unknown> | undefined;
    /** @type {(() => void) | undefined} */ releaseWriter: (() => void) | undefined;
    abort: AbortController;
    closed: boolean;
    writable: boolean;
    tail: Promise<void>;
    /** @param {string} path - owned descendant. @returns {Promise<void>} private directory after all existing ancestors have passed link checks. */
    directory(path: string): Promise<void>;
    /** @returns {Promise<void>} lazy initialization; failure prevents writes without impairing revocation. */
    initialize(): Promise<void>;
    /** @returns {Promise<void>} writer ready after existing ownership and journals have been read. */
    initializeOwned(): Promise<void>;
    /** @param {string} path - owned new file. @param {unknown} value - complete JSON. @returns {Promise<void>} synced new content. */
    writeNew(path: string, value: unknown): Promise<void>;
    /** @template T @param {() => Promise<T>} operation - serialized mutation. @returns {Promise<T>} operation result. */
    serial<T>(operation: () => Promise<T>): Promise<T>;
    /** @param {string} sessionId - caller's verified Session. @param {unknown} raw - user task declaration. @returns {Promise<TaskAccess>} newly created task, permanently owned by this Session. */
    create(sessionId: string, raw: unknown): Promise<TaskAccess>;
    /** @param {TaskData} data - owned data. @returns {TaskAccess} unforgeable in-process capability. */
    access(data: TaskData): TaskAccess;
    /** @param {string} sessionId - actual caller. @param {unknown} [requested] - optional scope to compare, never an authority source. @returns {Promise<TaskAccess>} verified current ownership. */
    forSession(sessionId: string, requested?: unknown): Promise<TaskAccess>;
    /** @param {string} sessionId - verified Session. @returns {TaskAccess | undefined} current in-memory binding; use forSession to recover after restart. */
    current(sessionId: string): TaskAccess | undefined;
    /** @param {TaskAccess} access - store-issued capability. @param {boolean} [write] - operation can change a page or file authority. @returns {TaskData} private data available only after full verification. */
    openTask(access: TaskAccess, write?: boolean): TaskData;
    /** @param {TaskAccess} access - verified task. @param {string} url - actual page address. @returns {void} allowed source with supported adapter version. */
    assertPage(access: TaskAccess, url: string): void;
    /** @param {TaskData} data - private task. @param {string} type - event category. @param {Record<string,unknown>} payload - bounded event facts. @returns {Promise<TaskEvent>} durable append. */
    appendOwned(data: TaskData, type: string, payload: Record<string, unknown>): Promise<TaskEvent>;
    /** @param {TaskData} data - recovered or live task. @param {TaskEvent} event - validated event. @returns {void} monotonic state projection. */
    reduce(data: TaskData, event: TaskEvent): void;
    /** @param {TaskAccess} access - capability. @param {string} type - event. @param {Record<string,unknown>} payload - facts. @returns {Promise<TaskEvent>} appended event. */
    append(access: TaskAccess, type: string, payload: Record<string, unknown>): Promise<TaskEvent>;
    /** @param {TaskAccess} access - capability. @param {string} action - fixed action kind, never private text. @returns {Promise<string>} durable attempt id before any write-related work. */
    beginAttempt(access: TaskAccess, action: string): Promise<string>;
    /** @param {TaskAccess} access - original run. @param {string} attemptId - original attempt. @param {string} outcome - known result or unknown. @param {{fileGrantId?:string}} [details] - verified file acknowledgement binding. @returns {Promise<void>} durable settlement; unknown is sticky. */
    receipt(access: TaskAccess, attemptId: string, outcome: string, details?: {
        fileGrantId?: string;
    }): Promise<void>;
    /** @param {TaskAccess} access - current owner. @returns {void} page mutations require no outstanding human dependency. */
    assertReady(access: TaskAccess): void;
    /** @param {TaskAccess} access - owner. @param {import('./task-wait.js').UserWaitRequest} request - model declaration. @returns {Promise<import('./task-wait.js').UserWait>} synchronized wait; identical repeats do not append. */
    declareWait(access: TaskAccess, request: import("./task-wait.js").UserWaitRequest): Promise<import("./task-wait.js").UserWait>;
    /** @param {TaskAccess} access - owner. @param {string} kind - actual prerequisite supplied through the panel. @param {string} inputRef - exact current capability or file fingerprint. @returns {Promise<void>} task-owned new input, never an authorization itself. */
    noteWaitInput(access: TaskAccess, kind: string, inputRef: string): Promise<void>;
    /** @param {TaskAccess} access - owner. @param {unknown} waitId - panel reference. @param {unknown} userInput - explicit human input for non-verifiable dependencies. @param {(kind:string,inputRef:string)=>boolean} current - Host rechecks current supplied capabilities. @returns {Promise<void>} records resolution without restoring page control. */
    resumeWait(access: TaskAccess, waitId: unknown, userInput: unknown, current: (kind: string, inputRef: string) => boolean): Promise<void>;
    /** @param {TaskAccess} access - original run. @param {string} state - user task lifecycle request. @returns {Promise<TaskAccess>} status, never a business verdict. */
    end(access: TaskAccess, state: string): Promise<TaskAccess>;
    /** @param {TaskAccess} access - user-owned task. @param {unknown} raw - explicit revised goal/scope or new run. @returns {Promise<TaskAccess>} new revision; unknown write remains blocked. */
    revise(access: TaskAccess, raw: unknown): Promise<TaskAccess>;
    /** @param {TaskAccess} access - capability. @param {number} budget - projection character limit. @param {AbortSignal} [signal] - caller cancellation. @returns {Promise<Record<string,unknown>>} current Host facts and optional derived graph. */
    view(access: TaskAccess, budget: number, signal?: AbortSignal): Promise<Record<string, unknown>>;
    /** @param {TaskAccess} access - owner. @param {Record<string,unknown>} value - private original facts. @returns {Promise<string>} task-local evidence reference. */
    proof(access: TaskAccess, value: Record<string, unknown>): Promise<string>;
    /** @param {TaskAccess} access - owner. @param {string} path - existing private original. @param {string} role - fixed evidence role. @returns {Promise<import('./task-criteria.js').Artifact>} bound artifact without exposing its bytes. */
    artifact(access: TaskAccess, path: string, role: string): Promise<import("./task-criteria.js").Artifact>;
    /** @param {TaskData} data - owner. @param {import('./task-criteria.js').Artifact} ref - relative reference. @param {boolean} [verify] - enforce recorded digest. @returns {Promise<Buffer>} complete bounded bytes. */
    readArtifact(data: TaskData, ref: import("./task-criteria.js").Artifact, verify?: boolean): Promise<Buffer>;
    /** @param {TaskAccess} access - owner. @returns {Promise<void>} recheck recoverable originals before displaying proofs. */
    refreshEvidence(access: TaskAccess): Promise<void>;
    /** @param {TaskAccess} access - owner. @param {Record<string,unknown>} result - trusted validator result. @param {string} proofRef - private original reference. @returns {Promise<string>} independently checked current verdict. */
    verdict(access: TaskAccess, result: Record<string, unknown>, proofRef: string): Promise<string>;
    /** @param {TaskAccess} access - capability. @param {string} kind - code-owned asset kind. @param {Record<string,unknown>} data - safe facts; raw personnel remain in private evidence. @param {'host'|'code_verified'} [source] - factual authority. @returns {Promise<string>} unique task-local reference, never deduplicated by name or content. */
    asset(access: TaskAccess, kind: string, data: Record<string, unknown>, source?: "host" | "code_verified"): Promise<string>;
    /** @param {TaskAccess} access - capability. @param {string} from - existing task asset. @param {string} to - existing task asset. @param {string} relation - fixed relation. @returns {Promise<string>} journaled relation after both ownership checks. */
    relate(access: TaskAccess, from: string, to: string, relation: string): Promise<string>;
    /** @param {TaskAccess} access - capability. @param {string} id - task-local detail. @param {number} offset - bounded text continuation. @param {number} budget - character budget. @returns {Promise<object>} scoped immutable detail or generic refusal. */
    detail(access: TaskAccess, id: string, offset: number, budget: number): Promise<object>;
    /** @returns {Promise<void>} read immutable ownership plus complete validated journal prefixes; no commands or control are restored. */
    recover(): Promise<void>;
    /** @param {TaskData} data - task being recovered. @returns {Promise<void>} valid history prefix, conservatively blocked on truncation/unfinished writes. */
    recoverJournal(data: TaskData): Promise<void>;
    /** @returns {Promise<void>} drain owned writes before releasing the profile writer lease. */
    close(): Promise<void>;
}
export type TaskScope = import("./task-scope.js").TaskScope;
export type RunScope = import("./task-scope.js").RunScope;
export type Manifest = {
    schemaVersion?: number;
    scope: TaskScope;
    runId: import("./task-scope.js").RunId;
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
    snapshot?: import("./task-definitions.js").DefinitionSnapshot;
    events: TaskEvent[];
    dir: string;
    blocked: boolean;
    unhealthy: boolean;
    state: string;
    pendingWrite?: string;
    readOnly?: boolean;
    storageIssue?: string;
    checkedProofs?: Map<string, import("./task-criteria.js").CheckedProof>;
    evidenceIssues?: string[];
    liveDocumentToken?: string;
    waiting?: import("./task-wait.js").UserWait;
    waitInput?: {
        kind: string;
        inputRef: string;
    };
};
export type TaskAccess = {
    readonly scope: TaskScope;
    readonly run: RunScope;
};
