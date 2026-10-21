import type { GraphConfig, GraphInput, JsonRecord, SubprocessPort } from './protocol.ts';
/** @param bytes - complete input. @returns SHA-256 identity. */
export declare function graphHash(bytes: string | Buffer): string;
/** Packaged helper location, not an executable searched on PATH. */
export interface Binary {
    path: string;
    cwd: string;
}
/** @returns A verified Windows x64 package artifact. */
export declare function packagedBinary(): Binary;
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
    private worker;
    private acquire;
    /** @param input - complete sanitized snapshot. @param budget - display limit. @param current - recheck after every asynchronous operation. @param signal - caller cancellation. @returns Four derived modules; no Host facts. */
    project(input: GraphInput, budget: number, current: () => boolean, signal?: AbortSignal): Promise<JsonRecord>;
    /** @param input - current snapshot. @param ref - task-owned projection reference. @param current - current binding check. @param signal - caller cancellation. @returns Sanitized immutable detail. */
    detail(input: GraphInput, ref: string, current: () => boolean, signal?: AbortSignal): Promise<unknown>;
    private bounded;
    /** @param taskId - owned task being ended or revised. @returns Quiescent worker disposal. */
    retire(taskId: string): Promise<void>;
    /** @returns All workers have stopped before plugin disposal completes. */
    close(): Promise<void>;
}
