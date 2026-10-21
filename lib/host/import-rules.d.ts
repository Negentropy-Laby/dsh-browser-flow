/** @typedef {'add' | 'modify' | 'reduce'} BatchKind */
/** @typedef {{ name: string, certificateNumber: string }} Person */
/** @typedef {{ kind: BatchKind, unitId: string, legalIdentity: string, firstRow: number, lastRow: number }} ImportScope */
/** @typedef {{ unitIds: string[], legalIdentities: string[] }} Identity */
/** @typedef {{ complete: boolean, fresh: boolean, accepted: Person[], rejected: Person[] }} Tables */
/** @typedef {{ status: number, body: string, complete: boolean, requestId: string, responseRequestId: string, method: string, url: string }} CheckResponse */
/** @typedef {{ requestCount: number, pending: number, interference: boolean, response?: CheckResponse, tables?: Tables, summary?: { total: number, success: number, failure: number } }} ImportFacts */
/** @param {unknown} value - JSON candidate. @returns {value is Record<string, unknown>} plain object. */
export function record(value: unknown): value is Record<string, unknown>;
/** @param {string} value - identity token. @returns {string} normalized token. */
export function identityToken(value: string): string;
/** @param {unknown} raw - user-entered scope. @returns {ImportScope} validated independent scope. */
export function importScope(raw: unknown): ImportScope;
/** @param {unknown} raw - own unit-info response. @returns {Identity} private typed anchors. */
export function extractIdentity(raw: unknown): Identity;
/** @param {Identity} actual - observed anchors. @param {ImportScope} expected - scope. @returns {string} verified, mismatch or unverified. */
export function judgeIdentity(actual: Identity, expected: ImportScope): string;
/** @param {Person[]} people - private rows. @returns {Set<string> | undefined} unique complete personnel keys. */
export function personKeys(people: Person[]): Set<string> | undefined;
/** @param {ImportScope} scope - approved scope. @param {Person[]} input - fixed file rows. @param {ImportFacts} facts - same-run observations. @returns {{ verdict: string, reason: string, serverAcceptance: string, rowValidation: string, importBatch: string, counts?: { planned: number, accepted: number, rejected: number } }} safe judgment. */
export function judgeImport(scope: ImportScope, input: Person[], facts: ImportFacts): {
    verdict: string;
    reason: string;
    serverAcceptance: string;
    rowValidation: string;
    importBatch: string;
    counts?: {
        planned: number;
        accepted: number;
        rejected: number;
    };
};
/** Beijing import facts and pure judgments, independent of navigation and I/O. */
export const IMPORT_ORIGIN: "https://fuwu.rsj.beijing.gov.cn";
export const IMPORT_DATA: Readonly<{
    checkPaths: {
        add: string;
        modify: string;
        reduce: string;
    };
    unitPathSuffixes: string[];
    readNavigationLabels: string[];
    resultTabs: string[];
    uploadLabel: "上传申报信息";
    successHeader: "电子劳动合同";
    failureHeader: "失败原因";
    excludedHeader: "员工类型";
    nameHeader: "姓名";
    identityHeaders: string[];
    dismissLabels: string[];
    stopBoundary: "import_confirmed";
}>;
export const FILE_LIMIT: number;
export const BODY_LIMIT: 200000;
export const IMPORT_TABS: Readonly<{
    add: "批量增员";
    modify: "批量修改";
    reduce: "批量减员";
}>;
export const IMPORT_PATHS: Readonly<{
    add: string;
    modify: string;
    reduce: string;
}>;
export type BatchKind = "add" | "modify" | "reduce";
export type Person = {
    name: string;
    certificateNumber: string;
};
export type ImportScope = {
    kind: BatchKind;
    unitId: string;
    legalIdentity: string;
    firstRow: number;
    lastRow: number;
};
export type Identity = {
    unitIds: string[];
    legalIdentities: string[];
};
export type Tables = {
    complete: boolean;
    fresh: boolean;
    accepted: Person[];
    rejected: Person[];
};
export type CheckResponse = {
    status: number;
    body: string;
    complete: boolean;
    requestId: string;
    responseRequestId: string;
    method: string;
    url: string;
};
export type ImportFacts = {
    requestCount: number;
    pending: number;
    interference: boolean;
    response?: CheckResponse;
    tables?: Tables;
    summary?: {
        total: number;
        success: number;
        failure: number;
    };
};
