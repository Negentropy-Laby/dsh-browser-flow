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
import { taskView } from './task-projections.ts';
import type { Stats, BigIntStats } from 'node:fs';
/** Expected task failures are sanitized at the tool/HTTP boundary. */
export declare class TaskError extends Error {
    code: string;
    /** @param {string} code - machine identity. @param {string} message - public next step. */
    constructor(code: string, message: string);
}
/** The service owns one writer lease, access capabilities and a serialized append queue. */
export declare class TaskStore {
    graph: import("./graph/worker.ts").GraphWorkers | undefined;
    graphConfig: import("./graph/protocol.ts").GraphConfig;
    controlDocument: ((access: TaskAccess) => string | undefined) | undefined;
    root: string | undefined;
    profileId: import("./task-scope.ts").ProfileId | undefined;
    runtime: string | undefined;
    waitMs: number;
    tasks: Map<string, TaskData>;
    bindings: Map<string, string>;
    private creationFailures;
    private evidenceReads;
    private detailLengths;
    handles: WeakMap<TaskAccess, TaskData>;
    ready: Promise<void> | undefined;
    writer: Promise<unknown> | undefined;
    releaseWriter: (() => void) | undefined;
    abort: AbortController;
    closed: boolean;
    writable: boolean;
    tail: Promise<void>;
    /** @param {string | undefined} root - localTasksDir. @param {import('./task-definitions.ts').Profile | undefined} profile - actual dsh profile. @param {number} waitMs - bounded writer acquisition. @param {import('./graph/worker.ts').GraphWorkers|undefined} [graph] - optional derived view service. @param {import('./graph/protocol.ts').GraphConfig} [graphConfig] - resolved limits. */
    constructor(root: string | undefined, profile: import('./task-definitions.ts').Profile | undefined, waitMs: number, graph?: import('./graph/worker.ts').GraphWorkers | undefined, graphConfig?: import('./graph/protocol.ts').GraphConfig);
    /** @param {string} path - owned descendant. @returns {Promise<void>} private directory after all existing ancestors have passed link checks. */
    directory(path: string): Promise<void>;
    /** @returns {Promise<void>} lazy initialization; failure prevents writes without impairing revocation. */
    initialize(): Promise<void>;
    /** @returns {Promise<void>} writer ready after existing ownership and journals have been read. */
    initializeOwned(): Promise<void>;
    /** @param {string} path - owned new file. @param {unknown} value - complete JSON. @returns {Promise<void>} synced new content. */
    writeNew(path: string, value: unknown): Promise<void>;
    /** @param path - exact Session registry path. @returns Absence only when the private path can be inspected conclusively. */
    registrationState(path: string): Promise<'absent' | 'present' | 'unknown'>;
    /** @param dir - this creation's exclusively allocated leaf. @param identity - identity captured after allocation. @returns Removal only if the original directory is still present without links. */
    removeNewDirectory(dir: string, identity: Stats): Promise<void>;
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
        fileGrantId?: unknown;
    }): Promise<void>;
    /** @param {TaskAccess} access - current owner. @returns {void} page mutations require no outstanding human dependency. */
    assertReady(access: TaskAccess): void;
    /** @param {TaskAccess} access - owner. @param {import('./task-wait.ts').UserWaitRequest} request - model declaration. @returns {Promise<import('./task-wait.ts').UserWait>} synchronized wait; identical repeats do not append. */
    declareWait(access: TaskAccess, request: unknown): Promise<import('./task-wait.ts').UserWait>;
    /** @param {TaskAccess} access - owner. @param {string} kind - actual prerequisite supplied through the panel. @param {string} inputRef - exact current capability or file fingerprint. @returns {Promise<void>} task-owned new input, never an authorization itself. */
    noteWaitInput(access: TaskAccess, kind: string, inputRef: string): Promise<void>;
    /** @param {TaskAccess} access - owner. @param {unknown} waitId - panel reference. @param {unknown} userInput - explicit human input for non-verifiable dependencies. @param {(kind:string,inputRef:string)=>boolean} current - Host rechecks current supplied capabilities. @returns {Promise<void>} records resolution without restoring page control. */
    resumeWait(access: TaskAccess, waitId: unknown, userInput: unknown, current: (kind: string, inputRef: string) => boolean): Promise<void>;
    /** @param {TaskAccess} access - original run. @param {string} state - user task lifecycle request. @returns {Promise<TaskAccess>} status, never a business verdict. */
    end(access: TaskAccess, state: string): Promise<TaskAccess>;
    /** @param {TaskAccess} access - user-owned task. @param {unknown} raw - explicit revised goal/scope or new run. @returns {Promise<TaskAccess>} new revision; unknown write remains blocked. */
    revise(access: TaskAccess, raw: unknown): Promise<TaskAccess>;
    /** @param {TaskAccess} access - capability. @param {number} budget - projection character limit. @param {AbortSignal} [signal] - caller cancellation. @returns {Promise<Record<string,unknown>>} current Host facts and optional derived graph. */
    view(access: TaskAccess, budget: number, signal?: AbortSignal | undefined): Promise<ReturnType<typeof taskView>>;
    /** @param {TaskAccess} access - owner. @param {Record<string,unknown>} value - private original facts. @returns {Promise<string>} task-local evidence reference. */
    proof(access: TaskAccess, value: Record<string, unknown>): Promise<string>;
    /** @param {TaskAccess} access - owner. @param {string} path - existing private original. @param {string} role - fixed evidence role. @returns {Promise<import('./task-criteria.ts').Artifact>} bound artifact without exposing its bytes. */
    artifact(access: TaskAccess, path: string, role: string): Promise<import('./task-criteria.ts').Artifact>;
    /** @param data - opened owner. @param ref - relative evidence file. @returns Current identity and timestamps after checking private ownership and size. */
    artifactState(data: TaskData, ref: import('./task-criteria.ts').Artifact): Promise<BigIntStats>;
    /** @param {TaskData} data - owner. @param {import('./task-criteria.ts').Artifact} ref - relative reference. @param {boolean} [verify] - enforce recorded digest. @returns {Promise<Buffer>} complete bytes from an unchanged regular file, allocating and reading at most its initial size plus one byte (16,000,001 maximum). */
    readArtifact(data: TaskData, ref: import('./task-criteria.ts').Artifact, verify?: boolean): Promise<Buffer>;
    /** @param {TaskAccess} access - owner. @returns {Promise<void>} request-local verification and final content recheck of each unique original, fenced to the exact run and journal position. */
    refreshEvidence(access: TaskAccess): Promise<void>;
    /** @param {TaskAccess} access - owner. @param {Record<string,unknown>} result - trusted validator result. @param {string} proofRef - private original reference. @returns {Promise<string>} independently checked current verdict. */
    verdict(access: TaskAccess, result: Record<string, unknown>, proofRef: string): Promise<string>;
    /** @param {TaskAccess} access - capability. @param {string} kind - code-owned asset kind. @param {Record<string,unknown>} data - safe facts; raw personnel remain in private evidence. @param {'host'|'code_verified'} [source] - factual authority. @returns {Promise<string>} unique task-local reference, never deduplicated by name or content. */
    asset(access: TaskAccess, kind: string, data: Record<string, unknown>, source?: 'host' | 'code_verified'): Promise<string>;
    /** @param {TaskAccess} access - capability. @param {string} from - existing task asset. @param {string} to - existing task asset. @param {string} relation - fixed relation. @returns {Promise<string>} journaled relation after both ownership checks. */
    relate(access: TaskAccess, from: string, to: string, relation: string): Promise<string>;
    /** @param {TaskAccess} access - capability. @param {string} id - task-local detail. @param {number} offset - safe character continuation, bounded by configured bytes and any known current derived length. @param {number} budget - character budget. @param projectionId - identity required for graph/digest continuation after offset zero. @returns {Promise<object>} validated detail exposed in bounded text pieces; all canonical detail JSON obeys the configured UTF-8 capacity. */
    detail(access: TaskAccess, id: string, offset: number, budget: number, projectionId?: string): Promise<object>;
    /** @returns {Promise<void>} read immutable ownership plus complete validated journal prefixes; no commands or control are restored. */
    recover(): Promise<void>;
    /** @param {TaskData} data - task being recovered. @returns {Promise<void>} valid history prefix, conservatively blocked on truncation/unfinished writes. */
    recoverJournal(data: TaskData): Promise<void>;
    /** @returns {Promise<void>} drain owned writes before releasing the profile writer lease. */
    close(): Promise<void>;
}
