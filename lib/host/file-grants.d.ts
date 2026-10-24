/** Shared ownership, confirmation and single-use lifecycle; file policies stay in callers. */
import { type FileLease } from './file-core.ts';
export interface BoundFileGrant {
    id: string;
    lease: FileLease;
    binding: string;
    state: 'prepared' | 'confirmed' | 'consumed';
}
export declare class FileGrants<T extends BoundFileGrant> {
    readonly entries: Map<string, T>;
    readonly preparing: Set<FileLease>;
    readonly tasks: Set<Promise<unknown>>;
    closed: boolean;
    assertLive(entry: T, lease: FileLease): void;
    prune(): void;
    current(lease: FileLease): T | undefined;
    protected own<R>(f: () => Promise<R>): Promise<R>;
    protected beginPrepare(lease: FileLease): void;
    confirm(lease: FileLease, id: string): void;
    protected consume(lease: FileLease, id: string): T;
    close(): Promise<void>;
}
/** Every Host lifecycle point retires both strategies through this one collection. */
export declare class FileGrantCollection {
    private readonly members;
    constructor(members: readonly {
        prune(): void;
        close(): Promise<void>;
    }[]);
    prune(): void;
    close(): Promise<void>;
}
