/** Internal graph protocol v1. Page control remains Browser Flow v3. */
import type { Readable, Writable } from 'node:stream';
import type { RunScope } from '../task-scope.js';
/** Consumed subset of the pinned Host subprocess service. No provider is created. */
export interface SubprocessPort {
    spawn(spec: {
        argv: readonly string[];
        cwd: string;
        stdio: {
            stdin: 'pipe';
            stdout: 'pipe';
            stderr: {
                maxBytes: number;
            };
        };
        graceMs: number;
        signal?: AbortSignal;
    }): ProcessHandle;
}
/** A managed process range, including its quiescent exit signal. */
export interface ProcessHandle {
    readonly stdin: Writable | undefined;
    readonly stdout: Readable | undefined;
    readonly done: Promise<unknown>;
    terminate(): void;
    waitForExit(signal?: AbortSignal): Promise<boolean>;
}
/** Deployment choices resolved with the plugin configuration. */
export interface GraphConfig {
    graphMaxWorkers: number;
    graphIdleMs: number;
    graphRequestTimeoutMs: number;
    graphMaxFrameBytes: number;
    graphStderrBytes: number;
    graphTerminateGraceMs: number;
    graphColdRounds: number;
    graphMinGroup: number;
}
/** Sanitized closed event; original asset data cannot enter a worker. */
export interface GraphEvent {
    seq: number;
    hash: string;
    type: string;
    run: RunScope;
    id?: string;
    kind?: string;
    source?: string;
    action?: string;
    outcome?: string;
    from?: string;
    to?: string;
    relation?: string;
    goal?: string;
    documentToken?: string;
}
/** Code-owned display criterion. It never becomes authority by crossing IPC. */
export interface Criterion {
    id: string;
    label: string;
    status: string;
    source: string;
    validatorId?: string;
    version?: number;
}
/** A complete replay snapshot, scoped before projection. */
export interface GraphInput {
    scope: RunScope;
    version: number;
    tailHash: string;
    goal: string;
    constraints: string[];
    criteria: Criterion[];
    events: GraphEvent[];
    protected: string[];
    proofRef: string;
    proofSeq: number;
    coldRounds: number;
    minGroup: number;
    liveDocumentToken: string;
}
/** Closed request envelope. All replies must echo its immutable binding. */
export interface GraphRequest {
    protocolVersion: 1;
    id: string;
    generation: string;
    scope: RunScope;
    version: number;
    tailHash: string;
    inputHash: string;
    op: 'hello' | 'project' | 'detail';
    budgetMs: number;
    budget: number;
    input?: GraphInput;
    ref?: string;
}
/** A sanitized record decoded from a worker. */
export type JsonRecord = Record<string, unknown>;
/** @param value - wire value. @returns Whether it is a non-array JSON record. */
export declare function record(value: unknown): value is JsonRecord;
/** Expected component failures are safe to expose without raw stderr or paths. */
export declare class GraphError extends Error {
    readonly code: string;
    /** @param code - bounded code, never original process diagnostics. */
    constructor(code: string);
}
/** @param value - JSON message. @param limit - maximum payload bytes. @returns A length-prefixed UTF-8 frame. */
export declare function frame(value: unknown, limit: number): Buffer;
/** Bounded incremental decoder; allocation is rejected before reading the body. */
export declare class Frames {
    private readonly limit;
    private readonly receive;
    private prefix;
    private prefixBytes;
    private body;
    private bodyBytes;
    /** @param limit - payload byte limit. @param receive - one complete JSON value. */
    constructor(limit: number, receive: (value: unknown) => void);
    /** @param chunk - raw stdout bytes. @returns Nothing; malformed data throws. */
    push(chunk: Buffer): void;
    /** @returns Whether EOF would truncate a frame. */
    get incomplete(): boolean;
}
