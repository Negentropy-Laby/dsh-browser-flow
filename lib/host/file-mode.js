/** Normalize old envelopes at one boundary; new dispatches always name the mode. */
export function operationFileMode(op) {
    const legacy = op.importScope !== undefined || (op.pagePolicy !== null && typeof op.pagePolicy === 'object' && 'adapter' in op.pagePolicy && op.pagePolicy.adapter === 'bjrsj');
    if (op.fileMode !== undefined && !['generic', 'legacy_import'].includes(String(op.fileMode)))
        throw new Error('invalid file mode');
    if (op.fileMode === 'generic' && legacy)
        throw new Error('file mode conflicts with legacy metadata');
    return op.fileMode === 'legacy_import' || op.fileMode === undefined && legacy ? 'legacy_import' : 'generic';
}
