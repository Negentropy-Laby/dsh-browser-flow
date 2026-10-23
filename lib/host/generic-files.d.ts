import { type FileLease } from './file-core.ts';
export interface GenericPrepared {
    id: string;
    lease: FileLease;
    binding: string;
    path: string;
    snapshot: string;
    sha256: string;
    bytes: number;
    name: string;
    format: string;
    state: 'prepared' | 'confirmed' | 'consumed';
    assetRef?: string;
}
export declare class GenericFiles {
    private entries;
    private preparing;
    private pending;
    private closed;
    private live;
    prune(): void;
    current(lease: FileLease): GenericPrepared | undefined;
    private own;
    prepare(lease: FileLease, path: unknown): Promise<{
        fileGrantId: string;
        path: string;
        name: string;
        sha256: string;
        bytes: number;
        rows: number;
        kind: string;
        format: string;
        boundary: string;
    }>;
    confirm(lease: FileLease, id: string): void;
    dispatch(lease: FileLease, id: string): Promise<{
        fileGrantId: string;
        name: string;
        sha256: string;
        bytes: number;
        base64: string;
    }>;
    close(): Promise<void>;
}
