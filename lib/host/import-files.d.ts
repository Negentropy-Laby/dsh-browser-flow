/** @typedef {{ id: string, state: string, agent: object, sessionId: string, connectionInstanceId: string, connectionGeneration: number, epoch: number, documentToken: string, task?: import('./task-scope.ts').RunScope, evidenceRoot?: string }} FileLease */
/** @typedef {{ id: string, lease: FileLease, binding: string, path: string, snapshot: string, runDir: string, bytes: Buffer, sha256: string, scope: import('./import-rules.js').ImportScope, input: ReturnType<typeof parseWorkbook>, assetRef?: string, identityVerified?: boolean, selectionAcknowledged?: boolean, selectionAttemptId?: string, state: 'prepared' | 'confirmed' | 'consumed' }} Prepared */
/** @param {Uint8Array} bytes - owned bytes. @returns {string} complete SHA-256. */
export function digest(bytes: Uint8Array): string;
/** @param {string} path - owned directory. @returns {Promise<void>} private ACL verified before raw writes. */
export function privateDirectory(path: string): Promise<void>;
/** One instance owns all private grant state; revoked objects are pruned, never restored. */
export class ImportFiles {
    /** @param {string | undefined} root - profile-private root; absence disables preparation. */
    constructor(root: string | undefined);
    root: string | undefined;
    /** @type {Map<string, Prepared>} */ entries: Map<string, Prepared>;
    /** @type {Set<FileLease>} */ preparing: Set<FileLease>;
    closed: boolean;
    /** @type {Set<Promise<unknown>>} */ tasks: Set<Promise<unknown>>;
    /** @param {Prepared} entry - retained preparation. @param {FileLease} lease - current exact lease. @returns {void} validates ownership. */
    assertLive(entry: Prepared, lease: FileLease): void;
    /** @returns {void} release references for retired leases. */
    prune(): void;
    /** @param {FileLease} lease - current lease. @returns {Prepared | undefined} same-document preparation. */
    current(lease: FileLease): Prepared | undefined;
    /** @param {FileLease} lease - exact page grant. @param {unknown} path - panel-supplied path. @param {unknown} rawScope - panel scope. @returns {Promise<{ fileGrantId: string, path: string, name: string, sha256: string, bytes: number, rows: number, kind: string, boundary: string }>} private panel preview. */
    prepare(lease: FileLease, path: unknown, rawScope: unknown): Promise<{
        fileGrantId: string;
        path: string;
        name: string;
        sha256: string;
        bytes: number;
        rows: number;
        kind: string;
        boundary: string;
    }>;
    /** @param {FileLease} lease - exact page grant. @param {unknown} path - panel path. @param {unknown} rawScope - raw scope. @returns {Promise<{fileGrantId:string,path:string,name:string,sha256:string,bytes:number,rows:number,kind:string,boundary:string}>} owned preparation. */
    prepareOwned(lease: FileLease, path: unknown, rawScope: unknown): Promise<{
        fileGrantId: string;
        path: string;
        name: string;
        sha256: string;
        bytes: number;
        rows: number;
        kind: string;
        boundary: string;
    }>;
    /** @param {FileLease} lease - current lease. @param {string} id - preview reference. @returns {void} confirms exactly the previewed preparation. */
    confirm(lease: FileLease, id: string): void;
    /** @param {FileLease} lease - current lease. @param {string} id - confirmed reference. @returns {Promise<{ fileGrantId: string, name: string, expectedIdentity: {unitId:string,legalIdentity:string}, sha256: string, base64: string, bytes: number, kind: import('./import-rules.js').BatchKind }>} one-attempt wire payload. */
    dispatch(lease: FileLease, id: string): Promise<{
        fileGrantId: string;
        name: string;
        expectedIdentity: {
            unitId: string;
            legalIdentity: string;
        };
        sha256: string;
        base64: string;
        bytes: number;
        kind: import("./import-rules.js").BatchKind;
    }>;
    /** @param {FileLease} lease - exact grant. @param {string} id - confirmed file. @returns {Promise<{fileGrantId:string,name:string,expectedIdentity:{unitId:string,legalIdentity:string},sha256:string,base64:string,bytes:number,kind:import('./import-rules.js').BatchKind}>} owned single delivery. */
    dispatchOwned(lease: FileLease, id: string): Promise<{
        fileGrantId: string;
        name: string;
        expectedIdentity: {
            unitId: string;
            legalIdentity: string;
        };
        sha256: string;
        base64: string;
        bytes: number;
        kind: import("./import-rules.js").BatchKind;
    }>;
    /** @param {Prepared} entry - owned run. @param {string} name - internal fixed artifact basename. @param {unknown} value - private data. @returns {Promise<void>} read-back-verified artifact. */
    write(entry: Prepared, name: string, value: unknown): Promise<void>;
    /** @returns {Promise<void>} detach grants and await owned file I/O without deleting evidence. */
    close(): Promise<void>;
}
export type FileLease = {
    id: string;
    state: string;
    agent: object;
    sessionId: string;
    connectionInstanceId: string;
    connectionGeneration: number;
    epoch: number;
    documentToken: string;
    task?: import("./task-scope.ts").RunScope;
    evidenceRoot?: string;
};
export type Prepared = {
    id: string;
    lease: FileLease;
    binding: string;
    path: string;
    snapshot: string;
    runDir: string;
    bytes: Buffer;
    sha256: string;
    scope: import("./import-rules.js").ImportScope;
    input: ReturnType<typeof parseWorkbook>;
    assetRef?: string;
    identityVerified?: boolean;
    selectionAcknowledged?: boolean;
    selectionAttemptId?: string;
    state: "prepared" | "confirmed" | "consumed";
};
import { parseWorkbook } from './import-workbook.js';
