/** A package-owned executable, never searched on PATH. */
export interface Binary {
    path: string;
    cwd: string;
}
/** Verification state belongs to one loaded plugin, so reloading permits a paired upgrade. */
export declare class BinaryVerifier {
    private readonly root;
    private readonly read;
    private verified;
    /** @param root - resolved package root. @param read - artifact byte reader. */
    constructor(root: string, read?: (path: string) => Buffer);
    /** @returns Verified artifact; replacement requires plugin reload. */
    resolve(): Binary;
}
