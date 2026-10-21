/** Beijing import facts and pure judgments, independent of navigation and I/O. */
// Code-owned safety policy; local definitions cannot override these values.
export const IMPORT_ORIGIN = 'https://fuwu.rsj.beijing.gov.cn';
export const IMPORT_DATA = Object.freeze({
    "checkPaths": {
        "add": "/zhrs/api4/ggfw-server-yltc/CommonBusiness/ThreeInOneExcelCheck",
        "modify": "/zhrs/api4/ggfw-server-yltc/CommonBusiness/ThreeInOneModifyExcelCheck",
        "reduce": "/zhrs/api4/ggfw-server-yltc/CommonBusiness/ThreeInOneExcelCheck"
    },
    "unitPathSuffixes": [
        "/unitsearch/queryunitinfo",
        "/unitinfo/unitinfoshareddataquery"
    ],
    "readNavigationLabels": [
        "在职职工管理",
        "（增减员）",
        "批量导入",
        "单位信息",
        "单位信息变更",
        "返回工作台"
    ],
    "resultTabs": [
        "信息录入成功",
        "信息录入失败"
    ],
    "uploadLabel": "上传申报信息",
    "successHeader": "电子劳动合同",
    "failureHeader": "失败原因",
    "excludedHeader": "员工类型",
    "nameHeader": "姓名",
    "identityHeaders": [
        "证件号码",
        "证件号",
        "社会保障号码",
        "社会保障号",
        "身份证号码",
        "身份证号"
    ],
    "dismissLabels": [
        "确定",
        "关闭",
        "Close"
    ],
    "stopBoundary": "import_confirmed"
});
export const FILE_LIMIT = 10 * 1024 * 1024;
export const BODY_LIMIT = 200_000;
export const IMPORT_TABS = Object.freeze({ "add": "批量增员", "modify": "批量修改", "reduce": "批量减员" });
export const IMPORT_PATHS = Object.freeze(IMPORT_DATA.checkPaths);
/** @typedef {'add' | 'modify' | 'reduce'} BatchKind */
/** @typedef {{ name: string, certificateNumber: string }} Person */
/** @typedef {{ kind: BatchKind, unitId: string, legalIdentity: string, firstRow: number, lastRow: number }} ImportScope */
/** @typedef {{ unitIds: string[], legalIdentities: string[] }} Identity */
/** @typedef {{ complete: boolean, fresh: boolean, accepted: Person[], rejected: Person[] }} Tables */
/** @typedef {{ status: number, body: string, complete: boolean, requestId: string, responseRequestId: string, method: string, url: string }} CheckResponse */
/** @typedef {{ requestCount: number, pending: number, interference: boolean, response?: CheckResponse, tables?: Tables, summary?: { total: number, success: number, failure: number } }} ImportFacts */
/** @param {unknown} value - JSON candidate. @returns {value is Record<string, unknown>} plain object. */
export function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
/** @param {string} value - identity token. @returns {string} normalized token. */
export function identityToken(value) { return value.normalize('NFKC').trim().replace(/^\[|\]$/g, '').replace(/\s/g, '').toUpperCase(); }
/** @param {unknown} raw - user-entered scope. @returns {ImportScope} validated independent scope. */
export function importScope(raw) {
    if (!record(raw) || Object.keys(raw).some(key => !['kind', 'unitId', 'legalIdentity', 'firstRow', 'lastRow'].includes(key)))
        throw new Error('import-scope-invalid');
    if (raw.kind !== 'add' && raw.kind !== 'modify' && raw.kind !== 'reduce')
        throw new Error('import-kind-invalid');
    if (typeof raw.unitId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(raw.unitId) || /^pending/i.test(raw.unitId))
        throw new Error('import-unit-unenforceable');
    if (typeof raw.legalIdentity !== 'string' || !/^[A-Za-z0-9]{18}$/.test(raw.legalIdentity))
        throw new Error('import-legal-identity-invalid');
    if (typeof raw.firstRow !== 'number' || typeof raw.lastRow !== 'number' || !Number.isSafeInteger(raw.firstRow) || !Number.isSafeInteger(raw.lastRow)
        || raw.firstRow < 2 || raw.lastRow < raw.firstRow || raw.lastRow > 1_048_576)
        throw new Error('import-row-range-invalid');
    return Object.freeze({ kind: raw.kind, unitId: identityToken(raw.unitId), legalIdentity: identityToken(raw.legalIdentity), firstRow: raw.firstRow, lastRow: raw.lastRow });
}
/** @param {unknown} raw - own unit-info response. @returns {Identity} private typed anchors. */
export function extractIdentity(raw) {
    const unitIds = new Set();
    const legalIdentities = new Set();
    if (!record(raw) || !record(raw.map) || !Array.isArray(raw.map.data))
        return { unitIds: [], legalIdentities: [] };
    for (const row of raw.map.data) {
        if (!record(row))
            continue;
        const scopes = [row, row.unitDTO, row.unitExtensionDTO, ...(Array.isArray(row.unitInsuranceDTOList) ? row.unitInsuranceDTOList : [])];
        for (const scope of scopes) {
            if (!record(scope))
                continue;
            if (typeof scope.unitId === 'string' && scope.unitId.trim() && scope.unitId.length <= 64)
                unitIds.add(identityToken(scope.unitId));
            for (const key of ['socialCreditCode', 'unifiedSocialCreditCode', 'uscc']) {
                if (typeof scope[key] === 'string' && /^[A-Za-z0-9]{18}$/.test(scope[key]))
                    legalIdentities.add(identityToken(scope[key]));
            }
        }
    }
    return { unitIds: [...unitIds], legalIdentities: [...legalIdentities] };
}
/** @param {Identity} actual - observed anchors. @param {ImportScope} expected - scope. @returns {string} verified, mismatch or unverified. */
export function judgeIdentity(actual, expected) {
    if (actual.unitIds.some(value => identityToken(value) !== expected.unitId) || actual.legalIdentities.some(value => identityToken(value) !== expected.legalIdentity))
        return 'mismatch';
    return actual.unitIds.length > 0 && actual.legalIdentities.length > 0 ? 'verified' : 'unverified';
}
/** @param {Person[]} people - private rows. @returns {Set<string> | undefined} unique complete personnel keys. */
export function personKeys(people) {
    const keys = new Set();
    const certificates = new Set();
    for (const row of people) {
        if (!row || typeof row.name !== 'string' || !row.name.trim() || typeof row.certificateNumber !== 'string' || !/^\d{17}[\dX]$/.test(row.certificateNumber))
            return undefined;
        const key = JSON.stringify([row.name.trim(), row.certificateNumber]);
        if (keys.has(key) || certificates.has(row.certificateNumber))
            return undefined;
        keys.add(key);
        certificates.add(row.certificateNumber);
    }
    return keys;
}
/** @param {ImportScope} scope - approved scope. @param {Person[]} input - fixed file rows. @param {ImportFacts} facts - same-run observations. @returns {{ verdict: string, reason: string, serverAcceptance: string, rowValidation: string, importBatch: string, counts?: { planned: number, accepted: number, rejected: number } }} safe judgment. */
export function judgeImport(scope, input, facts) {
    /** @param {string} reason - finite reason. @param {string} [verdict] - judgment. @returns {ReturnType<typeof judgeImport>} verdict. */
    const fail = (reason, verdict = 'unknown') => ({ verdict, reason, serverAcceptance: verdict === 'rejected' ? 'violated' : 'unknown', rowValidation: 'unknown', importBatch: verdict === 'rejected' ? 'violated' : 'unknown' });
    const response = facts.response;
    if (facts.interference || facts.requestCount !== 1 || facts.pending !== 0 || !response || response.requestId !== response.responseRequestId)
        return fail('request-not-uniquely-owned');
    let url;
    try {
        url = new URL(response.url);
    }
    catch {
        return fail('endpoint-invalid');
    }
    if (url.origin !== IMPORT_ORIGIN || url.pathname !== IMPORT_PATHS[scope.kind] || response.method !== 'POST')
        return fail('endpoint-kind-mismatch');
    if (!response.complete || response.body.length >= BODY_LIMIT || response.status < 200 || response.status >= 300)
        return fail('response-incomplete');
    /** @type {unknown} */ let body;
    try {
        body = JSON.parse(response.body);
    }
    catch {
        return fail('response-not-json');
    }
    if (!record(body) || (typeof body.appcode !== 'string' && typeof body.appcode !== 'number'))
        return fail('envelope-invalid');
    if (String(body.appcode) !== '0')
        return fail('server-rejected', 'rejected');
    if (!record(body.map) || !Array.isArray(body.map.data) || body.map.data.length === 0 || body.map.data.length > 10_000)
        return fail('rows-incomplete');
    /** @type {Person[]} */ const accepted = [];
    /** @type {Person[]} */ const rejected = [];
    for (const row of body.map.data) {
        if (!record(row) || typeof row.name !== 'string' || row.name.length > 256 || typeof row.certificateNumber !== 'string'
            || typeof row.errorMessage !== 'string' || row.errorMessage.length > 4000)
            return fail('row-invalid');
        if (row.validateStatus != null && !['string', 'number'].includes(typeof row.validateStatus))
            return fail('row-status-invalid');
        if (row.validateStatus != null && (String(row.validateStatus).trim().length === 0 || String(row.validateStatus).length > 64))
            return fail('row-status-invalid');
        if (String(row.validateStatus).trim() === '0' && !row.errorMessage.trim())
            return fail('row-status-contradiction', 'rejected');
        const person = { name: row.name.trim(), certificateNumber: row.certificateNumber.trim().toUpperCase() };
        (row.errorMessage.trim() ? rejected : accepted).push(person);
    }
    if (!personKeys([...accepted, ...rejected]))
        return fail('duplicate-or-invalid-personnel', 'rejected');
    if (rejected.length)
        return { ...fail('row-rejected', 'rejected'), serverAcceptance: 'satisfied', rowValidation: 'violated', counts: { planned: input.length, accepted: accepted.length, rejected: rejected.length } };
    const tables = facts.tables;
    const summary = facts.summary;
    if (!tables?.complete || !tables.fresh || !summary)
        return { ...fail('result-not-fresh-complete'), serverAcceptance: 'satisfied' };
    const sets = [personKeys(input), personKeys(accepted), personKeys(tables.accepted)];
    if (sets.some(set => !set || set.size !== input.length) || sets.some(set => set && [...set].some(key => !sets[0]?.has(key)))
        || tables.rejected.length !== 0 || summary.failure !== 0 || summary.success !== input.length || summary.total !== input.length
        || input.length !== scope.lastRow - scope.firstRow + 1)
        return { ...fail('input-result-conflict'), serverAcceptance: 'satisfied' };
    return { verdict: 'import_confirmed', reason: 'fresh-complete-matching', serverAcceptance: 'satisfied', rowValidation: 'satisfied', importBatch: 'satisfied', counts: { planned: input.length, accepted: accepted.length, rejected: 0 } };
}
