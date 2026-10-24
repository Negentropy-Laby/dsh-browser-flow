export declare const FILE_LIMIT = 16000000;
export interface FileLease {
    id: string;
    state: string;
    agent: object;
    sessionId: string;
    connectionInstanceId: string;
    connectionGeneration: number;
    epoch: number;
    documentToken: string;
    task?: import('./task-scope.ts').RunScope;
    evidenceRoot?: string;
}
/** @param {Uint8Array} bytes - owned bytes. @returns {string} complete SHA-256. */
export declare function digest(bytes: Uint8Array): string;
/** @param {FileLease} lease - exact lease. @returns {string} versioned binding key. */
export declare function bindingKey(lease: FileLease): string;
/** @param {unknown} path - user-supplied local path. @returns {string} absolute path. */
export declare function localPath(path: unknown): string;
/** @param {string} path - owned directory. @returns {Promise<void>} private ACL verified before raw writes. */
export declare function privateDirectory(path: string): Promise<void>;
/** @param {string} path - local regular file. @returns {Promise<Buffer>} bounded owned bytes. */
export declare function readBounded(path: string, limit?: number): Promise<Buffer>;
