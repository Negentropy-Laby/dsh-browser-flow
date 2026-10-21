window.__ModuleLoader__.load({
  id: '@negentropy/dsh-browser-flow',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const react = require('react')
// ---- src/task-scope.ts ----
/** Browser Flow v3 task and run identifiers, shared by Host and Client. */
/** @param {unknown} value - JSON value. @returns {value is Record<string, unknown>} object. */
const scopeRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
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

// ---- src/protocol.ts ----
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
    const fields = {};
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
            || file.kind !== fields.importScope.kind)
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
    let diagnostic;
    if (value.error !== undefined) {
        if (!isRecord(value.error))
            return { ok: false, reason: 'result error must be an object' };
        const message = readOptionalString(value.error, 'message', MAX_TEXT);
        if (value.error.message !== undefined && message === undefined)
            return { ok: false, reason: 'result error message must be a bounded string' };
        diagnostic = { ...value.error, ...(message === undefined ? {} : { message }) };
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
            ...(diagnostic === undefined ? {} : { error: diagnostic }),
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
 * @param {import('./task-scope.ts').RunScope} input.task - exact immutable task/run.
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

// ---- src/client-wire.ts ----
/** JSON response decoding for the panel's existing authenticated routes. */


const strings = (value) => Array.isArray(value) && value.every(item => typeof item === 'string');
/** @param value - route data. @returns Whether it contains the task fields displayed by the panel. */
function isTaskSummary(value) {
    if (!isRecord(value) || !validRunScope(value.task) || typeof value.state !== 'string' || typeof value.goal !== 'string' || typeof value.adapter !== 'string' || typeof value.writeBlocked !== 'boolean')
        return false;
    if (value.active_context !== undefined) {
        if (!isRecord(value.active_context))
            return false;
        const wait = value.active_context.waiting;
        if (wait !== undefined && wait !== null && (!isRecord(wait) || typeof wait.id !== 'string' || typeof wait.reason !== 'string' || typeof wait.resumeCondition !== 'string'))
            return false;
    }
    return true;
}
/** @param value - private panel preview. @returns Whether all displayed file fields are present. */
function isFilePreview(value) {
    return isRecord(value) && ['fileGrantId', 'path', 'sha256', 'kind'].every(key => typeof value[key] === 'string') && typeof value.bytes === 'number' && typeof value.rows === 'number' && (value.confirmed === undefined || typeof value.confirmed === 'boolean');
}
/** @param raw - untrusted response JSON. @returns A decoded reply or a visible protocol refusal. */
function decodePanelReply(raw) {
    const invalid = { ok: false, error: { code: 'protocol_violation', message: 'Host response fields are invalid; reload the paired Host and Client' } };
    if (!isRecord(raw))
        return invalid;
    if (raw.ok !== true)
        return isRecord(raw.error) && typeof raw.error.code === 'string' && typeof raw.error.message === 'string' ? { ok: false, error: { code: raw.error.code, message: raw.error.message } } : invalid;
    const value = raw.value;
    if (!isRecord(value))
        return invalid;
    for (const key of ['protocolVersion', 'generation', 'epoch', 'nextSequence'])
        if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key])))
            return invalid;
    for (const key of ['controlLeaseId', 'documentToken'])
        if (value[key] !== undefined && typeof value[key] !== 'string')
            return invalid;
    for (const key of ['dropped', 'controls', 'origins'])
        if (value[key] !== undefined && !strings(value[key]))
            return invalid;
    if (value.task !== undefined && value.task !== null && !validRunScope(value.task) && !isTaskSummary(value.task))
        return invalid;
    if (value.commands !== undefined && (!Array.isArray(value.commands) || !value.commands.every(command => isRecord(command) && validateCommand({ ...command, kind: 'command' }).ok && (command.budgetMs === undefined || (typeof command.budgetMs === 'number' && Number.isFinite(command.budgetMs) && command.budgetMs >= 0)))))
        return invalid;
    if (value.definitions !== undefined && (!Array.isArray(value.definitions) || !value.definitions.every(row => isRecord(row) && typeof row.id === 'string' && Array.isArray(row.workflows) && row.workflows.every(workflow => isRecord(workflow) && typeof workflow.id === 'string' && typeof workflow.description === 'string'))))
        return invalid;
    if (value.affected !== undefined && (!Array.isArray(value.affected) || !value.affected.every(row => isRecord(row) && typeof row.controlLeaseId === 'string' && typeof row.state === 'string' && typeof row.epoch === 'number')))
        return invalid;
    if (value.agent !== undefined && value.agent !== null && (!isRecord(value.agent) || typeof value.agent.instance !== 'string' || typeof value.agent.id !== 'string' || (value.agent.authorizedLeaseCount !== undefined && (typeof value.agent.authorizedLeaseCount !== 'number' || !Number.isSafeInteger(value.agent.authorizedLeaseCount) || value.agent.authorizedLeaseCount < 0)) || (value.agent.controlLeaseIds !== undefined && !strings(value.agent.controlLeaseIds))))
        return invalid;
    if (value.pagePolicy !== undefined && (!isRecord(value.pagePolicy) || typeof value.pagePolicy.adapter !== 'string' || typeof value.pagePolicy.workflow !== 'string' || (value.pagePolicy.kind !== undefined && (typeof value.pagePolicy.kind !== 'string' || !['add', 'modify', 'reduce'].includes(value.pagePolicy.kind)))))
        return invalid;
    return { ok: true, value: value };
}

