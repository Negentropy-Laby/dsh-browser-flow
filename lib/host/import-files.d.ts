import type { FileLease } from './file-core.ts';
export type { FileLease } from './file-core.ts';
import { FileGrants } from './file-grants.ts';
export type Prepared = {
    id: string;
    lease: FileLease;
    binding: string;
    path: string;
    snapshot: string;
    runDir: string;
    bytes: Buffer;
    sha256: string;
    scope: import("./import-rules.ts").ImportScope;
    input: ReturnType<typeof parseWorkbook>;
    assetRef?: string;
    identityVerified?: boolean;
    selectionAcknowledged?: boolean;
    selectionAttemptId?: string;
    state: "prepared" | "confirmed" | "consumed";
};
import { parseWorkbook } from './import-workbook.ts';
export { digest, privateDirectory } from './file-core.ts';
/** One instance owns all private grant state; revoked objects are pruned, never restored. */
export declare class ImportFiles extends FileGrants<Prepared> {
    readonly root: string | undefined;
    constructor(root: string | undefined);
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
    /** @param {FileLease} lease - current lease. @param {string} id - confirmed reference. @returns {Promise<{ fileGrantId: string, name: string, expectedIdentity: {unitId:string,legalIdentity:string}, sha256: string, base64: string, bytes: number, kind: import('./import-rules.ts').BatchKind }>} one-attempt wire payload. */
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
        kind: import('./import-rules.ts').BatchKind;
    }>;
    /** @param {FileLease} lease - exact grant. @param {string} id - confirmed file. @returns {Promise<{fileGrantId:string,name:string,expectedIdentity:{unitId:string,legalIdentity:string},sha256:string,base64:string,bytes:number,kind:import('./import-rules.ts').BatchKind}>} owned single delivery. */
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
        kind: import('./import-rules.ts').BatchKind;
    }>;
    /** @param {Prepared} entry - owned run. @param {string} name - internal fixed artifact basename. @param {unknown} value - private data. @returns {Promise<void>} read-back-verified artifact. */
    write(entry: Prepared, name: string, value: unknown): Promise<void>;
}
