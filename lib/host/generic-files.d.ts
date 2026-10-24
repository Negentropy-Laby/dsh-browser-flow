import { FileGrants } from './file-grants.ts';
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
export declare class GenericFiles extends FileGrants<GenericPrepared> {
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
    dispatch(lease: FileLease, id: string): Promise<{
        fileGrantId: string;
        name: string;
        sha256: string;
        bytes: number;
        base64: string;
    }>;
}