// ---- src/clientcore.ts ----
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
        return pageCode.observe((op.maxChars), (op.maxNodes));
    if (op.kind === 'find')
        return pageCode.find((op.query), (op.limit));
    if (op.kind === 'act') {
        const target = (op.target);
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
    const record = typeof result === 'object' && result !== null ? (result) : undefined;
    if (record === undefined || record.ok !== true) {
        const raw = record?.error;
        const detail = typeof raw === 'object' && raw !== null ? (raw) : {};
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
        error: { code: 'unknown_outcome', message: String((failure)?.message ?? failure) },
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
function indistinguishableFrom(pages, chosen) {
    return pages.filter(page => {
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
function refuseCommand(envelope, held, generation) {
    if (held === undefined) {
        return { outcome: 'failed', error: { code: 'not_authorized', message: 'no page is authorized in this panel' } };
    }
    if (!validRunScope(envelope.task) || !validRunScope(held.task) || !sameRunScope(envelope.task, held.task))
        return { outcome: 'failed', error: { code: 'task_scope_mismatch', message: 'command task/run differs from the user-bound task' } };
    if (held.pagePolicy && (!samePolicy(envelope.op?.pagePolicy, held.pagePolicy)))
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
function capToBudget(operation, remainingMs, marginMs = 250) {
    if (operation.kind !== 'wait')
        return operation;
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
    return (carrier ?? {})?.protocolVersion === 1;
}
function samePolicy(left, right) {
    const l = left;
    const r = right;
    return l?.adapter === r.adapter && l?.workflow === r.workflow;
}

// ---- generated/PAGE_RUNTIME_SOURCE ----
const PAGE_RUNTIME_SOURCE = "function createRuntime() {\n    const REGISTRY = \"__dshBrowserFlow\";\n    const SENSITIVE_QUERY = [\"token\", \"access_token\", \"id_token\", \"refresh_token\", \"code\", \"key\", \"api_key\", \"secret\", \"client_secret\", \"password\", \"passwd\", \"pwd\", \"session\", \"sessionid\", \"auth\", \"authorization\", \"sig\", \"signature\", \"credential\", \"otp\"];\n    const registry = () => {\n        const existing = Object.getOwnPropertyDescriptor(globalThis, REGISTRY);\n        if (existing && existing.value && typeof existing.value === 'object')\n            return existing.value;\n        const created = { documentToken: mintToken(), refs: new Map(), nextRef: 0 };\n        Object.defineProperty(globalThis, REGISTRY, { value: created, configurable: true, enumerable: false, writable: false });\n        return created;\n    };\n    const mintToken = () => {\n        const bytes = new Uint8Array(16);\n        if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function')\n            globalThis.crypto.getRandomValues(bytes);\n        else\n            for (let index = 0; index < bytes.length; index++)\n                bytes[index] = Math.floor(Math.random() * 256);\n        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');\n    };\n    const mintRef = (element) => {\n        const state = registry();\n        const ref = 'el-' + (state.nextRef++).toString(36);\n        state.refs.set(ref, element);\n        return ref;\n    };\n    const elementOf = (ref) => {\n        const element = registry().refs.get(ref);\n        return element && element.isConnected ? element : undefined;\n    };\n    const visible = (element) => {\n        if (!element || !element.isConnected)\n            return false;\n        const style = globalThis.getComputedStyle ? getComputedStyle(element) : undefined;\n        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'))\n            return false;\n        const rect = element.getBoundingClientRect();\n        return rect.width > 0 && rect.height > 0;\n    };\n    const operable = (element) => {\n        if (!visible(element))\n            return false;\n        if ('disabled' in element && element.disabled === true)\n            return false;\n        if (element.getAttribute && element.getAttribute('aria-disabled') === 'true')\n            return false;\n        if (element.closest && element.closest('[inert]'))\n            return false;\n        return true;\n    };\n    const isPasswordField = (element) => element instanceof HTMLInputElement && element.type === 'password';\n    const isHiddenField = (element) => element instanceof HTMLInputElement && element.type === 'hidden';\n    const tagOf = (element) => (element.tagName || '').toLowerCase();\n    const roleOf = (element) => element.getAttribute('role') || '';\n    const labelOf = (element) => {\n        const direct = element.getAttribute('aria-label');\n        if (direct)\n            return direct;\n        const labelled = element.getAttribute('aria-labelledby');\n        if (labelled) {\n            const parts = labelled.split(/\\s+/).map(id => {\n                const target = document.getElementById(id);\n                return target ? (target.textContent || '').trim() : '';\n            }).filter(Boolean);\n            if (parts.length)\n                return parts.join(' ');\n        }\n        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {\n            const labels = element.labels;\n            if (labels && labels.length)\n                return (labels[0].textContent || '').trim();\n            return element.getAttribute('name') || '';\n        }\n        return '';\n    };\n    const textOf = (element) => {\n        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)\n            return '';\n        if (element instanceof HTMLSelectElement) {\n            const option = element.options[element.selectedIndex];\n            return option ? (option.textContent || '').trim() : '';\n        }\n        return (element.innerText !== undefined ? element.innerText : element.textContent || '').replace(/\\s+/g, ' ').trim();\n    };\n    const valueOf = (element) => {\n        if (isPasswordField(element) || isHiddenField(element))\n            return { redacted: true };\n        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)\n            return { value: element.value };\n        if (element instanceof HTMLSelectElement)\n            return { value: element.value, selected: element.selectedIndex };\n        if (element.isContentEditable)\n            return { value: (element.innerText || '').trim() };\n        return {};\n    };\n    const stateOf = (element) => {\n        if (element instanceof HTMLInputElement) {\n            return element.type === 'checkbox' || element.type === 'radio'\n                ? { checked: element.checked, ...(isPasswordField(element) || isHiddenField(element) ? {} : { value: element.value }) }\n                : isPasswordField(element) || isHiddenField(element) ? {} : { value: element.value };\n        }\n        if (element instanceof HTMLTextAreaElement)\n            return isPasswordField(element) ? {} : { value: element.value };\n        if (element instanceof HTMLSelectElement)\n            return { value: element.value, selected: element.selectedIndex };\n        if (element.isContentEditable)\n            return { value: (element.innerText || '').trim() };\n        return {};\n    };\n    const describe = (element, ref) => ({\n        elementRef: ref,\n        tag: tagOf(element),\n        role: roleOf(element),\n        label: labelOf(element),\n        text: textOf(element).slice(0, 500),\n        ...valueOf(element),\n        ...(element instanceof HTMLInputElement ? { type: element.type } : {}),\n        ...(element instanceof HTMLAnchorElement ? { href: safeUrl(element.href) } : {}),\n        visible: visible(element),\n        operable: operable(element),\n        rect: (() => { const r = element.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })(),\n    });\n    const safeUrl = (value) => {\n        try {\n            const url = new URL(value);\n            for (const name of [...url.searchParams.keys()]) {\n                if (SENSITIVE_QUERY.some(sensitive => name.toLowerCase() === sensitive))\n                    url.searchParams.set(name, '[redacted]');\n            }\n            url.username = '';\n            url.password = '';\n            return url.href;\n        }\n        catch {\n            return '[invalid-url]';\n        }\n    };\n    const documentToken = () => registry().documentToken;\n    return { REGISTRY, SENSITIVE_QUERY, registry, mintToken, mintRef, elementOf, visible, operable, isPasswordField, isHiddenField, tagOf, roleOf, labelOf, textOf, valueOf, stateOf, describe, safeUrl, documentToken };\n}";

// ---- generated/PAGE_IDENTITY_SOURCE ----
const PAGE_IDENTITY_SOURCE = "function identity(runtime) {\n    const { REGISTRY, SENSITIVE_QUERY, registry, mintToken, mintRef, elementOf, visible, operable, isPasswordField, isHiddenField, tagOf, roleOf, labelOf, textOf, valueOf, stateOf, describe, safeUrl, documentToken } = runtime;\n    return {\n        ok: true,\n        value: {\n            documentToken: documentToken(),\n            url: safeUrl(location.href),\n            title: (document.title || '').slice(0, 300),\n            readyState: document.readyState,\n        },\n    };\n}";

// ---- generated/PAGE_OBSERVE_SOURCE ----
const PAGE_OBSERVE_SOURCE = "function observe(runtime, MAX_CHARS, MAX_NODES) {\n    const { REGISTRY, SENSITIVE_QUERY, registry, mintToken, mintRef, elementOf, visible, operable, isPasswordField, isHiddenField, tagOf, roleOf, labelOf, textOf, valueOf, stateOf, describe, safeUrl, documentToken } = runtime;\n    const state = registry();\n    state.refs.clear();\n    const roots = [document.body || document.documentElement];\n    const candidates = [];\n    const interactive = 'a[href],button,input,select,textarea,[role],[contenteditable=\"\"],[contenteditable=\"true\"],[tabindex]';\n    for (const root of roots) {\n        if (!root)\n            continue;\n        for (const element of root.querySelectorAll('*')) {\n            if (candidates.length >= MAX_NODES)\n                break;\n            if (element.closest('script,style,noscript,template'))\n                continue;\n            if (element === document.documentElement)\n                continue;\n            const hasText = (element.children.length === 0) && textOf(element).length > 0;\n            const matches = element.matches(interactive);\n            if (!hasText && !matches)\n                continue;\n            if (!visible(element))\n                continue;\n            candidates.push(element);\n        }\n    }\n    const nodes = [];\n    let used = 0;\n    let truncated = false;\n    for (const element of candidates) {\n        const ref = mintRef(element);\n        const entry = describe(element, ref);\n        const cost = (entry.text || '').length + (entry.label || '').length + 40;\n        if (used + cost > MAX_CHARS) {\n            truncated = true;\n            break;\n        }\n        used += cost;\n        nodes.push(entry);\n    }\n    const text = candidates.slice(0, nodes.length).map(element => {\n        const entry = textOf(element);\n        return entry ? entry : '';\n    }).filter(Boolean).join('\\n').slice(0, MAX_CHARS);\n    return {\n        ok: true,\n        value: {\n            documentToken: documentToken(),\n            url: safeUrl(location.href),\n            title: (document.title || '').slice(0, 300),\n            readyState: document.readyState,\n            nodes,\n            text,\n            truncated,\n        },\n    };\n}";

// ---- generated/PAGE_FIND_SOURCE ----
const PAGE_FIND_SOURCE = "function find(runtime, QUERY, LIMIT) {\n    const { REGISTRY, SENSITIVE_QUERY, registry, mintToken, mintRef, elementOf, visible, operable, isPasswordField, isHiddenField, tagOf, roleOf, labelOf, textOf, valueOf, stateOf, describe, safeUrl, documentToken } = runtime;\n    const state = registry();\n    const candidates = new Set();\n    const matchingAncestors = new Set();\n    const matches = [];\n    for (const element of document.querySelectorAll('*')) {\n        if (QUERY.by !== 'text' && candidates.size >= Math.max(2, LIMIT))\n            break;\n        if (element.closest('script,style,noscript,template'))\n            continue;\n        if (!visible(element))\n            continue;\n        let hit = false;\n        if (QUERY.by === 'text') {\n            const text = textOf(element);\n            hit = text.length > 0 && text.includes(QUERY.value);\n        }\n        else if (QUERY.by === 'attr') {\n            hit = element.getAttribute(QUERY.name) === QUERY.value;\n        }\n        else {\n            hit = roleOf(element) === QUERY.value || tagOf(element) === QUERY.value;\n        }\n        if (!hit)\n            continue;\n        candidates.add(element);\n        if (QUERY.by === 'text') {\n            for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {\n                matchingAncestors.add(ancestor);\n            }\n        }\n    }\n    const distinct = Array.from(candidates).filter(element => !matchingAncestors.has(element));\n    for (const element of distinct) {\n        if (matches.length >= LIMIT)\n            break;\n        const ref = mintRef(element);\n        state.refs.set(ref, element);\n        matches.push(describe(element, ref));\n    }\n    return {\n        ok: true,\n        value: {\n            documentToken: documentToken(),\n            matches,\n            ambiguous: distinct.length > 1,\n            limitReached: matches.length >= LIMIT,\n        },\n    };\n}";

// ---- generated/PAGE_ACTION_SOURCE ----
const PAGE_ACTION_SOURCE = "function action(runtime, input, policy) {\n    const { REGISTRY, SENSITIVE_QUERY, registry, mintToken, mintRef, elementOf, visible, operable, isPasswordField, isHiddenField, tagOf, roleOf, labelOf, textOf, valueOf, stateOf, describe, safeUrl, documentToken } = runtime;\n    if (documentToken() !== input.documentToken) {\n        return { ok: false, error: { code: 'stale_observation', message: 'the document changed since the observation; observe again' } };\n    }\n    const element = elementOf(input.elementRef);\n    if (element === undefined) {\n        return { ok: false, error: { code: 'stale_observation', message: 'the referenced element is gone; observe again' } };\n    }\n    if (isPasswordField(element)) {\n        return { ok: false, error: { code: 'unsupported', message: 'password fields are not operated by this plugin' } };\n    }\n    if (!visible(element)) {\n        return { ok: false, error: { code: 'not_operable', message: 'the referenced element is not visible' } };\n    }\n    const refused = policy(runtime, input.pagePolicy ?? input.importScope, element, input.action);\n    if (refused)\n        return refused;\n    if (input.action === 'click') {\n        if (!operable(element)) {\n            return { ok: false, error: { code: 'not_operable', message: 'the referenced element is disabled or inert' } };\n        }\n        element.focus({ preventScroll: true });\n        element.click();\n        return { ok: true, value: { action: 'click', elementRef: input.elementRef, dispatched: true } };\n    }\n    if (input.action === 'type') {\n        const isField = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;\n        if (!isField && !element.isContentEditable) {\n            return { ok: false, error: { code: 'unsupported', message: 'this element does not accept text input' } };\n        }\n        if (!operable(element)) {\n            return { ok: false, error: { code: 'not_operable', message: 'the referenced field is disabled or read-only' } };\n        }\n        if ('readOnly' in element && element.readOnly === true) {\n            return { ok: false, error: { code: 'not_operable', message: 'the referenced field is read-only' } };\n        }\n        element.focus({ preventScroll: true });\n        if (isField) {\n            const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;\n            const setter = Object.getOwnPropertyDescriptor(prototype, 'value');\n            if (setter && setter.set)\n                setter.set.call(element, input.value);\n            else\n                element.value = input.value;\n        }\n        else {\n            const range = document.createRange();\n            range.selectNodeContents(element);\n            const selection = globalThis.getSelection();\n            if (selection) {\n                selection.removeAllRanges();\n                selection.addRange(range);\n            }\n            let inserted = false;\n            if (typeof document.execCommand === 'function') {\n                try {\n                    inserted = document.execCommand('insertText', false, input.value);\n                }\n                catch {\n                    inserted = false;\n                }\n            }\n            if (!inserted) {\n                element.textContent = input.value;\n                const range2 = document.createRange();\n                range2.selectNodeContents(element);\n                const selection2 = globalThis.getSelection();\n                if (selection2) {\n                    selection2.removeAllRanges();\n                    selection2.addRange(range2);\n                }\n            }\n        }\n        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));\n        element.dispatchEvent(new Event('change', { bubbles: true }));\n        return { ok: true, value: { action: 'type', elementRef: input.elementRef, dispatched: true, replaced: true, length: input.value.length } };\n    }\n    if (input.action === 'select') {\n        if (!(element instanceof HTMLSelectElement)) {\n            return { ok: false, error: { code: 'unsupported', message: 'the referenced element is not a select control' } };\n        }\n        if (!operable(element)) {\n            return { ok: false, error: { code: 'not_operable', message: 'the select control is disabled' } };\n        }\n        const option = Array.from(element.options).find(candidate => candidate.value === input.value || (candidate.textContent || '').trim() === input.value);\n        if (option === undefined) {\n            return { ok: false, error: { code: 'not_found', message: 'no option matches the requested value' } };\n        }\n        element.focus({ preventScroll: true });\n        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');\n        if (setter && setter.set)\n            setter.set.call(element, option.value);\n        else\n            element.value = option.value;\n        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));\n        element.dispatchEvent(new Event('change', { bubbles: true }));\n        return { ok: true, value: { action: 'select', elementRef: input.elementRef, dispatched: true, selected: option.value } };\n    }\n    if (input.action === 'check') {\n        const boxy = element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio');\n        const aria = element.getAttribute('aria-checked');\n        if (!boxy && aria === null) {\n            return { ok: false, error: { code: 'unsupported', message: 'the referenced element has no checkable state' } };\n        }\n        if (!operable(element)) {\n            return { ok: false, error: { code: 'not_operable', message: 'the referenced control is disabled' } };\n        }\n        element.focus({ preventScroll: true });\n        if (boxy) {\n            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');\n            if (setter && setter.set)\n                setter.set.call(element, input.checked);\n            else\n                element.checked = input.checked;\n        }\n        else {\n            element.setAttribute('aria-checked', input.checked ? 'true' : 'false');\n        }\n        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));\n        element.dispatchEvent(new Event('change', { bubbles: true }));\n        return { ok: true, value: { action: 'check', elementRef: input.elementRef, dispatched: true, checked: input.checked } };\n    }\n    return { ok: false, error: { code: 'unsupported', message: 'unknown action' } };\n}";

// ---- generated/PAGE_WAIT_SOURCE ----
const PAGE_WAIT_SOURCE = "function wait(runtime, input) {\n    const { REGISTRY, SENSITIVE_QUERY, registry, mintToken, mintRef, elementOf, visible, operable, isPasswordField, isHiddenField, tagOf, roleOf, labelOf, textOf, valueOf, stateOf, describe, safeUrl, documentToken } = runtime;\n    if (documentToken() !== input.target.documentToken) {\n        return { ok: false, error: { code: 'stale_observation', message: 'the document changed since the observation; observe again' } };\n    }\n    const evaluate = () => {\n        const element = elementOf(input.target.elementRef);\n        if (input.condition === 'absent')\n            return element === undefined || !visible(element);\n        if (element === undefined)\n            return false;\n        if (input.condition === 'present')\n            return visible(element);\n        return textOf(element).includes((input.text ?? ''));\n    };\n    if (evaluate()) {\n        return { ok: true, value: { condition: input.condition, satisfied: true, waitedMs: 0 } };\n    }\n    const started = Date.now();\n    return new Promise(resolve => {\n        const finish = (satisfied, timedOut) => {\n            observer.disconnect();\n            clearTimeout(timer);\n            resolve({ ok: true, value: { condition: input.condition, satisfied, timedOut, waitedMs: Date.now() - started } });\n        };\n        const observer = new MutationObserver(() => { if (evaluate())\n            finish(true, false); });\n        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });\n        const timer = setTimeout(() => finish(evaluate(), true), Math.max(0, input.timeoutMs));\n    });\n}";

// ---- generated/PAGE_POLICY_SOURCE ----
const PAGE_POLICY_SOURCE = "function policy(runtime, scope, element, ACTION) {\n    const { REGISTRY, SENSITIVE_QUERY, registry, mintToken, mintRef, elementOf, visible, operable, isPasswordField, isHiddenField, tagOf, roleOf, labelOf, textOf, valueOf, stateOf, describe, safeUrl, documentToken } = runtime;\n    const importRestriction = scope || registry().importState?.scope;\n    if (importRestriction) {\n        if (location.origin !== \"https://fuwu.rsj.beijing.gov.cn\" || ACTION !== 'click')\n            return { ok: false, error: { code: 'not_operable', message: 'the import scope permits only its named navigation actions' } };\n        const control = (element.closest('button,a,input,[role=\"button\"],[role=\"tab\"],.el-menu-item,.el-submenu__title') || element);\n        const clean = (value) => String(value || '').replace(/\\s/g, '');\n        const descriptions = [textOf(control), control.getAttribute('aria-label'), control.getAttribute('title'), control.value].filter(Boolean).map(clean);\n        const label = clean(textOf(element));\n        if (control instanceof HTMLButtonElement && control.form && control.type !== 'button')\n            return { ok: false, error: { code: 'not_operable', message: 'form submission is outside the import scope' } };\n        if (control.getAttribute('formaction') || descriptions.some(text => /提交|保存|送达|审核|删除|上传|申报/.test(text)))\n            return { ok: false, error: { code: 'not_operable', message: 'business dispatch is outside the import scope' } };\n        const allowed = importRestriction.workflow === \"navigation\" ? [\"在职职工管理\", \"（增减员）\", \"批量导入\"] : [...[\"在职职工管理\", \"（增减员）\", \"批量导入\", \"单位信息\", \"单位信息变更\", \"返回工作台\"], ...[\"信息录入成功\", \"信息录入失败\"], { \"add\": \"批量增员\", \"modify\": \"批量修改\", \"reduce\": \"批量减员\" }[importRestriction.kind ?? '']];\n        if (registry().importState?.selectedAt !== null && registry().importState?.selectedAt !== undefined && !registry().importState?.closed && [\"信息录入成功\", \"信息录入失败\"].includes(label))\n            return { ok: false, error: { code: 'not_operable', message: 'result tabs cannot manufacture a refresh during import verification' } };\n        if (!allowed.includes(label) || descriptions.some(text => text !== label)) {\n            const box = control.closest('.el-message-box');\n            const buttons = box ? Array.from(box.querySelectorAll('button,a,input,[role=\"button\"]')).filter(visible) : [];\n            const summary = box ? clean(box.textContent) : '';\n            const dismissible = importRestriction.workflow !== \"navigation\" && box && /导入/.test(summary) && /(?:成功|失败|记录)/.test(summary)\n                && buttons.length === 1 && buttons[0] === control && ['确定', '关闭', 'Close'].includes(label)\n                && control.type === 'button' && descriptions.every(text => ['确定', '关闭', 'Close'].includes(text));\n            if (!dismissible)\n                return { ok: false, error: { code: 'not_operable', message: 'this action is outside the import scope' } };\n        }\n    }\n}";

// ---- generated/passive-import ----
const PASSIVE_IMPORT_SOURCE = "function passiveImport(runtime, input, config) {\n    const { REGISTRY, SENSITIVE_QUERY, registry, mintToken, mintRef, elementOf, visible, operable, isPasswordField, isHiddenField, tagOf, roleOf, labelOf, textOf, valueOf, stateOf, describe, safeUrl, documentToken } = runtime;\n    const { origin, paths, tabs, knowledge, limit } = config;\n    const refusal = (code, message) => ({ ok: false, error: { code, message } });\n    let state = registry().importState;\n    if (input.mode === 'dispose') {\n        if (state && state.owner === input.owner) {\n            state.dispose();\n            delete registry().importState;\n        }\n        return { ok: true, value: { cleanupFailed: !!state?.cleanupFailed } };\n    }\n    if (location.origin !== origin)\n        return refusal('unsupported', 'Beijing import requires its exact portal origin');\n    if (!state || state.owner !== input.owner) {\n        if (state)\n            state.dispose();\n        const originals = { fetch: globalThis.fetch, open: globalThis.XMLHttpRequest?.prototype.open, send: globalThis.XMLHttpRequest?.prototype.send };\n        const initialized = { owner: input.owner, scope: input.scope, documentToken: documentToken(), closed: false, cleanupFailed: false, coverage: false,\n            requests: [], resources: [], unitBodies: [], unitPending: 0, selectedAt: null, fileGrantId: null, selectedNode: null, acceptedChange: -1, rejectedChange: -1, version: 0, summary: null, summaryAt: -1, issue: false, expired: false, cache: null, listeners: [], timer: null, observer: null, resourceObserver: null, hooksIntact: () => false, dispose: () => { throw new Error('capture-initializing'); }, snapshot: () => { throw new Error('capture-initializing'); } };\n        state = initialized;\n        registry().importState = state;\n        const owned = state;\n        const native = (fn) => typeof fn === 'function' && Function.prototype.toString.call(fn).includes('[native code]');\n        const endpoint = (url) => { try {\n            const parsed = new URL(url, location.href);\n            return parsed.origin === origin ? parsed.pathname : null;\n        }\n        catch {\n            return null;\n        } };\n        const unitPath = (url) => { const path = endpoint(url)?.toLowerCase(); return path && knowledge.unitPathSuffixes.some(suffix => path.endsWith(suffix)); };\n        const checkPath = (url) => Object.values(paths).some(path => path === endpoint(url));\n        const remember = (method, url) => {\n            if (owned.closed)\n                return null;\n            const unit = !!unitPath(url);\n            const check = checkPath(url);\n            if (!unit && !check)\n                return null;\n            if (owned.requests.length >= 1000) {\n                owned.issue = true;\n                return null;\n            }\n            const request = { id: 'request-' + owned.requests.length, method: String(method).toUpperCase(), url: new URL(url, location.href).href, unit, check, owned: owned.selectedAt !== null, startedAt: performance.now(), complete: false, status: 0, body: '', failed: false };\n            owned.requests.push(request);\n            if (unit)\n                owned.unitPending++;\n            return request;\n        };\n        const finish = (request, status, body, complete, responseUrl) => {\n            if (!request || owned.closed || request.finished)\n                return;\n            request.finished = true;\n            request.responseUrl = responseUrl || '';\n            request.status = status;\n            request.complete = !!complete && request.responseUrl === request.url;\n            request.body = typeof body === 'string' ? body.slice(0, limit) : '';\n            if (request.unit) {\n                owned.unitPending--;\n                if (status >= 200 && status < 300 && request.complete && typeof body === 'string' && body.length < limit) {\n                    if (owned.unitBodies.length >= 64)\n                        owned.issue = true;\n                    else\n                        owned.unitBodies.push(body);\n                }\n                else\n                    owned.issue = true;\n            }\n            owned.snapshot();\n        };\n        const xhrInfo = new WeakMap();\n        const wrappedOpen = function (method, url, ...rest) { xhrInfo.set(this, { method, url: String(url) }); return Reflect.apply(originals.open, this, [method, url, ...rest]); };\n        const wrappedSend = function (...args) {\n            const info = xhrInfo.get(this);\n            const request = info ? remember(info.method, info.url) : null;\n            if (request) {\n                const target = this;\n                const listener = () => { try {\n                    finish(request, target.status, target.responseType === '' || target.responseType === 'text' ? target.responseText : null, true, target.responseURL);\n                }\n                catch {\n                    finish(request, 0, null, false);\n                } };\n                target.addEventListener('loadend', listener, { once: true });\n                owned.listeners.push({ target, listener });\n            }\n            try {\n                return Reflect.apply(originals.send, this, args);\n            }\n            catch (error) {\n                if (request) {\n                    request.failed = true;\n                    finish(request, 0, null, false);\n                }\n                throw error;\n            }\n        };\n        const wrappedFetch = function (...args) {\n            let request = null;\n            try {\n                const [resource, options] = args;\n                request = remember(options?.method || (resource instanceof Request ? resource.method : 'GET'), resource instanceof Request ? resource.url : String(resource));\n            }\n            catch {\n                owned.issue = true;\n            }\n            let promise;\n            try {\n                promise = Reflect.apply(originals.fetch, this, args);\n            }\n            catch (error) {\n                if (request)\n                    finish(request, 0, null, false);\n                throw error;\n            }\n            if (request)\n                void promise.then(async (response) => {\n                    if (owned.closed)\n                        return;\n                    const reader = response.clone().body?.getReader();\n                    if (!reader) {\n                        finish(request, response.status, '', true, response.url);\n                        return;\n                    }\n                    const decoder = new TextDecoder();\n                    let body = '';\n                    let complete = false;\n                    try {\n                        while (!owned.closed) {\n                            const chunk = await reader.read();\n                            if (chunk.done) {\n                                body += decoder.decode();\n                                complete = body.length < limit;\n                                break;\n                            }\n                            body += decoder.decode(chunk.value, { stream: true });\n                            if (body.length >= limit)\n                                break;\n                        }\n                    }\n                    finally {\n                        void reader.cancel().catch(() => { });\n                    }\n                    finish(request, response.status, body, complete, response.url);\n                }, () => finish(request, 0, null, false)).catch(() => { owned.issue = true; });\n            return promise;\n        };\n        owned.hooksIntact = () => globalThis.fetch === wrappedFetch && globalThis.XMLHttpRequest.prototype.open === wrappedOpen && globalThis.XMLHttpRequest.prototype.send === wrappedSend;\n        owned.dispose = () => {\n            if (owned.closed)\n                return;\n            owned.closed = true;\n            if (owned.timer !== null)\n                clearTimeout(owned.timer);\n            owned.observer?.disconnect();\n            owned.resourceObserver?.disconnect();\n            for (const { target, listener } of owned.listeners)\n                target.removeEventListener('loadend', listener);\n            try {\n                if (globalThis.fetch === wrappedFetch)\n                    globalThis.fetch = originals.fetch;\n                else\n                    owned.cleanupFailed = true;\n                if (originals.open) {\n                    const proto = globalThis.XMLHttpRequest.prototype;\n                    if (proto.open === wrappedOpen)\n                        proto.open = originals.open;\n                    else\n                        owned.cleanupFailed = true;\n                    if (proto.send === wrappedSend)\n                        proto.send = originals.send;\n                    else\n                        owned.cleanupFailed = true;\n                }\n            }\n            catch {\n                owned.cleanupFailed = true;\n            }\n        };\n        const clean = (value) => String(value || '').replace(/\\s/g, '');\n        const classify = (table) => {\n            const headers = Array.from(table.querySelectorAll('.el-table__header th')).map(el => clean(el.textContent));\n            if (headers.includes(knowledge.failureHeader))\n                return 'rejectedChange';\n            if (headers.includes(knowledge.successHeader) && !headers.includes(knowledge.excludedHeader))\n                return 'acceptedChange';\n            return null;\n        };\n        const summary = () => {\n            const candidates = Array.from(document.querySelectorAll('.el-message,.el-message-box__message,.el-notification__content')).map(el => clean(el.textContent)).filter(text => text.includes('导入') && /(?:成功|失败|记录)/.test(text));\n            if (candidates.length !== 1)\n                return null;\n            const text = candidates[0];\n            const success = /(?:成功)(\\d+)/.exec(text) || /(\\d+)(?:条)?(?:记录)?成功/.exec(text);\n            const failure = /(?:失败)(\\d+)/.exec(text) || /(\\d+)(?:条)?(?:记录)?失败/.exec(text);\n            const total = /有(\\d+)条记录/.exec(text) || /共(\\d+)条/.exec(text);\n            if (!success || !failure || !total)\n                return null;\n            return { total: Number(total[1]), success: Number(success[1]), failure: Number(failure[1]) };\n        };\n        const tables = (completion) => {\n            const all = Array.from(document.querySelectorAll('.el-table'));\n            const accepted = all.filter(el => classify(el) === 'acceptedChange');\n            const rejected = all.filter(el => classify(el) === 'rejectedChange');\n            const result = { fresh: owned.acceptedChange > completion && owned.rejectedChange > completion, complete: false, accepted: [], rejected: [] };\n            if (accepted.length !== 1 || rejected.length !== 1 || Array.from(document.querySelectorAll('.el-pagination .btn-next')).some(el => !el.disabled && !el.classList.contains('disabled'))\n                || Array.from(document.querySelectorAll('.el-loading-mask')).some(visible))\n                return result;\n            const version = owned.version;\n            for (const [kind, table] of [['accepted', accepted[0]], ['rejected', rejected[0]]]) {\n                const headers = Array.from(table.querySelectorAll('.el-table__header th')).map(el => clean(el.textContent));\n                const names = headers.flatMap((h, i) => h === knowledge.nameHeader ? [i] : []);\n                const ids = headers.flatMap((h, i) => knowledge.identityHeaders.includes(h) ? [i] : []);\n                const reasons = headers.flatMap((h, i) => h === knowledge.failureHeader ? [i] : []);\n                if (names.length !== 1 || ids.length !== 1 || headers.some(h => !h) || (kind === 'rejected' && reasons.length !== 1))\n                    return result;\n                const rows = Array.from(table.querySelectorAll('.el-table__body-wrapper tbody tr'));\n                for (const row of rows) {\n                    const cells = Array.from(row.querySelectorAll('td')).map(el => (el.textContent || '').trim());\n                    if (cells.length !== headers.length)\n                        return result;\n                    const name = cells[names[0]];\n                    const certificateNumber = cells[ids[0]].trim().toUpperCase();\n                    if (!name || !/^\\d{17}[\\dX]$/.test(certificateNumber) || (kind === 'rejected' && !cells[reasons[0]]))\n                        return result;\n                    result[kind].push({ name, certificateNumber });\n                }\n                if (!rows.length && !table.querySelector('.el-table__empty-block'))\n                    return result;\n            }\n            result.complete = version === owned.version;\n            return result;\n        };\n        owned.snapshot = () => {\n            if (owned.cache)\n                return owned.cache;\n            const active = owned.requests.filter(r => r.check && r.owned);\n            const response = active.length === 1 ? active[0] : null;\n            const resources = response ? owned.resources.filter(r => r.name === response.url && r.startTime >= (owned.selectedAt ?? 0)) : [];\n            const resource = resources.length === 1 ? resources[0] : null;\n            const completion = resource && resource.responseEnd > resource.startTime ? resource.responseEnd : null;\n            const interference = owned.issue || owned.requests.some(r => r.check && !r.owned && r.complete && owned.selectedAt !== null)\n                || (owned.selectedAt !== null && owned.resources.some(r => r.startTime < (owned.selectedAt ?? 0) && r.responseEnd >= (completion ?? owned.selectedAt ?? 0)))\n                || (owned.selectedAt !== null && owned.resources.filter(r => r.startTime >= (owned.selectedAt ?? 0)).length !== active.length)\n                || resources.length > 1;\n            const snapshot = { requestCount: active.length, pending: active.filter(r => !r.complete).length, interference,\n                ...(response ? { response: { requestId: response.id, responseRequestId: response.id, method: response.method, url: response.responseUrl || response.url, status: response.status, complete: response.complete && completion !== null, body: response.body } } : {}),\n                ...(completion !== null ? { tables: tables(completion) } : {}), ...(owned.summary && owned.summaryAt > (owned.selectedAt ?? 0) ? { summary: owned.summary } : {}) };\n            return snapshot;\n        };\n        try {\n            if (!native(originals.fetch) || !native(originals.open) || !native(originals.send) || typeof PerformanceObserver !== 'function')\n                throw new Error('capture-unsupported');\n            globalThis.fetch = wrappedFetch;\n            globalThis.XMLHttpRequest.prototype.open = wrappedOpen;\n            globalThis.XMLHttpRequest.prototype.send = wrappedSend;\n            owned.observer = new MutationObserver(records => {\n                if (owned.closed || owned.selectedAt === null)\n                    return;\n                for (const record of records) {\n                    const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;\n                    const table = element?.closest('.el-table');\n                    const region = element?.closest('tbody,.el-table__empty-block');\n                    if (table && region) {\n                        const key = classify(table);\n                        if (key) {\n                            owned[key] = performance.now();\n                            owned.version++;\n                        }\n                    }\n                    for (const added of record.addedNodes) {\n                        if (added.nodeType !== 1)\n                            continue;\n                        const addedElement = added;\n                        for (const candidate of [addedElement, ...addedElement.querySelectorAll('.el-table')]) {\n                            const t = candidate.matches('.el-table') ? candidate : candidate.matches('tbody,.el-table__body-wrapper,.el-table__empty-block') ? candidate.closest('.el-table') : null;\n                            const key = t ? classify(t) : null;\n                            if (key) {\n                                owned[key] = performance.now();\n                                owned.version++;\n                            }\n                        }\n                    }\n                }\n                const selector = '.el-message,.el-message-box__message,.el-notification__content';\n                const summaryChanged = records.some(record => { const el = record.target.nodeType === 1 ? record.target : record.target.parentElement; return el?.closest(selector) || Array.from(record.addedNodes).some(node => node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))); });\n                if (summaryChanged) {\n                    const current = summary();\n                    if (current) {\n                        owned.summary = current;\n                        owned.summaryAt = performance.now();\n                    }\n                }\n            });\n            owned.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });\n            owned.resourceObserver = new PerformanceObserver(list => { if (owned.closed)\n                return; for (const entry of list.getEntries()) {\n                if (checkPath(entry.name)) {\n                    if (owned.resources.length >= 1000)\n                        owned.issue = true;\n                    else\n                        owned.resources.push({ name: entry.name, startTime: entry.startTime, responseEnd: entry.responseEnd });\n                }\n            } });\n            owned.resourceObserver.observe({ type: 'resource', buffered: true });\n            owned.coverage = true;\n        }\n        catch {\n            owned.coverage = false;\n            owned.issue = true;\n            owned.dispose();\n        }\n        if (!owned.closed)\n            owned.timer = setTimeout(() => { owned.cache = owned.snapshot(); owned.expired = true; owned.dispose(); }, input.windowMs);\n    }\n    if (state.documentToken !== documentToken())\n        return refusal('stale_observation', 'the import document changed');\n    if (input.mode === 'set_file') {\n        if (state.closed || !state.coverage || state.issue || state.fileGrantId !== null)\n            return refusal('not_operable', 'the import window is unavailable or already consumed');\n        if (!state.hooksIntact())\n            return refusal('not_operable', 'the observation hook changed');\n        if (input.target.documentToken !== documentToken())\n            return refusal('stale_observation', 'the file target document changed');\n        const target = elementOf(input.target.elementRef);\n        const container = target?.closest('.el-upload');\n        const candidates = container ? Array.from(container.querySelectorAll('input.el-upload__input[type=\"file\"]')) : [];\n        const all = Array.from(document.querySelectorAll('input.el-upload__input[type=\"file\"]'));\n        const file = input.file;\n        const active = Array.from(document.querySelectorAll('[role=\"tab\"],.el-tabs__item')).filter(el => el.classList.contains('is-active') || el.getAttribute('aria-selected') === 'true');\n        if (!target || !operable(target) || textOf(target).replace(/\\s/g, '') !== knowledge.uploadLabel || candidates.length !== 1 || all.length !== 1 || candidates[0] !== all[0]\n            || candidates[0].disabled || !active.some(el => textOf(el).replace(/\\s/g, '') === tabs[file.kind]) || active.some(el => Object.values(tabs).includes(textOf(el).replace(/\\s/g, '')) && textOf(el).replace(/\\s/g, '') !== tabs[file.kind]))\n            return refusal('not_operable', 'the unique file input or active business tab is not proven');\n        const unitIds = new Set();\n        const legalIds = new Set();\n        const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);\n        for (const text of state.unitBodies) {\n            try {\n                const body = JSON.parse(text);\n                if (!record(body) || !record(body.map) || !Array.isArray(body.map.data))\n                    continue;\n                for (const row of body.map.data) {\n                    if (!record(row))\n                        continue;\n                    for (const scope of [row, row.unitDTO, row.unitExtensionDTO, ...(Array.isArray(row.unitInsuranceDTOList) ? row.unitInsuranceDTOList : [])]) {\n                        if (!record(scope))\n                            continue;\n                        if (typeof scope.unitId === 'string')\n                            unitIds.add(scope.unitId.trim().toUpperCase());\n                        for (const key of ['socialCreditCode', 'unifiedSocialCreditCode', 'uscc']) {\n                            const value = scope[key];\n                            if (typeof value === 'string')\n                                legalIds.add(value.trim().toUpperCase());\n                        }\n                    }\n                }\n            }\n            catch {\n                return refusal('not_operable', 'the unit observation is unreadable');\n            }\n        }\n        if (state.unitPending !== 0 || unitIds.size === 0 || legalIds.size === 0 || [...unitIds].some(id => id !== file.expectedIdentity.unitId) || [...legalIds].some(id => id !== file.expectedIdentity.legalIdentity))\n            return refusal('not_operable', 'both current identity anchors must match before selection');\n        let bytes;\n        try {\n            const binary = atob(file.base64);\n            bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));\n            if (bytes.length !== file.bytes)\n                throw new Error('size');\n        }\n        catch {\n            return refusal('invalid_request', 'file encoding is invalid');\n        }\n        const node = candidates[0];\n        const transfer = new DataTransfer();\n        transfer.items.add(new File([bytes], file.name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));\n        if (!node.isConnected || elementOf(input.target.elementRef) !== target || document.querySelectorAll('input.el-upload__input[type=\"file\"]').length !== 1 || registry().importState !== state || state.closed)\n            return refusal('revoked', 'file authorization changed before selection');\n        state.fileGrantId = file.fileGrantId;\n        state.selectedNode = node;\n        state.selectedAt = performance.now();\n        state.acceptedChange = -1;\n        state.rejectedChange = -1;\n        state.summary = null;\n        state.summaryAt = -1;\n        if (state.timer !== null)\n            clearTimeout(state.timer);\n        state.timer = setTimeout(() => { state.cache = state.snapshot(); state.expired = true; state.dispose(); }, input.windowMs);\n        try {\n            node.files = transfer.files;\n            node.dispatchEvent(new Event('input', { bubbles: true, composed: true }));\n            node.dispatchEvent(new Event('change', { bubbles: true, composed: true }));\n        }\n        catch {\n            return refusal('unknown_outcome', 'file selection may have run');\n        }\n        return { ok: true, value: { action: 'set_file', dispatched: true, fileGrantId: file.fileGrantId } };\n    }\n    const collected = state.snapshot();\n    if (!state.closed && collected.response?.complete && collected.tables?.fresh && collected.tables?.complete && collected.summary) {\n        state.cache = collected;\n        state.dispose();\n    }\n    const evidence = { unitBodies: state.unitBodies, unitPending: state.unitPending, coverage: state.coverage, closed: state.closed, expired: state.expired, cleanupFailed: state.cleanupFailed, fileGrantId: state.fileGrantId, facts: collected };\n    return { ok: true, value: { documentToken: documentToken(), privateImport: evidence } };\n}";

// ---- src/pagecode.ts ----
/** Fixed program builders serialize only JSON arguments into compiled TypeScript functions. */

const SENSITIVE_QUERY_NAMES = Object.freeze([
    'token', 'access_token', 'id_token', 'refresh_token', 'code', 'key', 'api_key',
    'secret', 'client_secret', 'password', 'passwd', 'pwd', 'session', 'sessionid',
    'auth', 'authorization', 'sig', 'signature', 'credential', 'otp',
]);
/** @returns Shared runtime initialization for fixed program consumers. */
function prelude() { return `const runtime=(${PAGE_RUNTIME_SOURCE})();const {REGISTRY,SENSITIVE_QUERY,registry,mintToken,mintRef,elementOf,visible,operable,isPasswordField,isHiddenField,tagOf,roleOf,labelOf,textOf,valueOf,stateOf,describe,safeUrl,documentToken}=runtime;`; }
/** @returns Identity program for the current document. */
function identityProgram() { return `(function(){${prelude()}return (${PAGE_IDENTITY_SOURCE})(runtime);})()`; }
/** @param maxChars - text budget. @param maxNodes - node budget. @returns Bounded observation program. */
function observeProgram(maxChars, maxNodes) { return `(function(){${prelude()}return (${PAGE_OBSERVE_SOURCE})(runtime,${JSON.stringify(maxChars)},${JSON.stringify(maxNodes)});})()`; }
/** @param query - validated locator. @param limit - maximum returned matches. @returns Fixed locator program. */
function findProgram(query, limit) { return `(function(){${prelude()}return (${PAGE_FIND_SOURCE})(runtime,${JSON.stringify(query)},${JSON.stringify(limit)});})()`; }
/** @param input - validated page action and reference. @returns One fixed action without retries. */
function actProgram(input) { return `(function(){${prelude()}return (${PAGE_ACTION_SOURCE})(runtime,${JSON.stringify(input)},(${PAGE_POLICY_SOURCE}));})()`; }
/** @param input - validated document condition and relative timeout. @returns Fixed DOM wait program. */
function waitProgram(input) { return `(function(){${prelude()}return (${PAGE_WAIT_SOURCE})(runtime,${JSON.stringify(input)});})()`; }
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

// ---- src/import-rules.ts ----
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
    let body;
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
    const accepted = [];
    const rejected = [];
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

// ---- src/import-page.ts ----
/** Fixed passive observer and one-file assignment compiled from TypeScript. */


/** @param scope - code-owned restriction. @returns Fixed policy declaration for program composition. */
function importActionPolicy(scope) { return `const importPolicy=(${PAGE_POLICY_SOURCE});const importScope=${JSON.stringify(scope ?? null)};`; }
/** @param input - validated owner, mode and relative lifetime. @returns Self-contained passive observation program. */
function importProgram(input) {
    const config = { origin: IMPORT_ORIGIN, paths: IMPORT_PATHS, tabs: IMPORT_TABS, knowledge: IMPORT_DATA, limit: BODY_LIMIT };
    return `(function(){const runtime=(${PAGE_RUNTIME_SOURCE})();return (${PASSIVE_IMPORT_SOURCE})(runtime,${JSON.stringify(input)},${JSON.stringify(config)});})()`;
}

// ---- src/panel.ts ----
/**
 * The Browser Flow panel component.
 *
 * This is a normal ES module so it can be imported and tested directly. The
 * client build inlines it (with `pagecode.ts` and `clientcore.ts`) into the
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
/** Page-program builders, as the panel consumes them. @type {PagePrograms} */
const PAGE_CODE = Object.freeze({
    identity: identityProgram(),
    import: input => importProgram((input)),
    observe: (maxChars, maxNodes) => observeProgram(maxChars, maxNodes),
    find: (query, limit) => findProgram((query), limit),
    act: input => actProgram((input)),
    wait: input => waitProgram((input)),
});
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
        taskTitle: '当前任务', taskGoal: '目标', taskOrigins: '允许的源站（以逗号分隔）', taskDefinition: '本地任务定义', taskGeneric: '通用任务', taskWorkflow: '操作说明', createTask: '创建并绑定任务', openTask: '打开本会话任务', reviseTask: '修订目标与范围', cancelTask: '取消任务并撤销', finishTask: '结束并人工交接', invalidReply: 'Host 响应无效，请配套重载 Host 和 Client',
        taskMissing: '先创建或打开当前会话的任务，再授权页面。', taskBlocked: '此任务的写结果未知或日志不可用：仅允许读取、撤销及人工交接。',
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
        taskTitle: 'Current task', taskGoal: 'Goal', taskOrigins: 'Allowed origins (comma separated)', taskDefinition: 'Local definition', taskGeneric: 'Generic task', taskWorkflow: 'Instructions', createTask: 'Create and bind task', openTask: 'Open this session’s task', reviseTask: 'Revise goal and scope', cancelTask: 'Cancel task and revoke', finishTask: 'End and hand off', invalidReply: 'Host response is invalid; reload the paired Host and Client', taskMissing: 'Create or open this session’s task before authorizing a page.', taskBlocked: 'Unknown write or unavailable log: only read, revoke and hand off.',
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
     * @returns {unknown} element tree.
     */
    return function Panel(props) {
        const sessionId = props.sessionId;
        const tabInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined;
        const [pages, setPages] = React.useState(([]));
        const [connected, setConnected] = React.useState(false);
        const [liveAgent, setLiveAgent] = React.useState(false);
        const [agentSummary, setAgentSummary] = React.useState(undefined);
        const [error, setError] = React.useState(undefined);
        const [authorized, setAuthorized] = React.useState(undefined);
        const [busy, setBusy] = React.useState(false);
        const [fileForm, setFileForm] = React.useState({ path: '', kind: 'add', unitId: '', legalIdentity: '', firstRow: '2', lastRow: '2' });
        const [filePreview, setFilePreview] = React.useState(undefined);
        const [supported] = React.useState(() => core.hostSupportsPageControl(((globalThis).dshDesktop)));
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
        const disposeImport = React.useCallback((binding) => {
            if (!binding?.importOwner || !pageCode.import || !binding.element?.isConnected)
                return;
            const program = pageCode.import({ mode: 'dispose', owner: binding.importOwner });
            void binding.element.executeJavaScript(program, true).then((value) => {
                if (alive.current && isRecord(value) && isRecord(value.value) && value.value.cleanupFailed)
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
        const abandoned = React.useRef(new Set());
        const post = React.useCallback(async (route, body) => {
            const response = await fetch(route, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...body }),
                credentials: 'same-origin',
            });
            try {
                return decodePanelReply(await response.json());
            }
            catch {
                return { ok: false, error: { code: 'internal', message: `Host answered ${String(response.status)} without JSON` } };
            }
        }, []);
        const elements = React.useCallback(() => [...document.querySelectorAll(core.WEBVIEW_SELECTOR)], [core]);
        const elementOf = React.useCallback((lease) => elements().find((element) => element.getAttribute('name') === lease), [elements]);
        /**
         * Refuse a command that does not address the authorization this panel holds.
         *
         * The Host decides what to dispatch; this decides whether *this* panel may
         * execute it. Without it a command minted for one authorization would run
         * against whatever page the panel is bound to now.
         * @param {PanelBinding} command - command envelope taken from the Host.
         * @param {PanelBinding} binding - the authorization this panel holds.
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
         * @param {PanelBinding} binding - the authorization that changed.
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
                    ? (answer.value.affected ?? []).find((entry) => entry.controlLeaseId === binding.controlLeaseId)
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
                if (!isRecord(probe) || probe.ok !== true || !isRecord(probe.value) || typeof probe.value.url !== 'string' || typeof probe.value.title !== 'string' || typeof probe.value.documentToken !== 'string')
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
        const execute = React.useCallback(async (command, batchReceivedAt) => {
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
            if (!isRecord(live) || live.ok !== true || !isRecord(live.value) || typeof live.value.url !== 'string' || typeof live.value.documentToken !== 'string') {
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
            const file = op.file;
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
            if (op.importOwner)
                binding.importOwner = op.importOwner;
            let source;
            try {
                source = core.programFor(pageCode, op);
            }
            catch (failure) {
                return { outcome: 'failed', error: { code: 'unsupported', message: String((failure)?.message ?? failure) } };
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
                        const scanned = found.find((entry) => entry.lease === binding.lease);
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
                    const polledTask = isTaskSummary(polled.value.task) ? polled.value.task : undefined;
                    setTaskSummary(polledTask);
                    setDefinitions(polled.value.definitions ?? []);
                    if (bound.current && polledTask && !sameRunScope(bound.current.task, polledTask.task))
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
                    for (const command of polled.value.commands ?? []) {
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
                        setError({ code: 'internal', message: String((failure)?.message ?? failure) });
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
        const authorize = React.useCallback(async (page) => {
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
                    if (!validRunScope(answer.value.task) || typeof answer.value.controlLeaseId !== 'string' || typeof answer.value.epoch !== 'number' || typeof answer.value.documentToken !== 'string') {
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
        const fileOperation = async (operation) => {
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
                if (operation === 'prepare') {
                    if (isFilePreview(answer.value))
                        setFilePreview(answer.value);
                    else
                        setError({ code: 'protocol_violation', message: t('invalidReply') });
                }
                else if (filePreview)
                    setFilePreview({ ...filePreview, confirmed: true });
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
        const taskOperation = async (operation) => {
            if (['revise', 'cancel', 'finish'].includes(operation))
                suspendControl();
            setBusy(true);
            try {
                const answer = await post(ROUTES.authorize, { instanceId, connectionGeneration: generation.current, sessionId, taskOperation: operation,
                    ...(operation === 'create' ? { spec: { goal: taskForm.goal, ...(taskForm.definitionId ? { definitionId: taskForm.definitionId, workflowRef: taskForm.workflowRef } : { origins: taskForm.origins.split(',').map((part) => part.trim()).filter(Boolean) }) } } : {}),
                    ...(operation === 'revise' ? { task: taskSummary?.task, spec: { goal: taskForm.goal, ...(taskSummary?.adapter === 'generic' ? { origins: taskForm.origins.split(',').map((part) => part.trim()).filter(Boolean) } : {}) } } : {}),
                    ...(operation === 'resume' ? { task: taskSummary?.task, waitId: taskSummary?.active_context?.waiting?.id, userInput } : {}),
                    ...(['cancel', 'finish'].includes(operation) ? { task: taskSummary?.task } : {}) });
                if (!alive.current)
                    return;
                if (answer?.ok && isTaskSummary(answer.value)) {
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
        const selectedDefinition = definitions.find((item) => item.id === taskForm.definitionId);
        const taskPanel = h('section', { 'data-browser-flow-task': '' }, h('h4', null, t('taskTitle')), taskSummary ? h('p', { 'data-browser-flow-task-identity': '' }, `${taskSummary.task.taskId} · ${taskSummary.state} · ${taskSummary.goal}`) : h('p', null, t('taskMissing')), taskSummary?.writeBlocked ? h('p', { role: 'alert' }, taskSummary?.state === 'read_only' ? t('taskReadOnly') : t('taskBlocked')) : null, taskSummary?.active_context?.waiting ? h('section', { 'data-browser-flow-user-wait': '' }, h('p', null, t('waitingUser') + ': ' + taskSummary.active_context.waiting.reason), h('p', null, taskSummary.active_context.waiting.resumeCondition), h('label', null, t('userInput'), h('input', { 'data-browser-flow-input': 'user-input', value: userInput, onChange: (event) => setUserInput(event.target.value) })), h('button', { type: 'button', 'data-browser-flow-action': 'task-resume', disabled: busy || taskSummary.writeBlocked, onClick: () => { void taskOperation('resume'); } }, t('resumeTask'))) : null, h('label', null, t('taskGoal'), h('input', { 'data-browser-flow-input': 'task-goal', value: taskForm.goal, onChange: (event) => setTaskForm({ ...taskForm, goal: event.target.value }) })), h('label', null, t('taskOrigins'), h('input', { 'data-browser-flow-input': 'task-origins', value: taskForm.origins, onChange: (event) => setTaskForm({ ...taskForm, origins: event.target.value }) })), h('label', null, t('taskDefinition'), h('select', { 'data-browser-flow-input': 'task-definition', value: taskForm.definitionId, disabled: !!taskSummary, onChange: (event) => { const selected = definitions.find((item) => item.id === event.target.value); setTaskForm({ ...taskForm, definitionId: event.target.value, workflowRef: selected?.workflows[0]?.id ?? '' }); } }, h('option', { value: '' }, t('taskGeneric')), ...definitions.map((item) => h('option', { key: item.id, value: item.id }, item.id)))), selectedDefinition ? h('label', null, t('taskWorkflow'), h('select', { 'data-browser-flow-input': 'task-workflow', value: taskForm.workflowRef, disabled: !!taskSummary, onChange: (event) => setTaskForm({ ...taskForm, workflowRef: event.target.value }) }, ...selectedDefinition.workflows.map((row) => h('option', { key: row.id, value: row.id }, row.description)))) : null, ...(['create', 'open', 'revise', 'cancel', 'finish']).map(operation => h('button', { type: 'button', 'data-browser-flow-action': 'task-' + operation, disabled: (['cancel', 'finish'].includes(operation) ? false : busy) || (['revise', 'cancel', 'finish'].includes(operation) && !taskSummary) || (operation === 'create' && !!taskSummary), onClick: () => { void taskOperation((operation)); } }, t(operation + 'Task'))));
        const rows = pages.map((page) => h('li', { key: page.lease, 'data-browser-flow-page': page.lease }, h('div', { className: 'bf-page-title' }, page.title || page.url), h('div', { className: 'bf-page-url' }, page.url),
        // The alias is what makes two pages on the same address distinguishable.
        h('div', { className: 'bf-page-alias' }, `${t('pageAlias')}: ${page.tabId}`), h('div', { className: 'bf-page-state' }, authorized === page.lease ? t('authorized') : ''), h('button', {
            type: 'button',
            disabled: busy || !supported || !taskSummary,
            'data-browser-flow-action': 'authorize',
            onClick: () => { void authorize(page); },
        }, t('authorize'))));
        const fileFields = ['path', 'unitId', 'legalIdentity', 'firstRow', 'lastRow'].map(key => h('label', { key }, t('file_' + key), h('input', { type: 'text', 'data-browser-flow-input': key, value: fileForm[key], disabled: busy, onChange: (event) => setFileForm({ ...fileForm, [key]: event.target.value }) })));
        const filePanel = authorized && taskSummary?.adapter === 'bjrsj' && !taskSummary?.writeBlocked ? h('section', { 'data-browser-flow-import': '' }, h('h4', null, t('importTitle')), h('p', null, t('importHint')), ...fileFields, h('label', null, t('file_kind'), h('select', { 'data-browser-flow-input': 'kind', value: fileForm.kind, disabled: busy, onChange: (event) => setFileForm({ ...fileForm, kind: event.target.value }) }, ...['add', 'modify', 'reduce'].map(kind => h('option', { key: kind, value: kind }, t('file_' + kind))))), h('button', { type: 'button', 'data-browser-flow-action': 'prepare-file', disabled: busy, onClick: () => { void fileOperation('prepare'); } }, t('prepareFile')), filePreview ? h('div', { 'data-browser-flow-file-preview': '' }, h('p', null, filePreview.path), h('p', null, `${t('file_kind')}: ${t('file_' + filePreview.kind)}; ${filePreview.bytes} ${t('bytes')}; ${filePreview.rows} ${t('rows')}`), h('p', null, 'SHA-256: ' + filePreview.sha256), h('p', null, t('stopBoundary')), h('button', { type: 'button', 'data-browser-flow-action': 'confirm-file', disabled: busy || filePreview.confirmed, onClick: () => { void fileOperation('confirm'); } }, t(filePreview.confirmed ? 'fileConfirmed' : 'confirmFile'))) : null) : null;
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

// ---- src/client.ts ----
/**
 * Browser Flow panel — the client bundle entry.
 *
 * `scripts/build-client.ts` inlines `src/panel.ts`, `src/pagecode.ts` and
 * `src/clientcore.ts` into the shipped `lib/client.js`, the lazy-CJS factory
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
 * @param {import('./panel.ts').ReactLike} React - platform React instance.
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
