window.__ModuleLoader__.load({
  id: '@negentropy/dsh-browser-flow',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const react = require('react')
// ---- src/task-scope.js ----
/** Browser Flow v3 task and run identifiers, shared by Host and Client. */
/** @typedef {string & {readonly __browserTaskId:'TaskId'}} TaskId */
/** @typedef {string & {readonly __browserProfileId:'ProfileId'}} ProfileId */
/** @typedef {string & {readonly __browserRunId:'RunId'}} RunId */
/** @typedef {{ profileId: ProfileId, taskId: TaskId, ownerSessionId: string, scopeRevision: number }} TaskScope */
/** @typedef {TaskScope & { runId: RunId, workflowRef: string }} RunScope */
/** @param {unknown} value - JSON value. @returns {value is Record<string, unknown>} object. */
const scopeRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value - scope from disk/wire. @returns {value is TaskScope} validated public identifiers. */
function validTaskScope(value) {
    return scopeRecord(value) && typeof value.profileId === 'string' && /^profile-[a-f0-9]{32}$/.test(value.profileId)
        && typeof value.taskId === 'string' && /^task-[a-f0-9-]{36}$/.test(value.taskId)
        && typeof value.ownerSessionId === 'string' && value.ownerSessionId.length > 0 && value.ownerSessionId.length <= 200
        && Number.isSafeInteger(value.scopeRevision) && Number(value.scopeRevision) >= 1;
}
/** @param {unknown} value - run scope. @returns {value is RunScope} complete run identity. */
function validRunScope(value) {
    return validTaskScope(value) && 'runId' in value && typeof value.runId === 'string' && /^run-[a-f0-9-]{36}$/.test(value.runId)
        && 'workflowRef' in value && typeof value.workflowRef === 'string' && value.workflowRef.length > 0 && value.workflowRef.length <= 100;
}
/** @param {TaskScope} left - one scope. @param {TaskScope} right - another scope. @returns {boolean} exact task ownership/revision. */
function sameTaskScope(left, right) {
    return left.profileId === right.profileId && left.taskId === right.taskId && left.ownerSessionId === right.ownerSessionId && left.scopeRevision === right.scopeRevision;
}
/** @param {RunScope} left - one run. @param {RunScope} right - another run. @returns {boolean} exact task/run. */
function sameRunScope(left, right) { return sameTaskScope(left, right) && left.runId === right.runId && left.workflowRef === right.workflowRef; }

// ---- src/clientcore.js ----
/**
 * Pure client-side helpers, shared by the panel bundle and its tests.
 *
 * These functions hold the parts of the browser-side logic that can be reasoned
 * about without a DOM: which fixed program to run for one Host operation, how to
 * read a guest element's identity markers, and how to classify an execution
 * failure. Keeping them here means the bundle inlines tested code rather than
 * untested inline logic.
 *
 * @module @negentropy/dsh-browser-flow/clientcore
 */

/** Marker the shipped Browser UI puts on a live Electron guest element. */
const WEBVIEW_SELECTOR = 'webview[data-sidebar-browser-frame="webview"]';
/**
 * One operation the Host dispatches to the panel.
 * @typedef {object} PageOperation
 * @property {'observe' | 'find' | 'act' | 'wait'} kind - operation kind.
 * @property {number} [maxChars] - observe character budget.
 * @property {number} [maxNodes] - observe node budget.
 * @property {object} [query] - find query.
 * @property {number} [limit] - find match limit.
 * @property {{ documentToken: string, elementRef: string }} [target] - action or wait target.
 * @property {string} [action] - action name.
 * @property {string} [value] - action value.
 * @property {boolean} [checked] - explicit checked state.
 * @property {string} [condition] - wait condition.
 * @property {number} [timeoutMs] - wait budget.
 * @property {string} [text] - wait text.
 * @property {string} [view] - optional Beijing import view.
 * @property {object} [pagePolicy] - code-owned site restrictions.
 * @property {object} [importScope] - Host-owned import kind.
 * @property {string} [importOwner] - exact scoped lease generation.
 * @property {number} [windowMs] - relative import collection lifetime.
 * @property {object} [file] - one confirmed internal file payload, never model arguments.
 */
/**
 * The fixed page programs the panel runs.
 * @typedef {object} PagePrograms
 * @property {string} identity - identity program source.
 * @property {(maxChars: number, maxNodes: number) => string} observe - observation program.
 * @property {(query: object, limit: number) => string} find - find program.
 * @property {(input: object) => string} act - action program.
 * @property {(input: object) => string} wait - wait program.
 * @property {(input: object) => string} [import] - fixed import observer and selection program.
 */
/**
 * Choose the fixed page program for one Host operation.
 *
 * Only the operations this build implements are accepted; anything else throws
 * so the panel reports `unsupported` instead of executing an empty program.
 * @param {PagePrograms} pageCode - program builders.
 * @param {PageOperation} op - validated operation from the Host.
 * @returns {string} program source to execute in the page.
 * @throws {Error} for an operation this build does not implement.
 */
function programFor(pageCode, op) {
    if (op.view === 'bjrsj_import' || (op.kind === 'act' && op.action === 'set_file')) {
        if (!pageCode.import)
            throw new Error('the scoped import program is unavailable');
        return pageCode.import({ mode: op.action === 'set_file' ? 'set_file' : 'observe', owner: op.importOwner, scope: op.importScope, windowMs: op.windowMs, target: op.target, file: op.file });
    }
    if (op.kind === 'observe')
        return pageCode.observe(/** @type {number} */ (op.maxChars), /** @type {number} */ (op.maxNodes));
    if (op.kind === 'find')
        return pageCode.find(/** @type {object} */ (op.query), /** @type {number} */ (op.limit));
    if (op.kind === 'act') {
        const target = /** @type {{ documentToken: string, elementRef: string }} */ (op.target);
        return pageCode.act({
            documentToken: target.documentToken,
            elementRef: target.elementRef,
            action: op.action,
            ...(op.pagePolicy === undefined ? {} : { pagePolicy: op.pagePolicy }),
            ...(op.importScope === undefined ? {} : { importScope: op.importScope }),
            ...(op.value === undefined ? {} : { value: op.value }),
            ...(op.checked === undefined ? {} : { checked: op.checked }),
        });
    }
    if (op.kind === 'wait') {
        return pageCode.wait({
            condition: op.condition,
            target: op.target,
            timeoutMs: op.timeoutMs,
            ...(op.text === undefined ? {} : { text: op.text }),
        });
    }
    throw new Error(`unsupported operation ${String(op.kind)}`);
}
/**
 * Read the identity markers of one live guest element.
 *
 * The shipped Browser UI emits these markers on the element and its ancestors.
 * They are observations used to group pages in the panel; the Host never trusts
 * them as an identity claim.
 * @param {Element} element - guest element.
 * @returns {{ lease: string, partition: string, sessionId: string, tabId: string }} identity facts.
 */
function identityOf(element) {
    const sessionHost = element.closest('[data-sidebar-right-session]');
    const tabHost = element.closest('[data-sidebar-right-tab]') || element.closest('[data-dockkit-content]');
    return {
        lease: element.getAttribute('name') || '',
        partition: element.getAttribute('partition') || '',
        sessionId: sessionHost === null ? '' : (sessionHost.getAttribute('data-sidebar-right-session') || ''),
        tabId: tabHost === null ? '' : (tabHost.getAttribute('data-sidebar-right-tab') || tabHost.getAttribute('data-dockkit-content') || ''),
    };
}
/**
 * Classify one in-page execution outcome.
 *
 * A thrown `executeJavaScript` call means the page may already have acted, so
 * it is reported as `unknown_outcome`; only a well-formed program result can
 * claim success or a specific failure.
 * @param {unknown} result - value returned by `executeJavaScript`.
 * @returns {{ outcome: 'ok', payload: unknown } | { outcome: 'failed' | 'unknown_outcome', error: { code: string, message: string } }} outcome.
 */
function classifyResult(result) {
    if (result === undefined || result === null) {
        return { outcome: 'unknown_outcome', error: { code: 'unknown_outcome', message: 'the page returned no result' } };
    }
    const record = typeof result === 'object' && result !== null ? /** @type {Record<string, unknown>} */ (result) : undefined;
    if (record === undefined || record.ok !== true) {
        const raw = record?.error;
        const detail = typeof raw === 'object' && raw !== null ? /** @type {Record<string, unknown>} */ (raw) : {};
        return {
            outcome: 'failed',
            error: {
                code: typeof detail.code === 'string' ? detail.code : 'internal',
                message: typeof detail.message === 'string' ? detail.message : 'the page reported a failure',
            },
        };
    }
    return { outcome: 'ok', payload: record.value };
}
/**
 * Classify a thrown execution.
 * @param {unknown} failure - thrown value.
 * @returns {{ outcome: 'unknown_outcome', error: { code: string, message: string } }} outcome.
 */
function classifyThrow(failure) {
    return {
        outcome: 'unknown_outcome',
        error: { code: 'unknown_outcome', message: String(/** @type {{ message?: unknown }} */ (failure)?.message ?? failure) },
    };
}
/**
 * Whether one candidate page can be told apart from the others.
 *
 * The plan requires that a user authorizing a page can identify the physical
 * page they are granting, and that authorization is refused when they cannot.
 * The panel shows the address, the title and the page alias, so those three are
 * exactly what the user has to go on: two rows matching in all three look the
 * same on screen, and picking one would grant an unspecified physical page.
 * @param {readonly object[]} pages - candidate pages the panel offers.
 * @param {object} target - the page the user picked.
 * @returns {object[]} the other candidates that render identically to it.
 */
function indistinguishableFrom(pages, target) {
    const /** @type {any} */ chosen = target;
    return pages.filter(/** @param {any} page */ /** @param {any} page */ page => {
        if (page.lease === chosen.lease)
            return false;
        return (page.url ?? '') === (chosen.url ?? '')
            && (page.title ?? '') === (chosen.title ?? '')
            && (page.tabId ?? '') === (chosen.tabId ?? '');
    });
}
/**
 * Refuse a command that does not address the authorization this panel holds.
 *
 * The Host decides what to dispatch; this decides whether *this* panel may run
 * it. Without this check a command minted for one authorization would execute
 * against whatever page the panel is bound to now, which after a second
 * authorization is a different object entirely. Echoing the command's fields
 * back in the result proves nothing; comparing them before the page is touched
 * is what closes the gap.
 * @param {object} command - command envelope taken from the Host.
 * @param {object | undefined} binding - the authorization this panel holds.
 * @param {number} generation - this panel's connection generation.
 * @returns {{ outcome: string, error: { code: string, message: string } } | undefined} a refusal, or undefined to proceed.
 */
function refuseCommand(command, binding, generation) {
    const /** @type {any} */ envelope = command;
    const /** @type {any} */ held = binding;
    if (held === undefined) {
        return { outcome: 'failed', error: { code: 'not_authorized', message: 'no page is authorized in this panel' } };
    }
    if (!validRunScope(envelope.task) || !validRunScope(held.task) || !sameRunScope(envelope.task, held.task))
        return { outcome: 'failed', error: { code: 'task_scope_mismatch', message: 'command task/run differs from the user-bound task' } };
    if (held.pagePolicy && (envelope.op?.pagePolicy?.adapter !== held.pagePolicy.adapter || envelope.op?.pagePolicy?.workflow !== held.pagePolicy.workflow))
        return { outcome: 'failed', error: { code: 'task_scope_mismatch', message: 'command omitted or changed the task site policy' } };
    if (envelope.leaseId !== held.controlLeaseId) {
        return { outcome: 'failed', error: { code: 'not_authorized', message: 'the command is for another authorization' } };
    }
    if (envelope.connectionGeneration !== generation) {
        return { outcome: 'failed', error: { code: 'connection_stale', message: 'the command is for an earlier panel connection' } };
    }
    if (envelope.epoch !== held.epoch) {
        return { outcome: 'failed', error: { code: 'stale_observation', message: 'the page changed since it was observed; observe it again' } };
    }
    if (envelope.sequence !== held.expectedSequence) {
        return { outcome: 'failed', error: { code: 'stale_observation', message: 'the command is out of sequence' } };
    }
    return undefined;
}
/**
 * Cap a command's own time allowance to what is left of its budget.
 *
 * The Host's deadline covers the whole call; a `wait` that runs for its full
 * requested timeout can outlive that deadline, at which point the Host has
 * already settled the call as an unknown outcome while the page keeps waiting.
 * The plan forbids renewing the budget, so the panel gives the page only what
 * remains, keeping a margin for the round trip that reports the result.
 * @param {object} op - the operation the Host dispatched.
 * @param {number} remainingMs - time left on the command budget.
 * @param {number} [marginMs] - time reserved to report the result.
 * @returns {object} the operation to run.
 */
function capToBudget(op, remainingMs, marginMs = 250) {
    const /** @type {any} */ operation = op;
    if (operation.kind !== 'wait')
        return op;
    const allowance = Math.max(0, Math.floor(remainingMs - marginMs));
    const requested = typeof operation.timeoutMs === 'number' ? operation.timeoutMs : allowance;
    return { ...operation, timeoutMs: Math.max(0, Math.min(requested, allowance)) };
}
/**
 * Name the invalidation event a document change represents.
 *
 * A navigation within the same origin replaces the document but keeps the
 * trust domain; a cross-origin navigation is the case that must not inherit the
 * previous authorization.
 * @param {string | undefined} before - the address the user authorized.
 * @param {string | undefined} after - the address now in the guest.
 * @returns {'same_origin_navigation' | 'cross_origin_navigation'} the event to report.
 */
function navigationEvent(before, after) {
    try {
        if (before !== undefined && after !== undefined && new URL(before).origin === new URL(after).origin) {
            return 'same_origin_navigation';
        }
    }
    catch {
        // An unparseable address cannot be shown to share an origin.
    }
    return 'cross_origin_navigation';
}
/**
 * Whether the panel may run page programs on this host.
 *
 * The Web carrier renders the Browser as a cross-origin sandboxed iframe, so
 * only the Desktop carrier with its product bridge can execute page programs.
 * @param {object} [carrier] - `globalThis.dshDesktop`, when present.
 * @returns {boolean} true when the Desktop bridge is available.
 */
function hostSupportsPageControl(carrier) {
    return /** @type {{ protocolVersion?: number }} */ (carrier ?? {})?.protocolVersion === 1;
}

// ---- src/import-rules.js ----
/** Beijing import facts and pure judgments, independent of navigation and I/O. */
// Code-owned safety policy; local definitions cannot override these values.
const IMPORT_ORIGIN = 'https://fuwu.rsj.beijing.gov.cn';
const IMPORT_DATA = Object.freeze({
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
const FILE_LIMIT = 10 * 1024 * 1024;
const BODY_LIMIT = 200_000;
const IMPORT_TABS = Object.freeze({ "add": "批量增员", "modify": "批量修改", "reduce": "批量减员" });
const IMPORT_PATHS = Object.freeze(IMPORT_DATA.checkPaths);
/** @typedef {'add' | 'modify' | 'reduce'} BatchKind */
/** @typedef {{ name: string, certificateNumber: string }} Person */
/** @typedef {{ kind: BatchKind, unitId: string, legalIdentity: string, firstRow: number, lastRow: number }} ImportScope */
/** @typedef {{ unitIds: string[], legalIdentities: string[] }} Identity */
/** @typedef {{ complete: boolean, fresh: boolean, accepted: Person[], rejected: Person[] }} Tables */
/** @typedef {{ status: number, body: string, complete: boolean, requestId: string, responseRequestId: string, method: string, url: string }} CheckResponse */
/** @typedef {{ requestCount: number, pending: number, interference: boolean, response?: CheckResponse, tables?: Tables, summary?: { total: number, success: number, failure: number } }} ImportFacts */
/** @param {unknown} value - JSON candidate. @returns {value is Record<string, unknown>} plain object. */
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
/** @param {string} value - identity token. @returns {string} normalized token. */
function identityToken(value) { return value.normalize('NFKC').trim().replace(/^\[|\]$/g, '').replace(/\s/g, '').toUpperCase(); }
/** @param {unknown} raw - user-entered scope. @returns {ImportScope} validated independent scope. */
function importScope(raw) {
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
function extractIdentity(raw) {
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
function judgeIdentity(actual, expected) {
    if (actual.unitIds.some(value => identityToken(value) !== expected.unitId) || actual.legalIdentities.some(value => identityToken(value) !== expected.legalIdentity))
        return 'mismatch';
    return actual.unitIds.length > 0 && actual.legalIdentities.length > 0 ? 'verified' : 'unverified';
}
/** @param {Person[]} people - private rows. @returns {Set<string> | undefined} unique complete personnel keys. */
function personKeys(people) {
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
function judgeImport(scope, input, facts) {
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

// ---- src/import-page.js ----
/** Fixed passive network observation and one-file assignment; never initiates requests or chooses a business step. */


/** @param {object | undefined} scope - Host-owned import restriction, absent for ordinary control. @returns {string} action restriction inside the common page prelude. */
function importActionPolicy(scope) {
    return String.raw `
    const importRestriction = ${JSON.stringify(scope ?? null)} || registry().importState?.scope;
    if (importRestriction) {
      if (location.origin !== ${JSON.stringify(IMPORT_ORIGIN)} || ACTION !== 'click') return {ok:false,error:{code:'not_operable',message:'the import scope permits only its named navigation actions'}};
      const control = element.closest('button,a,input,[role="button"],[role="tab"],.el-menu-item,.el-submenu__title') || element;
      const clean = value => String(value || '').replace(/\s/g,'');
      const descriptions = [textOf(control), control.getAttribute('aria-label'), control.getAttribute('title'), control.value].filter(Boolean).map(clean);
      const label = clean(textOf(element));
      if (control instanceof HTMLButtonElement && control.form && control.type !== 'button') return {ok:false,error:{code:'not_operable',message:'form submission is outside the import scope'}};
      if (control.getAttribute('formaction') || descriptions.some(text=>/提交|保存|送达|审核|删除|上传|申报/.test(text))) return {ok:false,error:{code:'not_operable',message:'business dispatch is outside the import scope'}};
      const allowed = importRestriction.workflow === "navigation" ? ${JSON.stringify(IMPORT_DATA.readNavigationLabels.slice(0, 3))} : [...${JSON.stringify(IMPORT_DATA.readNavigationLabels)},...${JSON.stringify(IMPORT_DATA.resultTabs)},${JSON.stringify(IMPORT_TABS)}[importRestriction.kind]];
      if (registry().importState?.selectedAt !== null && registry().importState?.selectedAt !== undefined && !registry().importState?.closed && ${JSON.stringify(IMPORT_DATA.resultTabs)}.includes(label)) return {ok:false,error:{code:'not_operable',message:'result tabs cannot manufacture a refresh during import verification'}};
      if (!allowed.includes(label) || descriptions.some(text=>text !== label)) {
        const box = control.closest('.el-message-box');
        const buttons = box ? Array.from(box.querySelectorAll('button,a,input,[role="button"]')).filter(visible) : [];
        const summary = box ? clean(box.textContent) : '';
        const dismissible = importRestriction.workflow !== "navigation" && box && /导入/.test(summary) && /(?:成功|失败|记录)/.test(summary)
          && buttons.length === 1 && buttons[0] === control && ['确定','关闭','Close'].includes(label)
          && control.type === 'button' && descriptions.every(text=>['确定','关闭','Close'].includes(text));
        if (!dismissible) return {ok:false,error:{code:'not_operable',message:'this action is outside the import scope'}};
      }
    }
  `;
}
/** @param {object} input - validated operation, owner and relative lifetime. @returns {string} self-contained fixed page program. */
function importProgram(input) {
    return String.raw `(function () {${prelude()}
    const input = ${JSON.stringify(input)};
    const origin = ${JSON.stringify(IMPORT_ORIGIN)};
    const paths = ${JSON.stringify(IMPORT_PATHS)};
    const tabs = ${JSON.stringify(IMPORT_TABS)};
    const knowledge = ${JSON.stringify(IMPORT_DATA)};
    const limit = ${BODY_LIMIT};
    const refusal = (code,message) => ({ok:false,error:{code,message}});
    let state = registry().importState;
    if (input.mode === 'dispose') {
      if (state && state.owner === input.owner) {state.dispose(); delete registry().importState;}
      return {ok:true,value:{cleanupFailed:!!state?.cleanupFailed}};
    }
    if (location.origin !== origin) return refusal('unsupported','Beijing import requires its exact portal origin');
    if (!state || state.owner !== input.owner) {
      if (state) state.dispose();
      const originals = {fetch:globalThis.fetch, open:globalThis.XMLHttpRequest?.prototype.open, send:globalThis.XMLHttpRequest?.prototype.send};
      state = {owner:input.owner,scope:input.scope,documentToken:documentToken(),closed:false,cleanupFailed:false,coverage:false,
        requests:[],resources:[],unitBodies:[],unitPending:0,selectedAt:null,fileGrantId:null,selectedNode:null,acceptedChange:-1,rejectedChange:-1,version:0,summary:null,summaryAt:-1,issue:false,expired:false,cache:null,listeners:[],timer:null,observer:null,resourceObserver:null};
      registry().importState = state;
      const owned = state;
      const native = fn => typeof fn === 'function' && Function.prototype.toString.call(fn).includes('[native code]');
      const endpoint = (url) => {try {const parsed=new URL(url,location.href);return parsed.origin===origin ? parsed.pathname : null;}catch{return null;}};
      const unitPath = url => {const path=endpoint(url)?.toLowerCase();return path && knowledge.unitPathSuffixes.some(suffix=>path.endsWith(suffix));};
      const checkPath = url => Object.values(paths).includes(endpoint(url));
      const remember = (method,url) => {
        if (owned.closed) return null;
        const unit = !!unitPath(url); const check = checkPath(url);
        if (!unit && !check) return null;
        if (owned.requests.length >= 1000) {owned.issue=true;return null;}
        const request={id:'request-'+owned.requests.length,method:String(method).toUpperCase(),url:new URL(url,location.href).href,unit,check,owned:owned.selectedAt!==null,startedAt:performance.now(),complete:false,status:0,body:'',failed:false};
        owned.requests.push(request);if(unit) owned.unitPending++;
        return request;
      };
      const finish = (request,status,body,complete,responseUrl) => {
        if (!request || owned.closed || request.finished) return;
        request.finished=true;
        request.responseUrl=responseUrl||'';request.status=status;request.complete=!!complete&&request.responseUrl===request.url;request.body=typeof body==='string'?body.slice(0,limit):'';
        if(request.unit){owned.unitPending--;if(status>=200&&status<300&&request.complete&&typeof body==='string'&&body.length<limit){if(owned.unitBodies.length>=64)owned.issue=true;else owned.unitBodies.push(body);}else owned.issue=true;}
        owned.snapshot();
      };
      const xhrInfo = new WeakMap();
      const wrappedOpen = function(method,url,...rest) {xhrInfo.set(this,{method,url:String(url)});return Reflect.apply(originals.open,this,[method,url,...rest]);};
      const wrappedSend = function(...args) {
        const info=xhrInfo.get(this);const request=info?remember(info.method,info.url):null;
        if(request){const target=this;const listener=()=>{try{finish(request,target.status,target.responseType===''||target.responseType==='text'?target.responseText:null,true,target.responseURL);}catch{finish(request,0,null,false);}};
          target.addEventListener('loadend',listener,{once:true});owned.listeners.push({target,listener});}
        try{return Reflect.apply(originals.send,this,args);}catch(error){if(request){request.failed=true;finish(request,0,null,false);}throw error;}
      };
      const wrappedFetch = function(...args) {
        let request=null;
        try{const [resource,options]=args;request=remember(options?.method||(resource instanceof Request?resource.method:'GET'),resource instanceof Request?resource.url:String(resource));}catch{owned.issue=true;}
        let promise;
        try{promise=Reflect.apply(originals.fetch,this,args);}catch(error){if(request)finish(request,0,null,false);throw error;}
        if(request) void promise.then(async response=>{
          if(owned.closed)return;
          const reader=response.clone().body?.getReader();
          if(!reader){finish(request,response.status,'',true,response.url);return;}
          const decoder=new TextDecoder();let body='';let complete=false;
          try{while(!owned.closed){const chunk=await reader.read();if(chunk.done){body+=decoder.decode();complete=body.length<limit;break;}body+=decoder.decode(chunk.value,{stream:true});if(body.length>=limit)break;}}
          finally{void reader.cancel().catch(()=>{});}
          finish(request,response.status,body,complete,response.url);
        },()=>finish(request,0,null,false)).catch(()=>{owned.issue=true;});
        return promise;
      };
      owned.hooksIntact = () => globalThis.fetch===wrappedFetch && globalThis.XMLHttpRequest.prototype.open===wrappedOpen && globalThis.XMLHttpRequest.prototype.send===wrappedSend;
      owned.dispose = () => {
        if(owned.closed)return;
        owned.closed=true;clearTimeout(owned.timer);owned.observer?.disconnect();owned.resourceObserver?.disconnect();
        for(const {target,listener} of owned.listeners)target.removeEventListener('loadend',listener);
        try{if(globalThis.fetch===wrappedFetch)globalThis.fetch=originals.fetch;else owned.cleanupFailed=true;
          if(originals.open){const proto=globalThis.XMLHttpRequest.prototype;if(proto.open===wrappedOpen)proto.open=originals.open;else owned.cleanupFailed=true;if(proto.send===wrappedSend)proto.send=originals.send;else owned.cleanupFailed=true;}}
        catch{owned.cleanupFailed=true;}
      };
      const clean = value=>String(value||'').replace(/\s/g,'');
      const classify = table=>{
        const headers=Array.from(table.querySelectorAll('.el-table__header th')).map(el=>clean(el.textContent));
        if(headers.includes(knowledge.failureHeader))return 'rejectedChange';
        if(headers.includes(knowledge.successHeader)&&!headers.includes(knowledge.excludedHeader))return 'acceptedChange';
        return null;
      };
      const summary = () => {
        const candidates=Array.from(document.querySelectorAll('.el-message,.el-message-box__message,.el-notification__content')).map(el=>clean(el.textContent)).filter(text=>text.includes('导入')&&/(?:成功|失败|记录)/.test(text));
        if(candidates.length!==1)return null;
        const text=candidates[0];const success=/(?:成功)(\d+)/.exec(text)||/(\d+)(?:条)?(?:记录)?成功/.exec(text);const failure=/(?:失败)(\d+)/.exec(text)||/(\d+)(?:条)?(?:记录)?失败/.exec(text);const total=/有(\d+)条记录/.exec(text)||/共(\d+)条/.exec(text);
        if(!success||!failure||!total)return null;
        return {total:Number(total[1]),success:Number(success[1]),failure:Number(failure[1])};
      };
      const tables = completion => {
        const all=Array.from(document.querySelectorAll('.el-table'));
        const accepted=all.filter(el=>classify(el)==='acceptedChange');const rejected=all.filter(el=>classify(el)==='rejectedChange');
        const result={fresh:owned.acceptedChange>completion&&owned.rejectedChange>completion,complete:false,accepted:[],rejected:[]};
        if(accepted.length!==1||rejected.length!==1||Array.from(document.querySelectorAll('.el-pagination .btn-next')).some(el=>!el.disabled&&!el.classList.contains('disabled'))
          || Array.from(document.querySelectorAll('.el-loading-mask')).some(visible))return result;
        const version=owned.version;
        for(const [kind,table] of [['accepted',accepted[0]],['rejected',rejected[0]]]){
          const headers=Array.from(table.querySelectorAll('.el-table__header th')).map(el=>clean(el.textContent));
          const names=headers.flatMap((h,i)=>h===knowledge.nameHeader?[i]:[]);const ids=headers.flatMap((h,i)=>knowledge.identityHeaders.includes(h)?[i]:[]);const reasons=headers.flatMap((h,i)=>h===knowledge.failureHeader?[i]:[]);
          if(names.length!==1||ids.length!==1||headers.some(h=>!h)||(kind==='rejected'&&reasons.length!==1))return result;
          const rows=Array.from(table.querySelectorAll('.el-table__body-wrapper tbody tr'));
          for(const row of rows){const cells=Array.from(row.querySelectorAll('td')).map(el=>(el.textContent||'').trim());if(cells.length!==headers.length)return result;
            const name=cells[names[0]];const certificateNumber=cells[ids[0]].trim().toUpperCase();if(!name||!/^\d{17}[\dX]$/.test(certificateNumber)||(kind==='rejected'&&!cells[reasons[0]]))return result;result[kind].push({name,certificateNumber});}
          if(!rows.length&&!table.querySelector('.el-table__empty-block'))return result;
        }
        result.complete=version===owned.version;return result;
      };
      owned.snapshot = () => {
        if(owned.cache)return owned.cache;
        const active=owned.requests.filter(r=>r.check&&r.owned);
        const response=active.length===1?active[0]:null;
        const resources=response?owned.resources.filter(r=>r.name===response.url&&r.startTime>=owned.selectedAt):[];
        const resource=resources.length===1?resources[0]:null;
        const completion=resource&&resource.responseEnd>resource.startTime?resource.responseEnd:null;
        const interference=owned.issue||owned.requests.some(r=>r.check&&!r.owned&&r.complete&&owned.selectedAt!==null)
          ||(owned.selectedAt!==null&&owned.resources.some(r=>r.startTime<owned.selectedAt&&r.responseEnd>=(completion??owned.selectedAt)))
          ||(owned.selectedAt!==null&&owned.resources.filter(r=>r.startTime>=owned.selectedAt).length!==active.length)
          ||resources.length>1;
        const snapshot={requestCount:active.length,pending:active.filter(r=>!r.complete).length,interference,
          ...(response?{response:{requestId:response.id,responseRequestId:response.id,method:response.method,url:response.responseUrl||response.url,status:response.status,complete:response.complete&&completion!==null,body:response.body}}:{}),
          ...(completion!==null?{tables:tables(completion)}:{}),...(owned.summary&&owned.summaryAt>owned.selectedAt?{summary:owned.summary}:{})};
        return snapshot;
      };
      try {
        if(!native(originals.fetch)||!native(originals.open)||!native(originals.send)||typeof PerformanceObserver!=='function')throw new Error('capture-unsupported');
        globalThis.fetch=wrappedFetch;globalThis.XMLHttpRequest.prototype.open=wrappedOpen;globalThis.XMLHttpRequest.prototype.send=wrappedSend;
        owned.observer=new MutationObserver(records=>{
          if(owned.closed||owned.selectedAt===null)return;
          for(const record of records){const element=record.target.nodeType===1?record.target:record.target.parentElement;
            const table=element?.closest('.el-table');const region=element?.closest('tbody,.el-table__empty-block');
            if(table&&region){const key=classify(table);if(key){owned[key]=performance.now();owned.version++;}}
            for(const added of record.addedNodes){if(added.nodeType!==1)continue;for(const candidate of [added,...added.querySelectorAll('.el-table')]){const t=candidate.matches('.el-table')?candidate:candidate.matches('tbody,.el-table__body-wrapper,.el-table__empty-block')?candidate.closest('.el-table'):null;const key=t?classify(t):null;if(key){owned[key]=performance.now();owned.version++;}}}
          }
          const selector='.el-message,.el-message-box__message,.el-notification__content';
          const summaryChanged=records.some(record=>{const el=record.target.nodeType===1?record.target:record.target.parentElement;return el?.closest(selector)||Array.from(record.addedNodes).some(node=>node.nodeType===1&&(node.matches(selector)||node.querySelector(selector)));});
          if(summaryChanged){const current=summary();if(current){owned.summary=current;owned.summaryAt=performance.now();}}
        });owned.observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
        owned.resourceObserver=new PerformanceObserver(list=>{if(owned.closed)return;for(const entry of list.getEntries()){if(checkPath(entry.name)){if(owned.resources.length>=1000)owned.issue=true;else owned.resources.push({name:entry.name,startTime:entry.startTime,responseEnd:entry.responseEnd});}}});
        owned.resourceObserver.observe({type:'resource',buffered:true});
        owned.coverage=true;
      } catch {owned.coverage=false;owned.issue=true;owned.dispose();}
      if(!owned.closed)owned.timer=setTimeout(()=>{owned.cache=owned.snapshot();owned.expired=true;owned.dispose();},input.windowMs);
    }
    if (state.documentToken !== documentToken()) return refusal('stale_observation','the import document changed');
    if (input.mode === 'set_file') {
      if(state.closed||!state.coverage||state.issue||state.fileGrantId!==null)return refusal('not_operable','the import window is unavailable or already consumed');
      if(!state.hooksIntact())return refusal('not_operable','the observation hook changed');
      if(input.target.documentToken!==documentToken())return refusal('stale_observation','the file target document changed');
      const target=elementOf(input.target.elementRef);
      const container=target?.closest('.el-upload');
      const candidates=container?Array.from(container.querySelectorAll('input.el-upload__input[type="file"]')):[];
      const all=Array.from(document.querySelectorAll('input.el-upload__input[type="file"]'));
      const file=input.file;
      const active=Array.from(document.querySelectorAll('[role="tab"],.el-tabs__item')).filter(el=>el.classList.contains('is-active')||el.getAttribute('aria-selected')==='true');
      if(!target||!operable(target)||textOf(target).replace(/\s/g,'')!==knowledge.uploadLabel||candidates.length!==1||all.length!==1||candidates[0]!==all[0]
        ||candidates[0].disabled||!active.some(el=>textOf(el).replace(/\s/g,'')===tabs[file.kind])||active.some(el=>Object.values(tabs).includes(textOf(el).replace(/\s/g,''))&&textOf(el).replace(/\s/g,'')!==tabs[file.kind]))return refusal('not_operable','the unique file input or active business tab is not proven');
      const unitIds=new Set();const legalIds=new Set();
      for(const text of state.unitBodies){try{const body=JSON.parse(text);if(!Array.isArray(body?.map?.data))continue;for(const row of body.map.data){for(const scope of [row,row?.unitDTO,row?.unitExtensionDTO,...(Array.isArray(row?.unitInsuranceDTOList)?row.unitInsuranceDTOList:[])]){if(!scope)continue;if(typeof scope.unitId==='string')unitIds.add(scope.unitId.trim().toUpperCase());for(const key of ['socialCreditCode','unifiedSocialCreditCode','uscc'])if(typeof scope[key]==='string')legalIds.add(scope[key].trim().toUpperCase());}}}catch{return refusal('not_operable','the unit observation is unreadable');}}
      if(state.unitPending!==0||unitIds.size===0||legalIds.size===0||[...unitIds].some(id=>id!==file.expectedIdentity.unitId)||[...legalIds].some(id=>id!==file.expectedIdentity.legalIdentity))return refusal('not_operable','both current identity anchors must match before selection');
      let bytes;
      try{const binary=atob(file.base64);bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));if(bytes.length!==file.bytes)throw new Error('size');}catch{return refusal('invalid_request','file encoding is invalid');}
      const node=candidates[0];const transfer=new DataTransfer();transfer.items.add(new File([bytes],file.name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      if(!node.isConnected||elementOf(input.target.elementRef)!==target||document.querySelectorAll('input.el-upload__input[type="file"]').length!==1||registry().importState!==state||state.closed)return refusal('revoked','file authorization changed before selection');
      state.fileGrantId=file.fileGrantId;state.selectedNode=node;state.selectedAt=performance.now();state.acceptedChange=-1;state.rejectedChange=-1;state.summary=null;state.summaryAt=-1;
      clearTimeout(state.timer);
      state.timer=setTimeout(()=>{state.cache=state.snapshot();state.expired=true;state.dispose();},input.windowMs);
      try{node.files=transfer.files;node.dispatchEvent(new Event('input',{bubbles:true,composed:true}));node.dispatchEvent(new Event('change',{bubbles:true,composed:true}));}catch{return refusal('unknown_outcome','file selection may have run');}
      return {ok:true,value:{action:'set_file',dispatched:true,fileGrantId:file.fileGrantId}};
    }
    const collected=state.snapshot();
    if(!state.closed&&collected.response?.complete&&collected.tables?.fresh&&collected.tables?.complete&&collected.summary){state.cache=collected;state.dispose();}
    const evidence={unitBodies:state.unitBodies,unitPending:state.unitPending,coverage:state.coverage,closed:state.closed,expired:state.expired,cleanupFailed:state.cleanupFailed,fileGrantId:state.fileGrantId,facts:collected};
    return {ok:true,value:{documentToken:documentToken(),privateImport:evidence}};
  })()`;
}

// ---- src/pagecode.js ----
/**
 * The fixed page-side programs this plugin executes inside the user's webview.
 *
 * There is no general script-execution tool: every page interaction runs one
 * of the closures below through `executeJavaScript`. Parameters are embedded as
 * JSON literals (never concatenated as source), and each program returns a
 * JSON-serializable value.
 *
 * Page-side state is one non-enumerable registry property holding the current
 * document token and the element references minted by the last observation.
 * References are therefore valid for exactly one observation: a later observe
 * rebuilds the registry, which is what makes a stale reference detectable
 * instead of silently pointing at whatever now occupies that position.
 *
 * @module @negentropy/dsh-browser-flow/pagecode
 */

/** Name of the page-side registry property. */
const REGISTRY = '__dshBrowserFlow';
/** Query value names whose values are never echoed back to the model. */
const SENSITIVE_QUERY_NAMES = Object.freeze([
    'token', 'access_token', 'id_token', 'refresh_token', 'code', 'key', 'api_key',
    'secret', 'client_secret', 'password', 'passwd', 'pwd', 'session', 'sessionid',
    'auth', 'authorization', 'sig', 'signature', 'credential', 'otp',
]);
/**
 * Runtime prelude shared by every program: registry access, reference minting,
 * visibility and operability tests, and the sensitive-value policy.
 *
 * It is a function body so each program stays one expression; the prelude never
 * reads or writes anything outside the registry property and the page's own DOM.
 * @returns {string} prelude source.
 */
function prelude() {
    return `
  const REGISTRY = ${JSON.stringify(REGISTRY)};
  const SENSITIVE_QUERY = ${JSON.stringify(SENSITIVE_QUERY_NAMES)};
  const registry = () => {
    const existing = Object.getOwnPropertyDescriptor(globalThis, REGISTRY);
    if (existing && existing.value && typeof existing.value === 'object') return existing.value;
    // Not frozen: the counter and the reference map are the mutable part of the
    // document registry. The property itself is non-enumerable and non-writable
    // so page code cannot replace it wholesale.
    const created = { documentToken: mintToken(), refs: new Map(), nextRef: 0 };
    Object.defineProperty(globalThis, REGISTRY, { value: created, configurable: true, enumerable: false, writable: false });
    return created;
  };
  const mintToken = () => {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  };
  const mintRef = (element) => {
    const state = registry();
    const ref = 'el-' + (state.nextRef++).toString(36);
    state.refs.set(ref, element);
    return ref;
  };
  const elementOf = (ref) => {
    const element = registry().refs.get(ref);
    return element && element.isConnected ? element : undefined;
  };
  const visible = (element) => {
    if (!element || !element.isConnected) return false;
    const style = globalThis.getComputedStyle ? getComputedStyle(element) : undefined;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const operable = (element) => {
    if (!visible(element)) return false;
    if (element.disabled === true) return false;
    if (element.getAttribute && element.getAttribute('aria-disabled') === 'true') return false;
    if (element.closest && element.closest('[inert]')) return false;
    return true;
  };
  const isPasswordField = (element) => element instanceof HTMLInputElement && element.type === 'password';
  const isHiddenField = (element) => element instanceof HTMLInputElement && element.type === 'hidden';
  const tagOf = (element) => (element.tagName || '').toLowerCase();
  const roleOf = (element) => element.getAttribute('role') || '';
  const labelOf = (element) => {
    const direct = element.getAttribute('aria-label');
    if (direct) return direct;
    const labelled = element.getAttribute('aria-labelledby');
    if (labelled) {
      const parts = labelled.split(/\\s+/).map(id => {
        const target = document.getElementById(id);
        return target ? (target.textContent || '').trim() : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      const labels = element.labels;
      if (labels && labels.length) return (labels[0].textContent || '').trim();
      return element.getAttribute('name') || '';
    }
    return '';
  };
  const textOf = (element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return '';
    if (element instanceof HTMLSelectElement) {
      const option = element.options[element.selectedIndex];
      return option ? (option.textContent || '').trim() : '';
    }
    return (element.innerText !== undefined ? element.innerText : element.textContent || '').replace(/\\s+/g, ' ').trim();
  };
  const valueOf = (element) => {
    if (isPasswordField(element) || isHiddenField(element)) return { redacted: true };
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return { value: element.value };
    if (element instanceof HTMLSelectElement) return { value: element.value, selected: element.selectedIndex };
    if (element.isContentEditable) return { value: (element.innerText || '').trim() };
    return {};
  };
  const stateOf = (element) => {
    if (element instanceof HTMLInputElement) {
      return element.type === 'checkbox' || element.type === 'radio'
        ? { checked: element.checked, ...(isPasswordField(element) || isHiddenField(element) ? {} : { value: element.value }) }
        : isPasswordField(element) || isHiddenField(element) ? {} : { value: element.value };
    }
    if (element instanceof HTMLTextAreaElement) return isPasswordField(element) ? {} : { value: element.value };
    if (element instanceof HTMLSelectElement) return { value: element.value, selected: element.selectedIndex };
    if (element.isContentEditable) return { value: (element.innerText || '').trim() };
    return {};
  };
  const describe = (element, ref) => ({
    elementRef: ref,
    tag: tagOf(element),
    role: roleOf(element),
    label: labelOf(element),
    text: textOf(element).slice(0, 500),
    ...valueOf(element),
    ...(element instanceof HTMLInputElement ? { type: element.type } : {}),
    ...(element instanceof HTMLAnchorElement ? { href: safeUrl(element.href) } : {}),
    visible: visible(element),
    operable: operable(element),
    rect: (() => { const r = element.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })(),
  });
  const safeUrl = (value) => {
    try {
      const url = new URL(value);
      for (const name of [...url.searchParams.keys()]) {
        if (SENSITIVE_QUERY.some(sensitive => name.toLowerCase() === sensitive)) url.searchParams.set(name, '[redacted]');
      }
      url.username = '';
      url.password = '';
      return url.href;
    } catch { return '[invalid-url]'; }
  };
  const documentToken = () => registry().documentToken;
  `;
}
/**
 * Program that reports page identity without touching content.
 *
 * The token is minted once per document; the panel uses it to notice a reload
 * or a replaced document.
 * @returns {string} self-contained program source.
 */
function identityProgram() {
    return `(function () {${prelude()}
    return {
      ok: true,
      value: {
        documentToken: documentToken(),
        url: safeUrl(location.href),
        title: (document.title || '').slice(0, 300),
        readyState: document.readyState,
      },
    };
  })()`;
}
/**
 * Program that collects a bounded text observation of the document.
 * @param {number} maxChars - character budget for the returned text.
 * @param {number} maxNodes - node budget for described elements.
 * @returns {string} self-contained program source.
 */
function observeProgram(maxChars, maxNodes) {
    return `(function () {${prelude()}
    const MAX_CHARS = ${JSON.stringify(maxChars)};
    const MAX_NODES = ${JSON.stringify(maxNodes)};
    // Rebuilding the map is what makes earlier element references stale. The
    // counter is deliberately not reset: reusing names would hand a caller's
    // old el-0 reference to whatever element happens to sort first this time, and the
    // document token is unchanged within a document, so that lookup would
    // succeed and act on the wrong element.
    const state = registry();
    state.refs.clear();
    const roots = [document.body || document.documentElement];
    const candidates = [];
    const interactive = 'a[href],button,input,select,textarea,[role],[contenteditable=""],[contenteditable="true"],[tabindex]';
    for (const root of roots) {
      if (!root) continue;
      for (const element of root.querySelectorAll('*')) {
        if (candidates.length >= MAX_NODES) break;
        if (element.closest('script,style,noscript,template')) continue;
        if (element === document.documentElement) continue;
        const hasText = (element.children.length === 0) && textOf(element).length > 0;
        const matches = element.matches(interactive);
        if (!hasText && !matches) continue;
        if (!visible(element)) continue;
        candidates.push(element);
      }
    }
    const nodes = [];
    let used = 0;
    let truncated = false;
    for (const element of candidates) {
      const ref = mintRef(element);
      const entry = describe(element, ref);
      const cost = (entry.text || '').length + (entry.label || '').length + 40;
      if (used + cost > MAX_CHARS) { truncated = true; break; }
      used += cost;
      nodes.push(entry);
    }
    const text = candidates.slice(0, nodes.length).map(element => {
      const entry = textOf(element);
      return entry ? entry : '';
    }).filter(Boolean).join('\\n').slice(0, MAX_CHARS);
    return {
      ok: true,
      value: {
        documentToken: documentToken(),
        url: safeUrl(location.href),
        title: (document.title || '').slice(0, 300),
        readyState: document.readyState,
        nodes,
        text,
        truncated,
      },
    };
  })()`;
}
/**
 * Program that locates elements matching a bounded query.
 *
 * Matching is over visible text, an explicit attribute, or the ARIA role, and
 * never over generated selectors: the caller cannot express arbitrary CSS.
 * Text queries return the deepest visible matches; ancestors do not consume
 * the match limit or make a single target ambiguous.
 * Ambiguity is determined before truncation, including when the limit is one.
 * @param {{ by: 'text' | 'attr' | 'role', value: string, name?: string }} query - query.
 * @param {number} limit - maximum matches.
 * @returns {string} self-contained program source.
 */
function findProgram(query, limit) {
    return `(function () {${prelude()}
    const QUERY = ${JSON.stringify(query)};
    const LIMIT = ${JSON.stringify(limit)};
    const state = registry();
    const candidates = new Set();
    const matchingAncestors = new Set();
    const matches = [];
    for (const element of document.querySelectorAll('*')) {
      if (QUERY.by !== 'text' && candidates.size >= Math.max(2, LIMIT)) break;
      if (element.closest('script,style,noscript,template')) continue;
      if (!visible(element)) continue;
      let hit = false;
      if (QUERY.by === 'text') {
        const text = textOf(element);
        hit = text.length > 0 && text.includes(QUERY.value);
      } else if (QUERY.by === 'attr') {
        hit = element.getAttribute(QUERY.name) === QUERY.value;
      } else {
        hit = roleOf(element) === QUERY.value || tagOf(element) === QUERY.value;
      }
      if (!hit) continue;
      candidates.add(element);
      if (QUERY.by === 'text') {
        for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
          matchingAncestors.add(ancestor);
        }
      }
    }
    const distinct = Array.from(candidates).filter(element => !matchingAncestors.has(element));
    for (const element of distinct) {
      if (matches.length >= LIMIT) break;
      const ref = mintRef(element);
      state.refs.set(ref, element);
      matches.push(describe(element, ref));
    }
    return {
      ok: true,
      value: {
        documentToken: documentToken(),
        matches,
        ambiguous: distinct.length > 1,
        limitReached: matches.length >= LIMIT,
      },
    };
  })()`;
}
/**
 * Program that dispatches one of the four supported actions on a referenced element.
 *
 * Every action re-checks the document token, the reference, the match, the
 * visibility and the operability before it touches the page. There is no
 * retry inside the page and no fallback to another element.
 * @param {object} input - action inputs.
 * @param {string} input.documentToken - token the reference was minted under.
 * @param {string} input.elementRef - element reference.
 * @param {'click' | 'type' | 'select' | 'check'} input.action - action.
 * @param {string} [input.value] - replacement text or option value.
 * @param {boolean} [input.checked] - explicit checked state.
 * @param {object} [input.pagePolicy] - trusted task site policy.
 * @param {object} [input.importScope] - scoped import restrictions; absent uses any current document restriction.
 * @returns {string} self-contained program source.
 */
function actProgram(input) {
    return `(function () {${prelude()}
    const DOCUMENT_TOKEN = ${JSON.stringify(input.documentToken)};
    const ELEMENT_REF = ${JSON.stringify(input.elementRef)};
    const ACTION = ${JSON.stringify(input.action)};
    const VALUE = ${JSON.stringify(input.value ?? null)};
    const CHECKED = ${JSON.stringify(input.checked ?? null)};
    if (documentToken() !== DOCUMENT_TOKEN) {
      return { ok: false, error: { code: 'stale_observation', message: 'the document changed since the observation; observe again' } };
    }
    const element = elementOf(ELEMENT_REF);
    if (element === undefined) {
      return { ok: false, error: { code: 'stale_observation', message: 'the referenced element is gone; observe again' } };
    }
    if (isPasswordField(element)) {
      return { ok: false, error: { code: 'unsupported', message: 'password fields are not operated by this plugin' } };
    }
    if (!visible(element)) {
      return { ok: false, error: { code: 'not_operable', message: 'the referenced element is not visible' } };
    }
    ${importActionPolicy(input.pagePolicy ?? input.importScope)}
    if (ACTION === 'click') {
      if (!operable(element)) {
        return { ok: false, error: { code: 'not_operable', message: 'the referenced element is disabled or inert' } };
      }
      element.focus({ preventScroll: true });
      element.click();
      return { ok: true, value: { action: 'click', elementRef: ELEMENT_REF, dispatched: true } };
    }
    if (ACTION === 'type') {
      const isField = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
      if (!isField && !element.isContentEditable) {
        return { ok: false, error: { code: 'unsupported', message: 'this element does not accept text input' } };
      }
      if (!operable(element)) {
        return { ok: false, error: { code: 'not_operable', message: 'the referenced field is disabled or read-only' } };
      }
      if (element.readOnly === true) {
        return { ok: false, error: { code: 'not_operable', message: 'the referenced field is read-only' } };
      }
      element.focus({ preventScroll: true });
      if (isField) {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value');
        if (setter && setter.set) setter.set.call(element, VALUE);
        else element.value = VALUE;
      } else {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = globalThis.getSelection();
        if (selection) { selection.removeAllRanges(); selection.addRange(range); }
        let inserted = false;
        if (typeof document.execCommand === 'function') {
          try { inserted = document.execCommand('insertText', false, VALUE); } catch { inserted = false; }
        }
        if (!inserted) {
          element.textContent = VALUE;
          const range2 = document.createRange();
          range2.selectNodeContents(element);
          const selection2 = globalThis.getSelection();
          if (selection2) { selection2.removeAllRanges(); selection2.addRange(range2); }
        }
      }
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: { action: 'type', elementRef: ELEMENT_REF, dispatched: true, replaced: true, length: VALUE.length } };
    }
    if (ACTION === 'select') {
      if (!(element instanceof HTMLSelectElement)) {
        return { ok: false, error: { code: 'unsupported', message: 'the referenced element is not a select control' } };
      }
      if (!operable(element)) {
        return { ok: false, error: { code: 'not_operable', message: 'the select control is disabled' } };
      }
      const option = Array.from(element.options).find(candidate => candidate.value === VALUE || (candidate.textContent || '').trim() === VALUE);
      if (option === undefined) {
        return { ok: false, error: { code: 'not_found', message: 'no option matches the requested value' } };
      }
      element.focus({ preventScroll: true });
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      if (setter && setter.set) setter.set.call(element, option.value);
      else element.value = option.value;
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: { action: 'select', elementRef: ELEMENT_REF, dispatched: true, selected: option.value } };
    }
    if (ACTION === 'check') {
      const boxy = element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio');
      const aria = element.getAttribute('aria-checked');
      if (!boxy && aria === null) {
        return { ok: false, error: { code: 'unsupported', message: 'the referenced element has no checkable state' } };
      }
      if (!operable(element)) {
        return { ok: false, error: { code: 'not_operable', message: 'the referenced control is disabled' } };
      }
      element.focus({ preventScroll: true });
      if (boxy) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
        if (setter && setter.set) setter.set.call(element, CHECKED);
        else element.checked = CHECKED;
      } else {
        element.setAttribute('aria-checked', CHECKED ? 'true' : 'false');
      }
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: { action: 'check', elementRef: ELEMENT_REF, dispatched: true, checked: CHECKED } };
    }
    return { ok: false, error: { code: 'unsupported', message: 'unknown action' } };
  })()`;
}
/**
 * Program that waits for one listed DOM condition and then returns.
 *
 * The wait is bounded in-page and re-checks cancellation through the caller's
 * deadline: the client stops reading the result when the command window closes,
 * and the page stops waiting on its own timeout.
 * @param {object} input - wait inputs.
 * @param {'present' | 'absent' | 'text'} input.condition - condition.
 * @param {{ documentToken: string, elementRef: string }} input.target - target element.
 * @param {string} [input.text] - required text for the `text` condition.
 * @param {number} input.timeoutMs - page-side bound.
 * @returns {string} self-contained program source.
 */
function waitProgram(input) {
    return `(function () {${prelude()}
    const DOCUMENT_TOKEN = ${JSON.stringify(input.target.documentToken)};
    const ELEMENT_REF = ${JSON.stringify(input.target.elementRef)};
    const CONDITION = ${JSON.stringify(input.condition)};
    const TEXT = ${JSON.stringify(input.text ?? '')};
    const TIMEOUT = ${JSON.stringify(input.timeoutMs)};
    if (documentToken() !== DOCUMENT_TOKEN) {
      return { ok: false, error: { code: 'stale_observation', message: 'the document changed since the observation; observe again' } };
    }
    const evaluate = () => {
      const element = elementOf(ELEMENT_REF);
      if (CONDITION === 'absent') return element === undefined || !visible(element);
      if (element === undefined) return false;
      if (CONDITION === 'present') return visible(element);
      return textOf(element).includes(TEXT);
    };
    if (evaluate()) {
      return { ok: true, value: { condition: CONDITION, satisfied: true, waitedMs: 0 } };
    }
    const started = Date.now();
    return new Promise(resolve => {
      const finish = (satisfied, timedOut) => {
        observer.disconnect();
        clearTimeout(timer);
        resolve({ ok: true, value: { condition: CONDITION, satisfied, timedOut, waitedMs: Date.now() - started } });
      };
      const observer = new MutationObserver(() => { if (evaluate()) finish(true, false); });
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      const timer = setTimeout(() => finish(evaluate(), true), Math.max(0, TIMEOUT));
    });
  })()`;
}
/**
 * Redact a URL for display and logging.
 *
 * Query parameter values whose names look sensitive are replaced; user
 * information never survives.
 * @param {string} raw - URL as reported by the page.
 * @returns {string} redacted URL, or a placeholder when it cannot be parsed.
 */
function redactUrl(raw) {
    try {
        const url = new URL(raw);
        for (const name of [...url.searchParams.keys()]) {
            if (SENSITIVE_QUERY_NAMES.includes(name.toLowerCase()))
                url.searchParams.set(name, '[redacted]');
        }
        url.username = '';
        url.password = '';
        return url.href;
    }
    catch {
        return '[invalid-url]';
    }
}
/**
 * Whether a URL query carries a value this plugin must not echo.
 * @param {string} raw - URL.
 * @returns {boolean} true when at least one sensitive parameter is present.
 */
function hasSensitiveQuery(raw) {
    try {
        const url = new URL(raw);
        return [...url.searchParams.keys()].some(name => SENSITIVE_QUERY_NAMES.includes(name.toLowerCase()));
    }
    catch {
        return false;
    }
}

// ---- src/protocol.js ----
/**
 * Wire vocabulary and boundary validation shared by the Host half and the
 * Client bundle.
 *
 * This module is intentionally dependency-free and side-effect free: the Host
 * imports it as ESM, and the Client bundle inlines the same source text at
 * build time, so both ends validate with one implementation instead of two
 * hand-copied rule sets.
 *
 * Everything arriving from the other process is untrusted: every message is
 * validated structurally before any state changes, and an invalid message
 * never partially applies.
 *
 * @module @negentropy/dsh-browser-flow/protocol
 */

/** Protocol revision. A mismatch fails the handshake loudly instead of guessing. */
const PROTOCOL_VERSION = 3;
/** Base path of this plugin's Host routes on the existing `/api` connection. */
const ROUTE_PREFIX = '/api/browser-flow';
/** Longest accepted opaque token, in characters. */
const MAX_TOKEN = 200;
/** Longest accepted free-text field (title, url, error detail), in characters. */
const MAX_TEXT = 4000;
/** Largest accepted element/observation payload, in characters. */
const MAX_PAYLOAD = 400_000;
/** Errors this plugin reports to the model and the panel. */
const ERROR_CODES = Object.freeze([
    'not_authorized',
    'task_not_bound',
    'task_read_only',
    'awaiting_user',
    'task_scope_mismatch',
    'task_write_blocked',
    'task_unavailable',
    'task_storage_failed',
    'task_bound',
    'task_busy',
    'definition_unavailable',
    'no_live_agent',
    'agent_mismatch',
    'agent_replaced',
    'page_unavailable',
    'page_replaced',
    'stale_observation',
    'ambiguous_match',
    'not_found',
    'not_operable',
    'unsupported',
    'protocol_violation',
    'connection_stale',
    'queue_full',
    'deadline_exceeded',
    'unknown_outcome',
    'revoked',
    'invalid_request',
    'internal',
]);
/** @typedef {typeof ERROR_CODES[number]} ErrorCode */
/** Error codes that mean "the action did not run and can be retried after re-observing". */
const RETRYABLE_CODES = Object.freeze([
    'stale_observation',
    'page_replaced',
    'ambiguous_match',
    'not_found',
    'not_operable',
    'queue_full',
    'deadline_exceeded',
]);
/**
 * Whether a failure code may be retried after a fresh observation.
 * `unknown_outcome` is deliberately excluded: a write whose outcome is unknown
 * must never be re-sent automatically.
 * @param {string} code - failure code.
 * @returns {boolean} true when a retry after re-observing is meaningful.
 */
function isRetryable(code) {
    return RETRYABLE_CODES.includes(code);
}
/**
 * Build a structured failure payload.
 * @param {ErrorCode} code - stable failure category.
 * @param {string} message - human-actionable explanation without page secrets.
 * @param {Record<string, unknown>} [details] - extra structured facts.
 * @returns {{ ok: false, error: { code: string, message: string, details?: Record<string, unknown> } }} failure.
 */
function failure(code, message, details) {
    /** @type {{ code: string, message: string, details?: Record<string, unknown> }} */
    const error = { code, message };
    if (details !== undefined)
        error.details = details;
    return { ok: false, error };
}
/**
 * Build a structured success payload.
 * @param {unknown} value - canonical result.
 * @returns {{ ok: true, value: unknown }} success.
 */
function success(value) {
    return { ok: true, value };
}
/**
 * Whether a value is a plain JSON object.
 *
 * Declared as a type predicate so the validators below narrow their inputs: each
 * one starts from `unknown` and then reads named fields off the record.
 * @param {unknown} value - candidate.
 * @returns {value is Record<string, unknown>} whether it is a plain object.
 */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * Read a required string field with a length bound.
 * @param {Record<string, unknown>} row - source object.
 * @param {string} key - field name.
 * @param {number} [max] - maximum accepted length.
 * @returns {string | undefined} the value, or undefined when absent/invalid.
 */
function readString(row, key, max = MAX_TEXT) {
    const value = row[key];
    return typeof value === 'string' && value.length <= max ? value : undefined;
}
/**
 * Read an optional string field with a length bound.
 * @param {Record<string, unknown>} row - source object.
 * @param {string} key - field name.
 * @param {number} [max] - maximum accepted length.
 * @returns {string | undefined} the value when it is a bounded string.
 */
function readOptionalString(row, key, max = MAX_TEXT) {
    return row[key] === undefined ? undefined : readString(row, key, max);
}
/**
 * Read a required non-negative safe integer field.
 * @param {Record<string, unknown>} row - source object.
 * @param {string} key - field name.
 * @returns {number | undefined} the value, or undefined when absent/invalid.
 */
function readCount(row, key) {
    const value = row[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
/**
 * Read a boolean field.
 * @param {Record<string, unknown>} row - source object.
 * @param {string} key - field name.
 * @returns {boolean | undefined} the value, or undefined when absent/not boolean.
 */
function readBoolean(row, key) {
    const value = row[key];
    return typeof value === 'boolean' ? value : undefined;
}
/** Kinds of page operations the plugin can dispatch. */
const OP_KINDS = Object.freeze(['observe', 'find', 'act', 'wait']);
/** Action kinds inside an `act` operation. */
const ACTIONS = Object.freeze(['click', 'type', 'select', 'check', 'set_file']);
/** Wait condition kinds. */
const WAIT_CONDITIONS = Object.freeze(['present', 'absent', 'text']);
/**
 * Validate one Host → Client command envelope.
 *
 * The envelope is the only thing the Client executes, so every field is
 * checked here and nothing is coerced.
 * @param {unknown} value - candidate command.
 * @returns {{ ok: true, command: Record<string, unknown> } | { ok: false, reason: string }} verdict.
 */
function validateCommand(value) {
    if (!isRecord(value))
        return { ok: false, reason: 'command must be an object' };
    const kind = readString(value, 'kind');
    if (kind !== 'command')
        return { ok: false, reason: 'kind must be "command"' };
    if (value.protocolVersion !== PROTOCOL_VERSION || !validRunScope(value.task))
        return { ok: false, reason: 'protocol v3 and complete task/run scope are required' };
    const id = readString(value, 'id', MAX_TOKEN);
    if (id === undefined || id.length === 0)
        return { ok: false, reason: 'id is required' };
    const leaseId = readString(value, 'leaseId', MAX_TOKEN);
    if (leaseId === undefined || leaseId.length === 0)
        return { ok: false, reason: 'leaseId is required' };
    const connectionGeneration = readCount(value, 'connectionGeneration');
    if (connectionGeneration === undefined)
        return { ok: false, reason: 'connectionGeneration is required' };
    const epoch = readCount(value, 'epoch');
    if (epoch === undefined)
        return { ok: false, reason: 'epoch is required' };
    const sequence = readCount(value, 'sequence');
    if (sequence === undefined)
        return { ok: false, reason: 'sequence is required' };
    const deadlineAt = value.deadlineAt;
    if (typeof deadlineAt !== 'number' || !Number.isFinite(deadlineAt) || deadlineAt < 0)
        return { ok: false, reason: 'deadlineAt is required' };
    const op = value.op;
    if (!isRecord(op))
        return { ok: false, reason: 'op is required' };
    const opKind = readString(op, 'kind');
    if (opKind === undefined || !OP_KINDS.includes(opKind))
        return { ok: false, reason: 'op.kind is unknown' };
    const validatedOp = validateOp(opKind, op);
    if (!validatedOp.ok)
        return { ok: false, reason: validatedOp.reason };
    const extended = validateImportExtension(op);
    if (!extended.ok)
        return extended;
    return {
        ok: true,
        command: {
            kind: 'command', protocolVersion: PROTOCOL_VERSION, task: { ...value.task }, id, leaseId, connectionGeneration, epoch, sequence, deadlineAt, op: { ...validatedOp.op, ...extended.fields },
        },
    };
}
/** @param {Record<string, unknown>} op - wire operation. @returns {{ok: true, fields: Record<string,unknown>} | {ok: false, reason: string}} bounded import metadata. */
function validateImportExtension(op) {
    /** @type {Record<string,unknown>} */ const fields = {};
    if (op.pagePolicy !== undefined) {
        const policy = op.pagePolicy;
        if (!isRecord(policy) || policy.adapter !== 'bjrsj' || !['navigation', 'import'].includes(String(policy.workflow)) || Object.keys(policy).some(key => !['adapter', 'workflow', 'kind'].includes(key)) || (policy.kind !== undefined && !['add', 'modify', 'reduce'].includes(String(policy.kind))))
            return { ok: false, reason: 'unsupported site action policy' };
        fields.pagePolicy = { ...policy };
    }
    const required = op.action === 'set_file' || op.view === 'bjrsj_import';
    if (op.importScope !== undefined || required) {
        const scope = op.importScope;
        if (!isRecord(scope) || typeof scope.kind !== 'string' || !['add', 'modify', 'reduce'].includes(scope.kind) || Object.keys(scope).length !== 1
            || typeof op.importOwner !== 'string' || !op.importOwner || op.importOwner.length > 500
            || typeof op.windowMs !== 'number' || !Number.isSafeInteger(op.windowMs) || op.windowMs < 100 || op.windowMs > 900_000)
            return { ok: false, reason: 'import scope, owner and window are required' };
        fields.importScope = { kind: scope.kind };
        fields.importOwner = op.importOwner;
        fields.windowMs = op.windowMs;
    }
    if (op.view !== undefined) {
        if (op.kind !== 'observe' || op.view !== 'bjrsj_import')
            return { ok: false, reason: 'observe view is unknown' };
        fields.view = op.view;
    }
    if (op.action === 'set_file') {
        const file = op.file;
        if (!isRecord(file) || Object.keys(file).some(key => !['fileGrantId', 'name', 'expectedIdentity', 'sha256', 'base64', 'bytes', 'kind'].includes(key))
            || typeof file.fileGrantId !== 'string' || !file.fileGrantId || file.fileGrantId.length > MAX_TOKEN
            || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)
            || typeof file.name !== 'string' || !file.name || file.name.length > 255 || /[\\/\x00-\x1f]/.test(file.name)
            || !isRecord(file.expectedIdentity) || typeof file.expectedIdentity.unitId !== 'string' || !/^[A-Z0-9-]{1,64}$/.test(file.expectedIdentity.unitId)
            || typeof file.expectedIdentity.legalIdentity !== 'string' || !/^[A-Z0-9]{18}$/.test(file.expectedIdentity.legalIdentity)
            || typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 10 * 1024 * 1024
            || typeof file.base64 !== 'string' || file.base64.length !== 4 * Math.ceil(file.bytes / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)
            || file.kind !== /** @type {Record<string,unknown>} */ (fields.importScope).kind)
            return { ok: false, reason: 'file envelope is invalid or exceeds its own limit' };
        const padding = file.bytes % 3 === 1 ? '==' : file.bytes % 3 === 2 ? '=' : '';
        if ((file.base64.match(/=*$/)?.[0] ?? '') !== padding)
            return { ok: false, reason: 'file encoding length mismatch' };
        fields.file = { ...file };
    }
    return { ok: true, fields };
}
/**
 * Validate the operation payload carried by one command.
 * @param {string} kind - operation kind.
 * @param {Record<string, unknown>} op - candidate operation.
 * @returns {{ ok: true, op: Record<string, unknown> } | { ok: false, reason: string }} verdict.
 */
function validateOp(kind, op) {
    if (kind === 'observe') {
        const maxChars = readCount(op, 'maxChars');
        const maxNodes = readCount(op, 'maxNodes');
        if (maxChars === undefined || maxNodes === undefined)
            return { ok: false, reason: 'observe bounds are required' };
        return { ok: true, op: { kind, maxChars, maxNodes } };
    }
    if (kind === 'find') {
        const query = isRecord(op.query) ? op.query : undefined;
        if (query === undefined)
            return { ok: false, reason: 'find.query is required' };
        const by = readString(query, 'by');
        if (by !== 'text' && by !== 'attr' && by !== 'role')
            return { ok: false, reason: 'find.query.by is unknown' };
        const text = readString(query, 'value', MAX_TEXT);
        if (text === undefined || text.length === 0)
            return { ok: false, reason: 'find.query.value is required' };
        const name = readOptionalString(query, 'name', MAX_TOKEN);
        if (by === 'attr' && name === undefined)
            return { ok: false, reason: 'find.query.name is required for attr' };
        const limit = readCount(op, 'limit');
        if (limit === undefined)
            return { ok: false, reason: 'find.limit is required' };
        return { ok: true, op: { kind, query: { by, value: text, ...(name === undefined ? {} : { name }) }, limit } };
    }
    if (kind === 'wait') {
        const condition = readString(op, 'condition');
        if (condition === undefined || !WAIT_CONDITIONS.includes(condition))
            return { ok: false, reason: 'wait.condition is unknown' };
        const target = op.target;
        const validatedTarget = validateTarget(target);
        if (!validatedTarget.ok)
            return { ok: false, reason: validatedTarget.reason };
        const text = readOptionalString(op, 'text', MAX_TEXT);
        if (condition === 'text' && (text === undefined || text.length === 0))
            return { ok: false, reason: 'wait.text is required' };
        const timeoutMs = readCount(op, 'timeoutMs');
        if (timeoutMs === undefined)
            return { ok: false, reason: 'wait.timeoutMs is required' };
        return {
            ok: true,
            op: {
                kind, condition, target: validatedTarget.target, timeoutMs,
                ...(condition === 'text' ? { text } : {}),
            },
        };
    }
    if (kind === 'act') {
        const action = readString(op, 'action');
        if (action === undefined || !ACTIONS.includes(action))
            return { ok: false, reason: 'act.action is unknown' };
        const target = validateTarget(op.target);
        if (!target.ok)
            return { ok: false, reason: target.reason };
        const value = readOptionalString(op, 'value', MAX_TEXT);
        if (action === 'type' && (value === undefined || value.length === 0))
            return { ok: false, reason: 'act.value is required for type' };
        if (action === 'select' && (value === undefined || value.length === 0))
            return { ok: false, reason: 'act.value is required for select' };
        if (action === 'check' && typeof op.checked !== 'boolean')
            return { ok: false, reason: 'act.checked is required for check' };
        if (action === 'click' && (value !== undefined || op.checked !== undefined)) {
            return { ok: false, reason: 'click takes no value or checked' };
        }
        /** @type {Record<string, unknown>} */
        const result = { kind, action, target: target.target };
        if (value !== undefined && action !== 'click')
            result.value = value;
        if (action === 'check')
            result.checked = op.checked;
        return { ok: true, op: result };
    }
    return { ok: false, reason: 'op.kind is unknown' };
}
/**
 * Validate one element target reference.
 *
 * A target names either a document-scoped element reference produced by an
 * earlier observation (`elementRef`) or a fresh selector for `find`-less use.
 * Both forms are bounded and never interpreted as code.
 * @param {unknown} value - candidate target.
 * @returns {{ ok: true, target: Record<string, unknown> } | { ok: false, reason: string }} verdict.
 */
function validateTarget(value) {
    if (!isRecord(value))
        return { ok: false, reason: 'target is required' };
    const documentToken = readString(value, 'documentToken', MAX_TOKEN);
    if (documentToken === undefined || documentToken.length === 0)
        return { ok: false, reason: 'target.documentToken is required' };
    const elementRef = readString(value, 'elementRef', MAX_TOKEN);
    if (elementRef === undefined || elementRef.length === 0)
        return { ok: false, reason: 'target.elementRef is required' };
    return { ok: true, target: { documentToken, elementRef } };
}
/**
 * Validate one Client → Host result envelope.
 * @param {unknown} value - candidate result.
 * @returns {{ ok: true, result: Record<string, unknown> } | { ok: false, reason: string }} verdict.
 */
function validateResult(value) {
    if (!isRecord(value))
        return { ok: false, reason: 'result must be an object' };
    if (readString(value, 'kind') !== 'result')
        return { ok: false, reason: 'kind must be "result"' };
    if (value.protocolVersion !== PROTOCOL_VERSION || !validRunScope(value.task))
        return { ok: false, reason: 'protocol v3 and complete task/run scope are required' };
    const id = readString(value, 'id', MAX_TOKEN);
    if (id === undefined || id.length === 0)
        return { ok: false, reason: 'id is required' };
    const leaseId = readString(value, 'leaseId', MAX_TOKEN);
    if (leaseId === undefined || leaseId.length === 0)
        return { ok: false, reason: 'leaseId is required' };
    const connectionGeneration = readCount(value, 'connectionGeneration');
    if (connectionGeneration === undefined)
        return { ok: false, reason: 'connectionGeneration is required' };
    const epoch = readCount(value, 'epoch');
    if (epoch === undefined)
        return { ok: false, reason: 'epoch is required' };
    const sequence = readCount(value, 'sequence');
    if (sequence === undefined)
        return { ok: false, reason: 'sequence is required' };
    const outcome = readString(value, 'outcome');
    if (outcome !== 'ok' && outcome !== 'failed' && outcome !== 'dropped' && outcome !== 'unknown_outcome') {
        return { ok: false, reason: 'outcome is unknown' };
    }
    if (outcome === 'failed') {
        const error = value.error;
        if (!isRecord(error))
            return { ok: false, reason: 'failed result requires error' };
        const code = readString(error, 'code', MAX_TOKEN);
        const message = readString(error, 'message', MAX_TEXT);
        if (code === undefined || !ERROR_CODES.includes(code))
            return { ok: false, reason: 'failed result has unknown code' };
        if (message === undefined)
            return { ok: false, reason: 'failed result requires message' };
    }
    const payload = value.payload;
    if (payload !== undefined && !isRecord(payload))
        return { ok: false, reason: 'payload must be an object' };
    if (payload !== undefined && JSON.stringify(payload).length > MAX_PAYLOAD) {
        return { ok: false, reason: 'payload exceeds the accepted size' };
    }
    const instanceId = readString(value, 'instanceId', MAX_TOKEN);
    if (instanceId === undefined || instanceId.length === 0)
        return { ok: false, reason: 'instanceId is required' };
    return {
        ok: true,
        result: {
            kind: 'result', protocolVersion: PROTOCOL_VERSION, task: { ...value.task }, id, leaseId, connectionGeneration, epoch, sequence, outcome,
            instanceId,
            ...(value.error === undefined ? {} : { error: value.error }),
            ...(payload === undefined ? {} : { payload }),
        },
    };
}
/**
 * Validate one Client → Host registration envelope (handshake).
 * @param {unknown} value - candidate hello.
 * @returns {{ ok: true, hello: Record<string, unknown> } | { ok: false, reason: string }} verdict.
 */
function validateHello(value) {
    if (!isRecord(value))
        return { ok: false, reason: 'hello must be an object' };
    if (readString(value, 'kind') !== 'hello')
        return { ok: false, reason: 'kind must be "hello"' };
    if (readCount(value, 'protocolVersion') !== PROTOCOL_VERSION) {
        return { ok: false, reason: `protocolVersion must be ${PROTOCOL_VERSION}` };
    }
    const connectionGeneration = readCount(value, 'connectionGeneration');
    if (connectionGeneration === undefined)
        return { ok: false, reason: 'connectionGeneration is required' };
    const sessionId = readString(value, 'sessionId', MAX_TOKEN);
    if (sessionId === undefined || sessionId.length === 0)
        return { ok: false, reason: 'sessionId is required' };
    const panel = value.panel;
    if (!isRecord(panel))
        return { ok: false, reason: 'panel is required' };
    const panelInstance = readString(panel, 'instanceId', MAX_TOKEN);
    if (panelInstance === undefined || panelInstance.length === 0)
        return { ok: false, reason: 'panel.instanceId is required' };
    const pages = panel.pages;
    if (!Array.isArray(pages) || pages.length > 200)
        return { ok: false, reason: 'panel.pages must be a bounded array' };
    const parsedPages = [];
    for (const page of pages) {
        if (!isRecord(page))
            return { ok: false, reason: 'panel.pages entries must be objects' };
        const lease = readString(page, 'lease', MAX_TOKEN);
        const partition = readString(page, 'partition', MAX_TOKEN);
        const url = readString(page, 'url', MAX_TEXT);
        const title = readOptionalString(page, 'title', MAX_TEXT);
        const documentToken = readString(page, 'documentToken', MAX_TOKEN);
        const tabId = readOptionalString(page, 'tabId', MAX_TOKEN);
        const sessionIdOfPage = readOptionalString(page, 'sessionId', MAX_TOKEN);
        if (lease === undefined || partition === undefined || url === undefined || documentToken === undefined) {
            return { ok: false, reason: 'panel.pages entries need lease, partition, url and documentToken' };
        }
        parsedPages.push({
            lease, partition, url, documentToken,
            ...(title === undefined ? {} : { title }),
            ...(tabId === undefined ? {} : { tabId }),
            ...(sessionIdOfPage === undefined ? {} : { sessionId: sessionIdOfPage }),
        });
    }
    return {
        ok: true,
        hello: {
            kind: 'hello', protocolVersion: PROTOCOL_VERSION, connectionGeneration, sessionId,
            panel: { instanceId: panelInstance, pages: parsedPages },
        },
    };
}
/**
 * Build a Host → Client command envelope.
 * @param {object} input - command fields.
 * @param {import('./task-scope.js').RunScope} input.task - exact immutable task/run.
 * @param {string} input.id - command id.
 * @param {string} input.leaseId - control lease.
 * @param {number} input.connectionGeneration - panel generation.
 * @param {number} input.epoch - observation epoch.
 * @param {number} input.sequence - strict next sequence.
 * @param {number} input.deadlineAt - monotonic deadline.
 * @param {object} input.op - validated operation.
 * @returns {Record<string, unknown>} the envelope.
 */
function commandEnvelope(input) {
    return {
        kind: 'command',
        protocolVersion: PROTOCOL_VERSION,
        task: { ...input.task },
        id: input.id,
        leaseId: input.leaseId,
        connectionGeneration: input.connectionGeneration,
        epoch: input.epoch,
        sequence: input.sequence,
        deadlineAt: input.deadlineAt,
        op: input.op,
    };
}
/**
 * Serialize a payload to lossless JSON with a size bound.
 * @param {unknown} value - payload.
 * @returns {{ ok: true, text: string } | { ok: false, reason: string }} encoded text or refusal.
 */
function encodePayload(value) {
    let text;
    try {
        text = JSON.stringify(value);
    }
    catch (cause) {
        return { ok: false, reason: `payload is not JSON-serializable: ${String(cause)}` };
    }
    if (typeof text !== 'string')
        return { ok: false, reason: 'payload has no JSON representation' };
    if (text.length > MAX_PAYLOAD)
        return { ok: false, reason: 'payload exceeds the accepted size' };
    return { ok: true, text };
}

// ---- src/panel.js ----
/**
 * The Browser Flow panel component.
 *
 * This is a normal ES module so it can be imported and tested directly. The
 * client build inlines it (with `pagecode.js` and `clientcore.js`) into the
 * shipped lazy-CJS bundle, so the code the browser runs and the code the tests
 * exercise are the same text.
 *
 * The panel never grants control by itself: it lists the live pages it can see,
 * asks the Host to authorize the one the user clicks, runs the fixed page
 * programs for commands the Host dispatches, and returns results carrying the
 * Host-assigned generation, epoch and sequence.
 *
 * @module @negentropy/dsh-browser-flow/panel
 */





/** Locale namespace owned by this plugin. */
const NS = 'browserFlow';
/** Host routes, relative to the authenticated application origin. */
const ROUTES = Object.freeze({
    hello: '/api/browser-flow/hello',
    poll: '/api/browser-flow/poll',
    result: '/api/browser-flow/result',
    invalidate: '/api/browser-flow/invalidate',
    authorize: '/api/browser-flow/authorize',
    revoke: '/api/browser-flow/revoke',
    status: '/api/browser-flow/status',
});
/** Poll interval, in milliseconds. */
const POLL_INTERVAL_MS = 700;
/**
 * The React surface the panel uses.
 *
 * Declared structurally so the bundle inlines no React types and the tests can
 * supply a minimal stand-in.
 * @typedef {object} ReactLike
 * @property {(type: string | Function, props: object | null, ...children: any[]) => any} createElement - element factory.
 * @property {(initial: unknown) => [any, (next: unknown) => void]} useState - state hook.
 * @property {(initial: unknown) => { current: any }} useRef - ref hook.
 * @property {(factory: () => any, deps?: unknown[]) => any} useMemo - memo hook.
 * @property {(callback: Function, deps?: unknown[]) => Function} useCallback - callback hook.
 * @property {(callback: () => (() => void) | void, deps?: unknown[]) => void} useEffect - effect hook.
 */
/**
 * Page-program builders, as the panel consumes them.
 * @typedef {object} PagePrograms
 * @property {string} identity - identity program source.
 * @property {(maxChars: number, maxNodes: number) => string} observe - observation program.
 * @property {(query: object, limit: number) => string} find - find program.
 * @property {(input: object) => string} act - action program.
 * @property {(input: object) => string} wait - wait program.
 * @property {(input: object) => string} [import] - scoped Beijing verifier.
 */
/** Page-program builders, as the panel consumes them. @type {PagePrograms} */
const PAGE_CODE = Object.freeze({
    identity: identityProgram(),
    import: input => importProgram(input),
    observe: (maxChars, maxNodes) => observeProgram(maxChars, maxNodes),
    find: (query, limit) => findProgram(/** @type {{ by: 'text' | 'attr' | 'role', value: string, name?: string }} */ (query), limit),
    act: input => actProgram(/** @type {{ documentToken: string, elementRef: string, action: 'click' | 'type' | 'select' | 'check', value?: string, checked?: boolean }} */ (input)),
    wait: input => waitProgram(/** @type {{ condition: 'present' | 'absent' | 'text', target: { documentToken: string, elementRef: string }, text?: string, timeoutMs: number }} */ (input)),
});
/**
 * The client helpers the panel consumes.
 *
 * These are the functions `clientcore.js` exports; the panel receives them as
 * one object so the bundle inlines a single dependency.
 * @typedef {object} ClientHelpers
 * @property {string} WEBVIEW_SELECTOR - guest selector.
 * @property {(pageCode: PagePrograms, op: any) => string} programFor - program selection.
 * @property {(element: Element) => { lease: string, partition: string, sessionId: string, tabId: string }} identityOf - element identity.
 * @property {(result: unknown) => object} classifyResult - execution outcome.
 * @property {(failure: unknown) => object} classifyThrow - thrown outcome.
 * @property {(carrier: object) => boolean} hostSupportsPageControl - host capability.
 */
/**
 * One page the panel found in the Sidebar Browser.
 * @typedef {object} DiscoveredPage
 * @property {string} lease - guest lease.
 * @property {string} partition - guest partition.
 * @property {string} sessionId - owning Session.
 * @property {string} tabId - plugin tab alias.
 * @property {string} url - redacted address.
 * @property {string} title - page title.
 * @property {string} documentToken - page-minted document identity.
 */
/** Client helpers, as the panel consumes them. @type {ClientHelpers} */
const CORE = Object.freeze({
    WEBVIEW_SELECTOR, programFor, identityOf, classifyResult, classifyThrow, hostSupportsPageControl,
});
/**
 * Locale dictionaries for the panel.
 * @type {{ zh: Record<string, string>, en: Record<string, string> }}
 */
const COPY = Object.freeze({
    zh: {
        resumeTask: '核对新输入并继续', userInput: '新提供的人工输入', waitingUser: '等待用户', taskReadOnly: '旧任务记录只读；请使用新会话开始新任务。',
        taskTitle: '当前任务', taskGoal: '目标', taskOrigins: '允许的源站（以逗号分隔）', taskDefinition: '本地任务定义', taskGeneric: '通用任务', taskWorkflow: '操作说明', createTask: '创建并绑定任务', openTask: '打开本会话任务', reviseTask: '修订目标与范围', cancelTask: '取消任务并撤销', finishTask: '结束并人工交接', taskMissing: '先创建或打开当前会话的任务，再授权页面。', taskBlocked: '此任务的写结果未知或日志不可用：仅允许读取、撤销及人工交接。',
        title: '浏览器控制',
        empty: '没有可授权的 Browser 页面。先在右侧打开一个网页。',
        authorize: '授权控制',
        revoke: '撤销控制',
        authorized: '已授权',
        noAgent: '该会话当前没有运行的 Agent；先让该会话的 Agent 运行一次。',
        disconnected: '未连接宿主。',
        error: '失败',
        privacy: '页面文本会送入当前 Agent 会话；已识别的敏感字段不会回显。',
        limit: '仅支持主文档 DOM；不支持截图、跨域 iframe、canvas 表格与隐藏页面输入。',
        unsupportedHost: '该宿主不支持同页控制：Web 端的 Browser 是跨域 iframe，无法执行页面程序。',
        revokeHint: '撤销只解除控制，页面与登录状态保留。',
        guideDescription: '授权并控制右侧 Browser 中已打开的页面',
        importTitle: '北京社保授权导入',
        importHint: '指定本地文件后核对摘要；确认只允许一次选文件及站点校验，最终提交仍由你完成。',
        file_path: '本地 XLSX 完整路径', file_unitId: '预期单位编号', file_legalIdentity: '统一社会信用代码', file_firstRow: '数据起始行', file_lastRow: '数据结束行', file_kind: '业务类型',
        file_add: '批量增员', file_modify: '批量修改', file_reduce: '批量减员',
        prepareFile: '读取并核对文件', confirmFile: '确认这一次文件授权', fileConfirmed: '文件已确认', rows: '行', bytes: '字节',
        stopBoundary: '停止于 import_confirmed；不保存待办、不最终提交。',
        cleanupFailed: '页面观察器清理尚未确认；本次运行不能记为完整通过。',
        pageAlias: '页面标识',
        session: '会话',
        agentInstance: 'Agent 实例',
    },
    en: {
        resumeTask: 'Check new input and resume', userInput: 'New user input', waitingUser: 'Awaiting user', taskReadOnly: 'Legacy history is read-only; start new work in a new Session.',
        taskTitle: 'Current task', taskGoal: 'Goal', taskOrigins: 'Allowed origins (comma separated)', taskDefinition: 'Local definition', taskGeneric: 'Generic task', taskWorkflow: 'Instructions', createTask: 'Create and bind task', openTask: 'Open this session’s task', reviseTask: 'Revise goal and scope', cancelTask: 'Cancel task and revoke', finishTask: 'End and hand off', taskMissing: 'Create or open this session’s task before authorizing a page.', taskBlocked: 'Unknown write or unavailable log: only read, revoke and hand off.',
        title: 'Browser Flow',
        empty: 'No Browser page to authorize. Open a page in the right sidebar first.',
        authorize: 'Authorize control',
        revoke: 'Revoke control',
        authorized: 'Authorized',
        noAgent: 'This session has no running Agent; let the session\'s Agent run once.',
        disconnected: 'Not connected to the Host.',
        error: 'Failure',
        privacy: 'Page text is sent to the current Agent session; recognized sensitive fields are never echoed.',
        limit: 'Main-document DOM only; no screenshots, cross-origin frames, canvas tables or hidden-page input.',
        unsupportedHost: 'This host cannot control the same page: the Web Browser is a cross-origin iframe, so page programs cannot run.',
        revokeHint: 'Revoking only detaches control; the page and its login state are kept.',
        guideDescription: 'Authorize and control a page open in the right-side Browser',
        pageAlias: 'Page id',
        session: 'Session',
        agentInstance: 'Agent instance',
        importTitle: 'Beijing authorized import',
        importHint: 'Review the local file summary. Confirmation permits one file selection and site validation; final submission remains yours.',
        file_path: 'Full local XLSX path', file_unitId: 'Expected unit number', file_legalIdentity: 'Unified social credit code', file_firstRow: 'First data row', file_lastRow: 'Last data row', file_kind: 'Business type',
        file_add: 'Batch add', file_modify: 'Batch modify', file_reduce: 'Batch reduce',
        prepareFile: 'Read and review file', confirmFile: 'Confirm this one file grant', fileConfirmed: 'File confirmed', rows: 'rows', bytes: 'bytes',
        stopBoundary: 'Stop at import_confirmed; do not save pending records or submit.',
        cleanupFailed: 'Page observer cleanup is unconfirmed; this run cannot qualify as complete.',
    },
});
/**
 * Build the panel component for one locale binding and React instance.
 * @param {object} input - component inputs.
 * @param {ReactLike} input.React - platform React.
 * @param {(key: string) => string} input.t - locale lookup.
 * @param {ClientHelpers} [input.core] - client helpers; defaults to {@link CORE}.
 * @param {PagePrograms} [input.pageCode] - page programs; defaults to {@link PAGE_CODE}.
 * @returns {Function} React component.
 */
function createPanel({ React, t, core = CORE, pageCode = PAGE_CODE }) {
    const h = React.createElement;
    /**
     * One panel instance: page discovery, authorization and the command loop.
     * @param {{ sessionId: string, useTabInfo?: () => { tab: { kind: string } } }} props - slot props.
     * @returns {any} element tree.
     */
    return function Panel(props) {
        const sessionId = props.sessionId;
        const tabInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined;
        /** @type {[DiscoveredPage[], (next: DiscoveredPage[]) => void]} */
        const [pages, setPages] = React.useState(/** @type {DiscoveredPage[]} */ ([]));
        const [connected, setConnected] = React.useState(false);
        const [liveAgent, setLiveAgent] = React.useState(false);
        /** @type {[any, (next: any) => void]} */
        const [agentSummary, setAgentSummary] = React.useState(undefined);
        const [error, setError] = React.useState(undefined);
        const [authorized, setAuthorized] = React.useState(undefined);
        const [busy, setBusy] = React.useState(false);
        const [fileForm, setFileForm] = React.useState({ path: '', kind: 'add', unitId: '', legalIdentity: '', firstRow: '2', lastRow: '2' });
        const [filePreview, setFilePreview] = React.useState(undefined);
        const [supported] = React.useState(() => core.hostSupportsPageControl(/** @type {object} */ ( /** @type {Record<string, unknown>} */(globalThis).dshDesktop)));
        const [taskSummary, setTaskSummary] = React.useState(undefined);
        const [definitions, setDefinitions] = React.useState([]);
        const [userInput, setUserInput] = React.useState('');
        const [taskForm, setTaskForm] = React.useState({ goal: '', origins: '', definitionId: '', workflowRef: '' });
        const instanceId = React.useMemo(() => {
            const bytes = new Uint8Array(16);
            if (globalThis.crypto?.getRandomValues !== undefined)
                globalThis.crypto.getRandomValues(bytes);
            else
                for (let index = 0; index < bytes.length; index++)
                    bytes[index] = Math.floor(Math.random() * 256);
            return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        }, []);
        const generation = React.useRef(1);
        // Set when a poll or a command fails, so the next successful poll opens a new
        // connection generation instead of silently resuming the old one.
        const lostConnection = React.useRef(false);
        const bound = React.useRef(undefined);
        const disposeImport = React.useCallback((/** @type {any} */ binding) => {
            if (!binding?.importOwner || !pageCode.import || !binding.element?.isConnected)
                return;
            const program = pageCode.import({ mode: 'dispose', owner: binding.importOwner });
            void binding.element.executeJavaScript(program, true).then((/** @type {any} */ value) => {
                if (alive.current && value?.value?.cleanupFailed)
                    setError({ code: 'internal', message: t('cleanupFailed') });
            }, () => { if (alive.current)
                setError({ code: 'internal', message: t('cleanupFailed') }); });
        }, [pageCode, t]);
        const authorizationVersion = React.useRef(0);
        const suspendControl = React.useCallback(() => {
            authorizationVersion.current += 1;
            disposeImport(bound.current);
            bound.current = undefined;
            setAuthorized(undefined);
            setFilePreview(undefined);
        }, [disposeImport]);
        const alive = React.useRef(true);
        const busyRef = React.useRef(false);
        /** @type {any} */
        const abandoned = React.useRef(new Set());
        const post = React.useCallback(async (/** @type {string} */ route, /** @type {object} */ body) => {
            const response = await fetch(route, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...body }),
                credentials: 'same-origin',
            });
            try {
                return await response.json();
            }
            catch {
                return { ok: false, error: { code: 'internal', message: `Host answered ${String(response.status)} without JSON` } };
            }
        }, []);
        const elements = React.useCallback(() => [...document.querySelectorAll(core.WEBVIEW_SELECTOR)], [core]);
        const elementOf = React.useCallback((/** @type {string} */ lease) => elements().find((/** @type {Element} */ element) => element.getAttribute('name') === lease), [elements]);
        /**
         * Refuse a command that does not address the authorization this panel holds.
         *
         * The Host decides what to dispatch; this decides whether *this* panel may
         * execute it. Without it a command minted for one authorization would run
         * against whatever page the panel is bound to now.
         * @param {any} command - command envelope taken from the Host.
         * @param {any} binding - the authorization this panel holds.
         * @param {number} generation - this panel's connection generation.
         * @returns {object | undefined} a refusal outcome, or undefined to proceed.
         */
        /**
         * Report that the authorized document changed, and follow the Host's verdict.
         *
         * Not every change ends control. A same-origin reload keeps the guest and the
         * element, so the Host retains the grant and only retires observations; a
         * cross-origin navigation, a replaced element or a destroyed guest ends it.
         * The local binding therefore follows what the Host answered instead of
         * assuming the worst and dropping a grant the user still holds.
         * @param {any} binding - the authorization that changed.
         * @param {{ url?: string, documentToken?: string } | undefined} live - the document now in the guest.
         * @param {'same_origin_navigation' | 'cross_origin_navigation' | 'page_replaced' | 'page_destroyed'} [override] - event to report instead of deriving one.
         * @returns {Promise<void>} resolves once the Host has been told.
         */
        const reportNavigation = async (binding, live, override) => {
            disposeImport(binding);
            setFilePreview(undefined);
            const event = override ?? navigationEvent(binding.url, live?.url);
            try {
                const answer = await post(ROUTES.invalidate, {
                    instanceId,
                    connectionGeneration: generation.current,
                    lease: binding.lease,
                    event,
                    ...(live?.documentToken === undefined ? {} : { documentToken: live.documentToken }),
                });
                if (!alive.current || bound.current !== binding)
                    return;
                const affected = answer?.ok === true
                    ? (answer.value.affected ?? []).find((/** @type {any} */ entry) => entry.controlLeaseId === binding.controlLeaseId)
                    : undefined;
                if (affected !== undefined && affected.state === 'active' && bound.current === binding) {
                    // Control survives. Adopt the Host's new epoch and the document now on
                    // screen, and make the caller observe again before acting.
                    binding.epoch = affected.epoch;
                    binding.documentToken = live?.documentToken ?? binding.documentToken;
                    binding.url = live?.url ?? binding.url;
                    setError({ code: 'stale_observation', message: 'the page changed; observe it again' });
                    return;
                }
            }
            catch {
                // The panel cannot prove control survived, so it must not keep using it.
            }
            if (bound.current === binding) {
                bound.current = undefined;
                setAuthorized(undefined);
            }
            setError({ code: event, message: 'the page navigated; authorize it again' });
        };
        const scan = React.useCallback(async () => {
            const found = [];
            for (const element of elements()) {
                const identity = core.identityOf(element);
                if (identity.lease === '')
                    continue;
                if (identity.sessionId !== '' && identity.sessionId !== sessionId)
                    continue;
                let probe;
                try {
                    probe = await element.executeJavaScript(pageCode.identity, true);
                }
                catch {
                    continue;
                }
                if (probe?.ok !== true)
                    continue;
                found.push({
                    lease: identity.lease,
                    partition: identity.partition,
                    sessionId: identity.sessionId === '' ? sessionId : identity.sessionId,
                    tabId: identity.tabId,
                    url: probe.value.url,
                    title: probe.value.title,
                    documentToken: probe.value.documentToken,
                });
            }
            return found;
        }, [core, elements, pageCode, sessionId]);
        const execute = React.useCallback(async (/** @type {{ task: import('./task-scope.js').RunScope, deadlineAt: number, budgetMs?: number, op: object, id: string, leaseId: string, connectionGeneration: number, epoch: number, sequence: number }} */ command, /** @type {number} */ batchReceivedAt) => {
            const binding = bound.current;
            if (binding === undefined) {
                return { outcome: 'failed', error: { code: 'not_authorized', message: 'no page is authorized in this panel' } };
            }
            // Gate on the authorization this panel itself holds. Echoing a command's
            // fields back in the result proves nothing; comparing them here — before
            // the page is touched — is what keeps a command aimed at one authorization
            // from executing against another after the user authorizes a different
            // page.
            const rejected = refuseCommand(command, binding, generation.current);
            if (rejected !== undefined)
                return rejected;
            // The Host advances its sequence when it dispatches, not when a command
            // succeeds. This panel must therefore consume the sequence as soon as it
            // accepts the command: advancing only on success would leave the two
            // counters permanently apart after any failed command, and every later
            // command would be refused as out of sequence.
            binding.expectedSequence += 1;
            const parsed = validateCommand({ ...command, kind: 'command' });
            if (!parsed.ok)
                return { outcome: 'failed', error: { code: 'protocol_violation', message: parsed.reason } };
            // The element must still be the very instance the user authorized. A name
            // can be reused by a replacement guest, so identity is compared, not the
            // attribute.
            const mounted = elementOf(binding.lease);
            if (mounted !== binding.element) {
                await reportNavigation(binding, undefined, 'page_replaced');
                return { outcome: 'failed', error: { code: 'page_replaced', message: 'the authorized page was replaced; authorize again' } };
            }
            const element = binding.element;
            if (element === undefined || !element.isConnected) {
                return { outcome: 'failed', error: { code: 'page_unavailable', message: 'the authorized page is gone; authorize again' } };
            }
            // The budget is consumed by waiting, so it is charged from the moment the
            // batch arrived rather than from the moment this command is reached.
            const spent = performance.now() - batchReceivedAt;
            if (typeof command.budgetMs === 'number' && spent >= command.budgetMs) {
                return { outcome: 'dropped', error: { code: 'deadline_exceeded', message: 'the command expired before execution' } };
            }
            // The document the user authorized must still be the document in the
            // guest. A navigation — especially a cross-origin one — leaves the same
            // webview element showing a different document, so the element staying
            // connected is not enough.
            let live;
            try {
                live = await element.executeJavaScript(pageCode.identity, true);
            }
            catch (failure) {
                return core.classifyThrow(failure);
            }
            if (!alive.current || bound.current !== binding
                || command.connectionGeneration !== generation.current || command.epoch !== binding.epoch) {
                return { outcome: 'failed', error: { code: 'revoked', message: 'control changed before page execution' } };
            }
            if (elementOf(binding.lease) !== element || !element.isConnected) {
                await reportNavigation(binding, undefined, 'page_replaced');
                return { outcome: 'failed', error: { code: 'page_replaced', message: 'the authorized page was replaced; authorize again' } };
            }
            if (live?.ok !== true) {
                return { outcome: 'failed', error: { code: 'page_unavailable', message: 'the authorized document could not be read; authorize again' } };
            }
            let allowedOrigin = false;
            try {
                allowedOrigin = Array.isArray(binding.origins) && binding.origins.includes(new URL(live.value.url).origin);
            }
            catch {
                allowedOrigin = false;
            }
            if (!allowedOrigin) {
                await reportNavigation(binding, live.value, 'cross_origin_navigation');
                return { outcome: 'failed', error: { code: 'task_scope_mismatch', message: 'the live page is outside the task allowed origins' } };
            }
            if (live.value.documentToken !== binding.documentToken) {
                await reportNavigation(binding, live.value);
                return { outcome: 'failed', error: { code: 'stale_observation', message: 'the page navigated to another document; authorize it again' } };
            }
            // Identity checks share the execution budget with the page operation.
            const remaining = typeof command.budgetMs === 'number'
                ? command.budgetMs - (performance.now() - batchReceivedAt)
                : undefined;
            if (remaining !== undefined && remaining <= 0) {
                return { outcome: 'dropped', error: { code: 'deadline_exceeded', message: 'the command expired before execution' } };
            }
            const op = remaining === undefined ? command.op : capToBudget(command.op, remaining);
            // The wire validator checked the file fields; no raw model path reaches this branch.
            const file = /** @type {any} */ (op).file;
            if (file) {
                try {
                    const binary = atob(file.base64);
                    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
                    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
                    if (hash !== file.sha256)
                        return { outcome: 'failed', error: { code: 'invalid_request', message: 'file transfer hash mismatch' } };
                }
                catch {
                    return { outcome: 'failed', error: { code: 'invalid_request', message: 'file transfer verification failed' } };
                }
                if (!alive.current || bound.current !== binding || command.connectionGeneration !== generation.current || command.epoch !== binding.epoch)
                    return { outcome: 'failed', error: { code: 'revoked', message: 'control changed while verifying the file' } };
                if (typeof command.budgetMs === 'number' && performance.now() - batchReceivedAt >= command.budgetMs)
                    return { outcome: 'dropped', error: { code: 'deadline_exceeded', message: 'the file command expired before page execution' } };
            }
            if ( /** @type {any} */(op).importOwner)
                binding.importOwner = /** @type {any} */ (op).importOwner;
            let source;
            try {
                source = core.programFor(pageCode, op);
            }
            catch (failure) {
                return { outcome: 'failed', error: { code: 'unsupported', message: String(/** @type {{ message?: unknown }} */ (failure)?.message ?? failure) } };
            }
            let result;
            try {
                result = await element.executeJavaScript(source, true);
            }
            catch (failure) {
                // The page may have acted before the error surfaced: never claim it did not.
                return core.classifyThrow(failure);
            }
            return core.classifyResult(result);
        }, [bound, core, elementOf, pageCode]);
        React.useEffect(() => {
            alive.current = true;
            let cancelled = false;
            const tick = async () => {
                if (cancelled || !alive.current || busyRef.current)
                    return;
                try {
                    const found = supported ? await scan() : [];
                    if (cancelled)
                        return;
                    setPages(found);
                    // The scan already reads each guest's live document identity, so a
                    // navigation shows up here without any extra webview listener: the
                    // authorized guest either moved to another document or is gone.
                    const binding = bound.current;
                    if (binding !== undefined) {
                        const scanned = found.find((/** @type {any} */ entry) => entry.lease === binding.lease);
                        if (scanned === undefined) {
                            await reportNavigation(binding, undefined);
                        }
                        else if (elementOf(binding.lease) !== binding.element) {
                            // The guest carrying this name is a different element now: the
                            // physical page the user authorized was replaced.
                            await reportNavigation(binding, scanned, 'page_replaced');
                        }
                        else if (scanned.documentToken !== binding.documentToken) {
                            await reportNavigation(binding, scanned);
                        }
                        if (bound.current === undefined)
                            return;
                    }
                    if (lostConnection.current) {
                        lostConnection.current = false;
                        generation.current += 1;
                        // A new generation supersedes the old connection, which retires the
                        // leases bound to it. Control therefore has to be granted again.
                        if (bound.current !== undefined) {
                            suspendControl();
                            setError({ code: 'connection_lost', message: 'the panel reconnected; authorize the page again' });
                        }
                    }
                    const polled = await post(ROUTES.poll, {
                        protocolVersion: PROTOCOL_VERSION,
                        instanceId,
                        connectionGeneration: generation.current,
                        sessionId,
                        pages: found,
                    });
                    if (cancelled)
                        return;
                    if (polled?.ok !== true || polled.value.protocolVersion !== PROTOCOL_VERSION) {
                        // The channel is gone. Control is suspended until the user allows it
                        // again, so the next poll must not resume the previous generation.
                        lostConnection.current = true;
                        suspendControl();
                        setConnected(false);
                        setLiveAgent(false);
                        setError(polled?.error);
                        return;
                    }
                    setTaskSummary(polled.value.task ?? undefined);
                    setDefinitions(polled.value.definitions ?? []);
                    if (bound.current && polled.value.task?.task && !sameRunScope(bound.current.task, polled.value.task.task))
                        suspendControl();
                    setConnected(true);
                    setLiveAgent(true);
                    setAgentSummary(polled.value.agent ?? undefined);
                    setError(undefined);
                    if (bound.current && Array.isArray(polled.value.controls) && !polled.value.controls.includes(bound.current.controlLeaseId))
                        suspendControl();
                    // The Host names the commands it has stopped waiting for. Recording
                    // them lets the panel skip a result the Host would only discard, and
                    // stop work it can no longer report on.
                    for (const id of polled.value.dropped ?? [])
                        abandoned.current.add(id);
                    const batchReceivedAt = performance.now();
                    for (const command of polled.value.commands) {
                        busyRef.current = true;
                        const outcome = await execute(command, batchReceivedAt);
                        busyRef.current = false;
                        // A command the Host abandoned while it ran is not reported: the
                        // Host already settled it, and a second answer would be discarded.
                        if (abandoned.current.has(command.id)) {
                            abandoned.current.delete(command.id);
                            continue;
                        }
                        await post(ROUTES.result, {
                            kind: 'result',
                            protocolVersion: PROTOCOL_VERSION,
                            task: command.task,
                            id: command.id,
                            leaseId: command.leaseId,
                            instanceId,
                            connectionGeneration: command.connectionGeneration,
                            epoch: command.epoch,
                            sequence: command.sequence,
                            ...outcome,
                        });
                    }
                }
                catch (failure) {
                    if (!cancelled) {
                        lostConnection.current = true;
                        suspendControl();
                        setConnected(false);
                        setError({ code: 'internal', message: String(/** @type {{ message?: unknown }} */ (failure)?.message ?? failure) });
                    }
                }
            };
            void tick();
            const timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
            return () => {
                cancelled = true;
                alive.current = false;
                authorizationVersion.current += 1;
                disposeImport(bound.current);
                bound.current = undefined;
                clearInterval(timer);
            };
        }, [execute, instanceId, post, scan, sessionId, supported, suspendControl]);
        const authorize = React.useCallback(async (/** @type {{ lease: string, partition: string, documentToken: string, tabId: string, url?: string, title?: string }} */ page) => {
            // The user must be able to tell which physical page they are granting.
            const twins = indistinguishableFrom(pages, page);
            if (twins.length > 0) {
                setError({ code: 'page_ambiguous', message: `${String(twins.length + 1)} pages look identical; close one and authorize again` });
                return;
            }
            const version = ++authorizationVersion.current;
            const authorizedGeneration = generation.current;
            const authorizedElement = elementOf(page.lease);
            setBusy(true);
            try {
                const answer = await post(ROUTES.authorize, {
                    instanceId,
                    connectionGeneration: generation.current,
                    sessionId,
                    lease: page.lease,
                    partition: page.partition,
                    documentToken: page.documentToken,
                    tabId: page.tabId,
                    task: taskSummary?.task,
                });
                if (!alive.current || version !== authorizationVersion.current
                    || authorizedGeneration !== generation.current)
                    return;
                if (answer?.ok === true) {
                    if (!validRunScope(answer.value.task)) {
                        setError({ code: 'protocol_violation', message: t('taskMissing') });
                        return;
                    }
                    if (elementOf(page.lease) !== authorizedElement) {
                        bound.current = undefined;
                        setAuthorized(undefined);
                        setError({ code: 'page_replaced', message: t('disconnected') });
                        return;
                    }
                    disposeImport(bound.current);
                    setFilePreview(undefined);
                    bound.current = {
                        lease: page.lease,
                        partition: page.partition,
                        tabId: page.tabId,
                        task: answer.value.task,
                        pagePolicy: answer.value.pagePolicy,
                        origins: answer.value.origins,
                        controlLeaseId: answer.value.controlLeaseId,
                        epoch: answer.value.epoch,
                        documentToken: answer.value.documentToken,
                        url: page.url,
                        expectedSequence: answer.value.nextSequence ?? 0,
                        // The plan requires the Client to bind the exact webview element
                        // instance, not a name that a replacement could reuse.
                        element: authorizedElement,
                    };
                    setAuthorized(page.lease);
                    setError(undefined);
                }
                else {
                    setError(answer?.error);
                }
            }
            finally {
                setBusy(false);
            }
        }, [elementOf, instanceId, pages, post, sessionId, taskSummary]);
        const fileOperation = async (/** @type {'prepare'|'confirm'} */ operation) => {
            const binding = bound.current;
            const version = authorizationVersion.current;
            if (!binding)
                return;
            setBusy(true);
            try {
                const answer = await post(ROUTES.authorize, {
                    instanceId, connectionGeneration: generation.current, sessionId, task: binding.task, lease: binding.lease, partition: binding.partition, tabId: binding.tabId, documentToken: binding.documentToken,
                    fileOperation: operation,
                    ...(operation === 'prepare' ? { path: fileForm.path, scope: { kind: fileForm.kind, unitId: fileForm.unitId, legalIdentity: fileForm.legalIdentity, firstRow: Number(fileForm.firstRow), lastRow: Number(fileForm.lastRow) } } : { fileGrantId: filePreview?.fileGrantId }),
                });
                if (!alive.current || bound.current !== binding || version !== authorizationVersion.current)
                    return;
                if (answer?.ok !== true) {
                    setError(answer?.error);
                    return;
                }
                setFilePreview(operation === 'prepare' ? answer.value : { ...filePreview, confirmed: true });
            }
            catch {
                if (alive.current)
                    setError({ code: 'connection_lost', message: t('disconnected') });
            }
            finally {
                if (alive.current)
                    setBusy(false);
            }
        };
        const revoke = React.useCallback(async () => {
            suspendControl();
            setBusy(true);
            try {
                const answer = await post(ROUTES.revoke, {
                    instanceId,
                    connectionGeneration: generation.current,
                    sessionId,
                });
                if (answer?.ok !== true)
                    setError(answer?.error);
            }
            catch (failure) {
                setError({ code: 'connection_lost', message: t('disconnected') });
            }
            finally {
                setBusy(false);
            }
        }, [instanceId, post, sessionId, suspendControl]);
        const taskOperation = async (/** @type {'create'|'open'|'revise'|'cancel'|'finish'|'resume'} */ operation) => {
            if (['revise', 'cancel', 'finish'].includes(operation))
                suspendControl();
            setBusy(true);
            try {
                const answer = await post(ROUTES.authorize, { instanceId, connectionGeneration: generation.current, sessionId, taskOperation: operation,
                    ...(operation === 'create' ? { spec: { goal: taskForm.goal, ...(taskForm.definitionId ? { definitionId: taskForm.definitionId, workflowRef: taskForm.workflowRef } : { origins: taskForm.origins.split(',').map((/** @type {string} */ part) => part.trim()).filter(Boolean) }) } } : {}),
                    ...(operation === 'revise' ? { task: taskSummary?.task, spec: { goal: taskForm.goal, ...(taskSummary?.adapter === 'generic' ? { origins: taskForm.origins.split(',').map((/** @type {string} */ part) => part.trim()).filter(Boolean) } : {}) } } : {}),
                    ...(operation === 'resume' ? { task: taskSummary?.task, waitId: taskSummary?.active_context?.waiting?.id, userInput } : {}),
                    ...(['cancel', 'finish'].includes(operation) ? { task: taskSummary?.task } : {}) });
                if (!alive.current)
                    return;
                if (answer?.ok) {
                    setTaskSummary(answer.value);
                    if (operation === 'resume')
                        setUserInput('');
                    setError(undefined);
                }
                else
                    setError(answer?.error);
            }
            catch {
                if (alive.current)
                    setError({ code: 'connection_lost', message: t('disconnected') });
            }
            finally {
                if (alive.current)
                    setBusy(false);
            }
        };
        const selectedDefinition = definitions.find((/** @type {any} */ item) => item.id === taskForm.definitionId);
        const taskPanel = h('section', { 'data-browser-flow-task': '' }, h('h4', null, t('taskTitle')), taskSummary ? h('p', { 'data-browser-flow-task-identity': '' }, `${taskSummary.task.taskId} · ${taskSummary.state} · ${taskSummary.goal}`) : h('p', null, t('taskMissing')), taskSummary?.writeBlocked ? h('p', { role: 'alert' }, taskSummary?.state === 'read_only' ? t('taskReadOnly') : t('taskBlocked')) : null, taskSummary?.active_context?.waiting ? h('section', { 'data-browser-flow-user-wait': '' }, h('p', null, t('waitingUser') + ': ' + taskSummary.active_context.waiting.reason), h('p', null, taskSummary.active_context.waiting.resumeCondition), h('label', null, t('userInput'), h('input', { 'data-browser-flow-input': 'user-input', value: userInput, onChange: (/** @type {any} */ event) => setUserInput(event.target.value) })), h('button', { type: 'button', 'data-browser-flow-action': 'task-resume', disabled: busy || taskSummary.writeBlocked, onClick: () => { void taskOperation('resume'); } }, t('resumeTask'))) : null, h('label', null, t('taskGoal'), h('input', { 'data-browser-flow-input': 'task-goal', value: taskForm.goal, onChange: (/** @type {any} */ event) => setTaskForm({ ...taskForm, goal: event.target.value }) })), h('label', null, t('taskOrigins'), h('input', { 'data-browser-flow-input': 'task-origins', value: taskForm.origins, onChange: (/** @type {any} */ event) => setTaskForm({ ...taskForm, origins: event.target.value }) })), h('label', null, t('taskDefinition'), h('select', { 'data-browser-flow-input': 'task-definition', value: taskForm.definitionId, disabled: !!taskSummary, onChange: (/** @type {any} */ event) => { const selected = definitions.find((/** @type {any} */ item) => item.id === event.target.value); setTaskForm({ ...taskForm, definitionId: event.target.value, workflowRef: selected?.workflows[0]?.id ?? '' }); } }, h('option', { value: '' }, t('taskGeneric')), ...definitions.map((/** @type {any} */ item) => h('option', { key: item.id, value: item.id }, item.id)))), selectedDefinition ? h('label', null, t('taskWorkflow'), h('select', { 'data-browser-flow-input': 'task-workflow', value: taskForm.workflowRef, disabled: !!taskSummary, onChange: (/** @type {any} */ event) => setTaskForm({ ...taskForm, workflowRef: event.target.value }) }, ...selectedDefinition.workflows.map((/** @type {any} */ row) => h('option', { key: row.id, value: row.id }, row.description)))) : null, ...(['create', 'open', 'revise', 'cancel', 'finish']).map(operation => h('button', { type: 'button', 'data-browser-flow-action': 'task-' + operation, disabled: (['cancel', 'finish'].includes(operation) ? false : busy) || (['revise', 'cancel', 'finish'].includes(operation) && !taskSummary) || (operation === 'create' && !!taskSummary), onClick: () => { void taskOperation(/** @type {'create'|'open'|'revise'|'cancel'|'finish'|'resume'} */ (operation)); } }, t(operation + 'Task'))));
        const rows = pages.map((/** @type {DiscoveredPage} */ page) => h('li', { key: page.lease, 'data-browser-flow-page': page.lease }, h('div', { className: 'bf-page-title' }, page.title || page.url), h('div', { className: 'bf-page-url' }, page.url),
        // The alias is what makes two pages on the same address distinguishable.
        h('div', { className: 'bf-page-alias' }, `${t('pageAlias')}: ${page.tabId}`), h('div', { className: 'bf-page-state' }, authorized === page.lease ? t('authorized') : ''), h('button', {
            type: 'button',
            disabled: busy || !supported || !taskSummary,
            'data-browser-flow-action': 'authorize',
            onClick: () => { void authorize(page); },
        }, t('authorize'))));
        const fileFields = ['path', 'unitId', 'legalIdentity', 'firstRow', 'lastRow'].map(key => h('label', { key }, t('file_' + key), h('input', { type: 'text', 'data-browser-flow-input': key, value: fileForm[key], disabled: busy, onChange: (/** @type {any} */ event) => setFileForm({ ...fileForm, [key]: event.target.value }) })));
        const filePanel = authorized && taskSummary?.adapter === 'bjrsj' && !taskSummary?.writeBlocked ? h('section', { 'data-browser-flow-import': '' }, h('h4', null, t('importTitle')), h('p', null, t('importHint')), ...fileFields, h('label', null, t('file_kind'), h('select', { 'data-browser-flow-input': 'kind', value: fileForm.kind, disabled: busy, onChange: (/** @type {any} */ event) => setFileForm({ ...fileForm, kind: event.target.value }) }, ...['add', 'modify', 'reduce'].map(kind => h('option', { key: kind, value: kind }, t('file_' + kind))))), h('button', { type: 'button', 'data-browser-flow-action': 'prepare-file', disabled: busy, onClick: () => { void fileOperation('prepare'); } }, t('prepareFile')), filePreview ? h('div', { 'data-browser-flow-file-preview': '' }, h('p', null, filePreview.path), h('p', null, `${t('file_kind')}: ${t('file_' + filePreview.kind)}; ${filePreview.bytes} ${t('bytes')}; ${filePreview.rows} ${t('rows')}`), h('p', null, 'SHA-256: ' + filePreview.sha256), h('p', null, t('stopBoundary')), h('button', { type: 'button', 'data-browser-flow-action': 'confirm-file', disabled: busy || filePreview.confirmed, onClick: () => { void fileOperation('confirm'); } }, t(filePreview.confirmed ? 'fileConfirmed' : 'confirmFile'))) : null) : null;
        return h('section', { 'data-browser-flow-panel': '', 'aria-label': t('title') }, taskPanel, filePanel, h('header', { className: 'bf-header' }, h('h3', null, t('title')), h('button', {
            type: 'button',
            'data-browser-flow-action': 'revoke',
            disabled: !supported,
            onClick: () => { void revoke(); },
        }, t('revoke'))), !supported && h('p', { role: 'status' }, t('unsupportedHost')), supported && !connected && h('p', { role: 'status' }, t('disconnected')), supported && connected && !liveAgent && h('p', { role: 'status' }, t('noAgent')), error !== undefined && h('p', { role: 'alert' }, `${t('error')}: ${error.code} ${error.message}`),
        // The user must see which Session and which live Agent instance the grant
        // is attached to before granting it.
        h('p', { className: 'bf-target', 'data-browser-flow-target': '' }, `${t('session')}: ${sessionId}`, agentSummary === undefined || agentSummary === null ? '' : ` · ${t('agentInstance')}: ${agentSummary.instance}`), supported && pages.length === 0 ? h('p', null, t('empty')) : null, supported && pages.length > 0 ? h('ul', { className: 'bf-pages' }, rows) : null, h('p', { className: 'bf-note' }, t('privacy')), h('p', { className: 'bf-note' }, t('limit')), h('p', { className: 'bf-note' }, t('revokeHint')), tabInfo === undefined ? null : h('p', { className: 'bf-note' }, tabInfo.tab.kind));
    };
}

// ---- src/client.js ----
/**
 * Browser Flow panel — the client bundle entry.
 *
 * `scripts/build-client.mjs` inlines `src/panel.js`, `src/pagecode.js` and
 * `src/clientcore.js` into the shipped `lib/client.js`, the lazy-CJS factory
 * the Harness browser loads. The panel is a normal ES module so the tests can
 * import it; the build only removes the module syntax and folds the imports in.
 *
 * The panel registers one Sidebar tab type plus its body and title. That is the
 * only additive panel seat: `rightbar` and `rightbar.session` are single-kind
 * and already occupied, and a second same-priority registration throws.
 */

/** Package name: also the loader row id and the tab type id. */
const PLUGIN_ID = '@negentropy/dsh-browser-flow';
/** Tab kind opened through `ctx.sidebarRight.openTab`. */
const TAB_KIND = 'browser-flow';
/**
 * The client root context this plugin registers into.
 *
 * Declared structurally: the plugin never imports the client services, it only
 * calls the documented registration methods.
 * @typedef {object} ClientContext
 * @property {(callback: () => (() => void) | void, label?: string) => void} effect - effect-scoped registration.
 * @property {{ register: (namespace: string, copy: object) => () => void, bind: (namespace: string) => (key: string) => string }} locale - locale registry.
 * @property {{ register: (definition: object) => () => void }} sidebarRightTabs - sidebar tab types.
 * @property {{ inject: (name: string, callback: () => unknown) => unknown, register: (options: object, component: Function) => () => void }} slots - slot registry.
 */
/**
 * Register the panel's locale, tab type, body and title.
 *
 * A tab type only appears in the right sidebar through its `guide` entries: the
 * pane seeds its default page from `tabs.guide()`, and a type that omits `guide`
 * stays off the guide page entirely. Registering the type alone is therefore
 * invisible — the mistake this file used to make — so the guide entry is part of
 * the same registration.
 *
 * Every registration is an effect, so unloading the plugin removes the UI with
 * it; nothing is registered at module scope.
 * @param {ClientContext} ctx - client root context.
 * @param {import('./panel.js').ReactLike} React - platform React instance.
 * @returns {void}
 */
function registerPanel(ctx, React) {
    const t = ctx.locale.bind(NS);
    ctx.effect(() => ctx.locale.register(NS, COPY), 'browser-flow: copy');
    ctx.effect(() => ctx.sidebarRightTabs.register({
        id: PLUGIN_ID,
        kind: TAB_KIND,
        multiple: false,
        keepMounted: true,
        title: () => t('title'),
        guide: [{
                id: 'open',
                order: 60,
                title: () => t('title'),
                description: () => t('guideDescription'),
            }],
    }), 'browser-flow: tab type');
    const Panel = createPanel({ React, t });
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: PLUGIN_ID,
        locale: NS,
    }, Panel));
    ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: PLUGIN_ID,
    }, () => t('title')));
}

    Object.assign(exports, {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply: function (ctx) { registerPanel(ctx, react) },
    })
    return module.exports
  },
})
