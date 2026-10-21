import type { Binary } from './binary.ts';
import type { GraphConfig, GraphInput, GraphRequest, JsonRecord, ProcessHandle, SubprocessPort } from './protocol.ts';
/** @param bytes - complete input. @returns SHA-256 identity. */
export declare function graphHash(bytes: string | Buffer): string;
/** @param inputHash - exact safe replay input digest. @returns External continuation identity including the kernel serialization version. */
export declare function graphProjectionId(inputHash: string): string;
declare class Worker {
    private readonly config;
    private readonly now;
    readonly generation: `${string}-${string}-${string}-${string}-${string}`;
    readonly handle: ProcessHandle;
    readonly scope: GraphInput['scope'];
    closing: boolean;
    stopped: boolean;
    busy: boolean;
    private pending;
    private counter;
    cleanup: {
        state: 'pending' | 'failed';
        code?: string;
    } | undefined;
    private readonly drainError;
    private idle;
    private stopping;
    private readonly decoder;
    private readonly onData;
    private readonly onEnd;
    private readonly onError;
    cached: {
        hash: string;
        budget: number;
        value: JsonRecord;
    } | undefined;
    detailCache: {
        hash: string;
        ref: string;
        value: unknown;
    } | undefined;
    private ready;
    private prepared;
    private queue;
    private queued;
    /** @param runtime - actual Host service. @param config - resolved limits. @param binary - verified package artifact. @param input - initial run. @param now - Host monotonic clock. */
    constructor(runtime: SubprocessPort, config: GraphConfig, binary: Binary, input: GraphInput, now: () => number);
    private fail;
    private receive;
    /** @param op - fixed RPC. @param input - safe snapshot. @param hash - its identity. @param budget - view size. @param deadline - Host monotonic deadline. @param ref - scoped projection detail. @returns Validated envelope payload. */
    rpc(op: GraphRequest['op'], input: GraphInput, hash: string, budget: number, deadline: number, ref?: string, offsetBytes?: number): Promise<unknown>;
    /** @param job - serial RPC operation. @param deadline - original request deadline. @param current - live binding. @returns One bounded queued operation; expired work never dispatches. */
    run<T>(job: () => Promise<T>, deadline: number, current: () => boolean): Promise<T>;
    /** @param input - complete safe input. @param hash - projection identity. @param budget - optional requested view budget. @param deadline - original deadline. @param current - current binding. @returns Validated view, or no view when already prepared for a detail read. */
    load(input: GraphInput, hash: string, budget: number | undefined, deadline: number, current: () => boolean): Promise<JsonRecord | undefined>;
    /** @returns Completion only after the managed range is empty. */
    stop(): Promise<void>;
}
/** Task-scoped registry. Missing services affect graph reads, never permission withdrawal. */
export declare class GraphWorkers {
    private readonly config;
    private readonly binary;
    private readonly now;
    private runtime;
    private workers;
    private closed;
    private acquisitions;
    /** @param config - resolved settings. @param binary - package resolver; tests may supply an owned helper. @param now - monotonic clock, injectable for deadline tests. */
    constructor(config: GraphConfig, binary?: () => Binary, now?: () => number);
    /** @param runtime - newly mounted service. @returns Disposal joined before the provider is released. */
    attach(runtime: SubprocessPort): () => Promise<void>;
    private stopAll;
    private disposeWorkers;
    private worker;
    private acquire;
    /** @param input - complete sanitized snapshot. @param budget - display limit. @param current - recheck after every asynchronous operation. @param signal - caller cancellation. @returns Four derived modules; no Host facts. */
    project(input: GraphInput, budget: number, current: () => boolean, signal?: AbortSignal): Promise<JsonRecord>;
    /** @param input - current snapshot. @param ref - task-owned projection reference. @param current - current binding check. @param signal - caller cancellation. @returns Sanitized immutable detail. */
    detail(input: GraphInput, ref: string, current: () => boolean, signal?: AbortSignal): Promise<unknown>;
    private bounded;
    /** @param taskId - owned task being ended or revised. @returns Quiescent worker disposal. */
    retire(taskId: string): Promise<void>;
    /** @param taskId - owned task. @returns Pending or failed cleanup, independent of durable task status. */
    cleanup(taskId: string): Worker['cleanup'];
    /** @returns All workers have stopped before plugin disposal completes. */
    close(): Promise<void>;
}
export {};
