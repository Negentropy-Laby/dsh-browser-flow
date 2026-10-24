/** Normalize old envelopes at one boundary; new dispatches always name the mode. */
export declare function operationFileMode(op: {
    fileMode?: unknown;
    importScope?: unknown;
    pagePolicy?: unknown;
}): 'generic' | 'legacy_import';
