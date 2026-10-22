import type { RunScope } from './task-scope.ts';
export interface ResourceIdentity {
    version: 1;
    key: string;
    basis: 'document_instance' | 'source_path';
    snapshotKind: 'observation' | 'context' | 'file';
}
export interface ResourceDescriptor {
    id: string;
    basis: 'document_instance' | 'source_path' | 'independent' | 'unavailable';
    snapshotKind: 'observation' | 'context' | 'file' | 'record' | 'unknown';
    groupingReason: string;
}
/** Stable field order is part of the identity contract, independent of object order. */
export declare function runIdentity(run: RunScope): (string | number)[];
/** Called only after Host guest/lease validation, never with model-supplied identity. */
export declare function pageIdentity(run: RunScope, guest: {
    connectionInstanceId: string;
    connectionGeneration: number;
    lease: string;
    partition: string;
    documentToken: string;
}, snapshotKind: 'observation' | 'context'): ResourceIdentity;
/** The caller supplies the checked canonical source from the existing file preparation. */
export declare function fileIdentity(run: RunScope, canonicalSource: string): ResourceIdentity;
/** Allowlisted projection metadata. Unknown/old metadata never invents grouping. */
export declare function resourceDescriptor(run: RunScope, kind: string, id: string, data: unknown): ResourceDescriptor;
