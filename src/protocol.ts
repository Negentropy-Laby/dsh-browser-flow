export type ErrorCode = (typeof ERROR_CODES)[number];
/** Canonical success/failure union used inside the Host. */
export type Result<T> = { ok: true; value: T } | ReturnType<typeof failure>
/** A document-scoped reference from the fixed page programs. */
export interface ElementTarget { documentToken: string; elementRef: string }
/** A locator accepted by the model-facing parser. */
export interface FindQuery { by: string; value: string; name?: string }
/** Validated page action arguments; user waits never enter the page queue. */
export interface ActionInput {
  action: string; wait?: unknown
  documentToken?: string; elementRef?: string; fileGrantId?: unknown; value?: unknown; checked?: unknown
}
/** Validated wait arguments. */
export interface WaitInput { condition: string; documentToken: string; elementRef: string; timeoutMs?: number; text?: unknown }
/** Internal page operation, including code-owned import restrictions. */
export interface PageOperation extends Record<string, unknown> {
  kind: 'observe' | 'find' | 'act' | 'wait'; action?: string; view?: string
  maxChars?: number; maxNodes?: number; query?: FindQuery; limit?: number
  target?: { documentToken?: string; elementRef?: string }; condition?: string; timeoutMs?: number
  value?: unknown; checked?: unknown
}
/** A page identity validated during the panel handshake. */
export interface PanelPage {
  lease: string; partition: string; url: string; documentToken: string
  title?: string; tabId?: string; sessionId?: string
}
/** Canonical panel registration; task authorization is a separate operation. */
export interface PanelHello {
  kind: 'hello'; protocolVersion: 3; connectionGeneration: number; sessionId: string
  panel: { instanceId: string; pages: PanelPage[] }
}
/** Canonical command identity, before an operation-specific consumer narrows its payload. */
export interface CommandEnvelope {
  kind: 'command'; protocolVersion: 3; task: import('./task-scope.ts').RunScope
  id: string; leaseId: string; connectionGeneration: number; epoch: number
  sequence: number; deadlineAt: number; op: Record<string, unknown>
}
/** Terminal result identity and bounded optional diagnostic from a panel. */
export interface ResultEnvelope {
  kind: 'result'; protocolVersion: 3; task: import('./task-scope.ts').RunScope
  id: string; leaseId: string; instanceId: string; connectionGeneration: number
  epoch: number; sequence: number; outcome: 'ok' | 'failed' | 'dropped' | 'unknown_outcome'
  payload?: Record<string, unknown>
  error?: Record<string, unknown> & { code?: unknown; message?: string }
}

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

import { validRunScope } from './task-scope.ts'

/** Protocol revision. A mismatch fails the handshake loudly instead of guessing. */
export const PROTOCOL_VERSION = 3

/** Base path of this plugin's Host routes on the existing `/api` connection. */
export const ROUTE_PREFIX = '/api/browser-flow'

/** Longest accepted opaque token, in characters. */
const MAX_TOKEN = 200
/** Longest accepted free-text field (title, url, error detail), in characters. */
const MAX_TEXT = 4000
/** Largest accepted element/observation payload, in characters. */
const MAX_PAYLOAD = 400_000

/** Errors this plugin reports to the model and the panel. */
export const ERROR_CODES = Object.freeze([
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
])

/** Error codes that mean "the action did not run and can be retried after re-observing". */
export const RETRYABLE_CODES = Object.freeze([
  'stale_observation',
  'page_replaced',
  'ambiguous_match',
  'not_found',
  'not_operable',
  'queue_full',
  'deadline_exceeded',
])

/**
 * Whether a failure code may be retried after a fresh observation.
 * `unknown_outcome` is deliberately excluded: a write whose outcome is unknown
 * must never be re-sent automatically.
 * @param {string} code - failure code.
 * @returns {boolean} true when a retry after re-observing is meaningful.
 */
export function isRetryable(code: string) : boolean {
  return RETRYABLE_CODES.includes(code)
}

/**
 * Build a structured failure payload.
 * @param {ErrorCode} code - stable failure category.
 * @param {string} message - human-actionable explanation without page secrets.
 * @param {Record<string, unknown>} [details] - extra structured facts.
 * @returns {{ ok: false, error: { code: string, message: string, details?: Record<string, unknown> } }} failure.
 */
export function failure(code: ErrorCode, message: string, details?: Record<string, unknown>) : {
    ok: false;
    error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
} {

  const error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
} = { code, message }
  if (details !== undefined) error.details = details
  return { ok: false, error }
}

/**
 * Build a structured success payload.
 * @param {unknown} value - canonical result.
 * @returns {{ ok: true, value: unknown }} success.
 */
export function success<T>(value: T) : {
    ok: true;
    value: T;
} {
  return { ok: true, value }
}

/**
 * Whether a value is a plain JSON object.
 *
 * Declared as a type predicate so the validators below narrow their inputs: each
 * one starts from `unknown` and then reads named fields off the record.
 * @param {unknown} value - candidate.
 * @returns {value is Record<string, unknown>} whether it is a plain object.
 */
export function isRecord(value: unknown) : value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read a required string field with a length bound.
 * @param {Record<string, unknown>} row - source object.
 * @param {string} key - field name.
 * @param {number} [max] - maximum accepted length.
 * @returns {string | undefined} the value, or undefined when absent/invalid.
 */
export function readString(row: Record<string, unknown>, key: string, max: number = MAX_TEXT) : string | undefined {
  const value = row[key]
  return typeof value === 'string' && value.length <= max ? value : undefined
}

/**
 * Read an optional string field with a length bound.
 * @param {Record<string, unknown>} row - source object.
 * @param {string} key - field name.
 * @param {number} [max] - maximum accepted length.
 * @returns {string | undefined} the value when it is a bounded string.
 */
export function readOptionalString(row: Record<string, unknown>, key: string, max: number = MAX_TEXT) : string | undefined {
  return row[key] === undefined ? undefined : readString(row, key, max)
}

/**
 * Read a required non-negative safe integer field.
 * @param {Record<string, unknown>} row - source object.
 * @param {string} key - field name.
 * @returns {number | undefined} the value, or undefined when absent/invalid.
 */
export function readCount(row: Record<string, unknown>, key: string) : number | undefined {
  const value = row[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * Read a boolean field.
 * @param {Record<string, unknown>} row - source object.
 * @param {string} key - field name.
 * @returns {boolean | undefined} the value, or undefined when absent/not boolean.
 */
export function readBoolean(row: Record<string, unknown>, key: string) : boolean | undefined {
  const value = row[key]
  return typeof value === 'boolean' ? value : undefined
}

/** Kinds of page operations the plugin can dispatch. */
export const OP_KINDS = Object.freeze(['observe', 'find', 'act', 'wait'])

/** Action kinds inside an `act` operation. */
export const ACTIONS = Object.freeze(['click', 'type', 'select', 'check', 'set_file'])

/** Wait condition kinds. */
export const WAIT_CONDITIONS = Object.freeze(['present', 'absent', 'text'])

/**
 * Validate one Host → Client command envelope.
 *
 * The envelope is the only thing the Client executes, so every field is
 * checked here and nothing is coerced.
 * @param {unknown} value - candidate command.
 * @returns {{ ok: true, command: Record<string, unknown> } | { ok: false, reason: string }} verdict.
 */
export function validateCommand(value: unknown) : {
    ok: true;
    command: CommandEnvelope;
} | {
    ok: false;
    reason: string;
} {
  if (!isRecord(value)) return { ok: false, reason: 'command must be an object' }
  const kind = readString(value, 'kind')
  if (kind !== 'command') return { ok: false, reason: 'kind must be "command"' }
  if (value.protocolVersion !== PROTOCOL_VERSION || !validRunScope(value.task)) return {ok:false,reason:'protocol v3 and complete task/run scope are required'}
  const id = readString(value, 'id', MAX_TOKEN)
  if (id === undefined || id.length === 0) return { ok: false, reason: 'id is required' }
  const leaseId = readString(value, 'leaseId', MAX_TOKEN)
  if (leaseId === undefined || leaseId.length === 0) return { ok: false, reason: 'leaseId is required' }
  const connectionGeneration = readCount(value, 'connectionGeneration')
  if (connectionGeneration === undefined) return { ok: false, reason: 'connectionGeneration is required' }
  const epoch = readCount(value, 'epoch')
  if (epoch === undefined) return { ok: false, reason: 'epoch is required' }
  const sequence = readCount(value, 'sequence')
  if (sequence === undefined) return { ok: false, reason: 'sequence is required' }
  const deadlineAt = value.deadlineAt
  if (typeof deadlineAt !== 'number' || !Number.isFinite(deadlineAt) || deadlineAt < 0) return { ok: false, reason: 'deadlineAt is required' }
  const op = value.op
  if (!isRecord(op)) return { ok: false, reason: 'op is required' }
  const opKind = readString(op, 'kind')
  if (opKind === undefined || !OP_KINDS.includes(opKind)) return { ok: false, reason: 'op.kind is unknown' }
  const validatedOp = validateOp(opKind, op)
  if (!validatedOp.ok) return { ok: false, reason: validatedOp.reason }
  const extended = validateImportExtension(op)
  if (!extended.ok) return extended
  return {
    ok: true,
    command: {
      kind: 'command', protocolVersion: PROTOCOL_VERSION, task: {...value.task}, id, leaseId, connectionGeneration, epoch, sequence, deadlineAt, op: { ...validatedOp.op, ...extended.fields },
    },
  }
}

/** @param {Record<string, unknown>} op - wire operation. @returns {{ok: true, fields: Record<string,unknown>} | {ok: false, reason: string}} bounded import metadata. */
function validateImportExtension(op: Record<string, unknown>) : {
    ok: true;
    fields: Record<string, unknown>;
} | {
    ok: false;
    reason: string;
} {
   const fields: Record<string, unknown> = {}
  if(op.pagePolicy!==undefined){
    const policy=op.pagePolicy
    if(!isRecord(policy)||policy.adapter!=='bjrsj'||!['navigation','import'].includes(String(policy.workflow))||Object.keys(policy).some(key=>!['adapter','workflow','kind'].includes(key))||(policy.kind!==undefined&&!['add','modify','reduce'].includes(String(policy.kind))))return {ok:false,reason:'unsupported site action policy'}
    fields.pagePolicy={...policy}
  }
  const required = op.action === 'set_file' || op.view === 'bjrsj_import'
  if (op.importScope !== undefined || required) {
    const scope = op.importScope
    if (!isRecord(scope) || typeof scope.kind!=='string' || !['add','modify','reduce'].includes(scope.kind) || Object.keys(scope).length !== 1
      || typeof op.importOwner !== 'string' || !op.importOwner || op.importOwner.length > 500
      || typeof op.windowMs !== 'number' || !Number.isSafeInteger(op.windowMs) || op.windowMs < 100 || op.windowMs > 900_000) return {ok:false,reason:'import scope, owner and window are required'}
    fields.importScope = {kind:scope.kind}; fields.importOwner = op.importOwner; fields.windowMs = op.windowMs
  }
  if (op.view !== undefined) {
    if (op.kind !== 'observe' || op.view !== 'bjrsj_import') return {ok:false,reason:'observe view is unknown'}
    fields.view = op.view
  }
  if (op.action === 'set_file') {
    const file = op.file
    if (!isRecord(file) || Object.keys(file).some(key=>!['fileGrantId','name','expectedIdentity','sha256','base64','bytes','kind'].includes(key))
      || typeof file.fileGrantId !== 'string' || !file.fileGrantId || file.fileGrantId.length > MAX_TOKEN
      || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)
      || typeof file.name !== 'string' || !file.name || file.name.length > 255 || /[\\/\x00-\x1f]/.test(file.name)
      || !isRecord(file.expectedIdentity) || typeof file.expectedIdentity.unitId !== 'string' || !/^[A-Z0-9-]{1,64}$/.test(file.expectedIdentity.unitId)
      || typeof file.expectedIdentity.legalIdentity !== 'string' || !/^[A-Z0-9]{18}$/.test(file.expectedIdentity.legalIdentity)
      || typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 10*1024*1024
      || typeof file.base64 !== 'string' || file.base64.length !== 4*Math.ceil(file.bytes/3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)
      || file.kind !==  (fields.importScope as Record<string, unknown>).kind) return {ok:false,reason:'file envelope is invalid or exceeds its own limit'}
    const padding = file.bytes % 3 === 1 ? '==' : file.bytes % 3 === 2 ? '=' : ''
    if ((file.base64.match(/=*$/)?.[0] ?? '') !== padding) return {ok:false,reason:'file encoding length mismatch'}
    fields.file = { ...file }
  }
  return {ok:true,fields}
}

/**
 * Validate the operation payload carried by one command.
 * @param {string} kind - operation kind.
 * @param {Record<string, unknown>} op - candidate operation.
 * @returns {{ ok: true, op: Record<string, unknown> } | { ok: false, reason: string }} verdict.
 */
function validateOp(kind: string, op: Record<string, unknown>) : {
    ok: true;
    op: Record<string, unknown>;
} | {
    ok: false;
    reason: string;
} {
  if (kind === 'observe') {
    const maxChars = readCount(op, 'maxChars')
    const maxNodes = readCount(op, 'maxNodes')
    if (maxChars === undefined || maxNodes === undefined) return { ok: false, reason: 'observe bounds are required' }
    return { ok: true, op: { kind, maxChars, maxNodes } }
  }
  if (kind === 'find') {
    const query = isRecord(op.query) ? op.query : undefined
    if (query === undefined) return { ok: false, reason: 'find.query is required' }
    const by = readString(query, 'by')
    if (by !== 'text' && by !== 'attr' && by !== 'role') return { ok: false, reason: 'find.query.by is unknown' }
    const text = readString(query, 'value', MAX_TEXT)
    if (text === undefined || text.length === 0) return { ok: false, reason: 'find.query.value is required' }
    const name = readOptionalString(query, 'name', MAX_TOKEN)
    if (by === 'attr' && name === undefined) return { ok: false, reason: 'find.query.name is required for attr' }
    const limit = readCount(op, 'limit')
    if (limit === undefined) return { ok: false, reason: 'find.limit is required' }
    return { ok: true, op: { kind, query: { by, value: text, ...(name === undefined ? {} : { name }) }, limit } }
  }
  if (kind === 'wait') {
    const condition = readString(op, 'condition')
    if (condition === undefined || !WAIT_CONDITIONS.includes(condition)) return { ok: false, reason: 'wait.condition is unknown' }
    const target = op.target
    const validatedTarget = validateTarget(target)
    if (!validatedTarget.ok) return { ok: false, reason: validatedTarget.reason }
    const text = readOptionalString(op, 'text', MAX_TEXT)
    if (condition === 'text' && (text === undefined || text.length === 0)) return { ok: false, reason: 'wait.text is required' }
    const timeoutMs = readCount(op, 'timeoutMs')
    if (timeoutMs === undefined) return { ok: false, reason: 'wait.timeoutMs is required' }
    return {
      ok: true,
      op: {
        kind, condition, target: validatedTarget.target, timeoutMs,
        ...(condition === 'text' ? { text } : {}),
      },
    }
  }
  if (kind === 'act') {
    const action = readString(op, 'action')
    if (action === undefined || !ACTIONS.includes(action)) return { ok: false, reason: 'act.action is unknown' }
    const target = validateTarget(op.target)
    if (!target.ok) return { ok: false, reason: target.reason }
    const value = readOptionalString(op, 'value', MAX_TEXT)
    if (action === 'type' && (value === undefined || value.length === 0)) return { ok: false, reason: 'act.value is required for type' }
    if (action === 'select' && (value === undefined || value.length === 0)) return { ok: false, reason: 'act.value is required for select' }
    if (action === 'check' && typeof op.checked !== 'boolean') return { ok: false, reason: 'act.checked is required for check' }
    if (action === 'click' && (value !== undefined || op.checked !== undefined)) {
      return { ok: false, reason: 'click takes no value or checked' }
    }

    const result: Record<string, unknown> = { kind, action, target: target.target }
    if (value !== undefined && action !== 'click') result.value = value
    if (action === 'check') result.checked = op.checked
    return { ok: true, op: result }
  }
  return { ok: false, reason: 'op.kind is unknown' }
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
function validateTarget(value: unknown) : {
    ok: true;
    target: Record<string, unknown>;
} | {
    ok: false;
    reason: string;
} {
  if (!isRecord(value)) return { ok: false, reason: 'target is required' }
  const documentToken = readString(value, 'documentToken', MAX_TOKEN)
  if (documentToken === undefined || documentToken.length === 0) return { ok: false, reason: 'target.documentToken is required' }
  const elementRef = readString(value, 'elementRef', MAX_TOKEN)
  if (elementRef === undefined || elementRef.length === 0) return { ok: false, reason: 'target.elementRef is required' }
  return { ok: true, target: { documentToken, elementRef } }
}

/**
 * Validate one Client → Host result envelope.
 * @param {unknown} value - candidate result.
 * @returns {{ ok: true, result: Record<string, unknown> } | { ok: false, reason: string }} verdict.
 */
export function validateResult(value: unknown) : {
    ok: true;
    result: ResultEnvelope;
} | {
    ok: false;
    reason: string;
} {
  if (!isRecord(value)) return { ok: false, reason: 'result must be an object' }
  if (readString(value, 'kind') !== 'result') return { ok: false, reason: 'kind must be "result"' }
  if (value.protocolVersion !== PROTOCOL_VERSION || !validRunScope(value.task)) return {ok:false,reason:'protocol v3 and complete task/run scope are required'}
  const id = readString(value, 'id', MAX_TOKEN)
  if (id === undefined || id.length === 0) return { ok: false, reason: 'id is required' }
  const leaseId = readString(value, 'leaseId', MAX_TOKEN)
  if (leaseId === undefined || leaseId.length === 0) return { ok: false, reason: 'leaseId is required' }
  const connectionGeneration = readCount(value, 'connectionGeneration')
  if (connectionGeneration === undefined) return { ok: false, reason: 'connectionGeneration is required' }
  const epoch = readCount(value, 'epoch')
  if (epoch === undefined) return { ok: false, reason: 'epoch is required' }
  const sequence = readCount(value, 'sequence')
  if (sequence === undefined) return { ok: false, reason: 'sequence is required' }
  const outcome = readString(value, 'outcome')
  if (outcome !== 'ok' && outcome !== 'failed' && outcome !== 'dropped' && outcome !== 'unknown_outcome') {
    return { ok: false, reason: 'outcome is unknown' }
  }
  if (outcome === 'failed') {
    const error = value.error
    if (!isRecord(error)) return { ok: false, reason: 'failed result requires error' }
    const code = readString(error, 'code', MAX_TOKEN)
    const message = readString(error, 'message', MAX_TEXT)
    if (code === undefined || !ERROR_CODES.includes(code)) return { ok: false, reason: 'failed result has unknown code' }
    if (message === undefined) return { ok: false, reason: 'failed result requires message' }
  }
  let diagnostic: ResultEnvelope['error']
  if (value.error !== undefined) {
    if (!isRecord(value.error)) return {ok:false,reason:'result error must be an object'}
    const message = readOptionalString(value.error, 'message', MAX_TEXT)
    if (value.error.message !== undefined && message === undefined) return {ok:false,reason:'result error message must be a bounded string'}
    diagnostic = {...value.error,...(message === undefined ? {} : {message})}
  }
  const payload = value.payload
  if (payload !== undefined && !isRecord(payload)) return { ok: false, reason: 'payload must be an object' }
  if (payload !== undefined && JSON.stringify(payload).length > MAX_PAYLOAD) {
    return { ok: false, reason: 'payload exceeds the accepted size' }
  }
  const instanceId = readString(value, 'instanceId', MAX_TOKEN)
  if (instanceId === undefined || instanceId.length === 0) return { ok: false, reason: 'instanceId is required' }
  return {
    ok: true,
    result: {
      kind: 'result', protocolVersion: PROTOCOL_VERSION, task: {...value.task}, id, leaseId, connectionGeneration, epoch, sequence, outcome,
      instanceId,
      ...(diagnostic === undefined ? {} : { error: diagnostic }),
      ...(payload === undefined ? {} : { payload }),
    },
  }
}

/**
 * Validate one Client → Host registration envelope (handshake).
 * @param {unknown} value - candidate hello.
 * @returns {{ ok: true, hello: Record<string, unknown> } | { ok: false, reason: string }} verdict.
 */
export function validateHello(value: unknown) : {
    ok: true;
    hello: PanelHello;
} | {
    ok: false;
    reason: string;
} {
  if (!isRecord(value)) return { ok: false, reason: 'hello must be an object' }
  if (readString(value, 'kind') !== 'hello') return { ok: false, reason: 'kind must be "hello"' }
  if (readCount(value, 'protocolVersion') !== PROTOCOL_VERSION) {
    return { ok: false, reason: `protocolVersion must be ${PROTOCOL_VERSION}` }
  }
  const connectionGeneration = readCount(value, 'connectionGeneration')
  if (connectionGeneration === undefined) return { ok: false, reason: 'connectionGeneration is required' }
  const sessionId = readString(value, 'sessionId', MAX_TOKEN)
  if (sessionId === undefined || sessionId.length === 0) return { ok: false, reason: 'sessionId is required' }
  const panel = value.panel
  if (!isRecord(panel)) return { ok: false, reason: 'panel is required' }
  const panelInstance = readString(panel, 'instanceId', MAX_TOKEN)
  if (panelInstance === undefined || panelInstance.length === 0) return { ok: false, reason: 'panel.instanceId is required' }
  const pages = panel.pages
  if (!Array.isArray(pages) || pages.length > 200) return { ok: false, reason: 'panel.pages must be a bounded array' }
  const parsedPages = []
  for (const page of pages) {
    if (!isRecord(page)) return { ok: false, reason: 'panel.pages entries must be objects' }
    const lease = readString(page, 'lease', MAX_TOKEN)
    const partition = readString(page, 'partition', MAX_TOKEN)
    const url = readString(page, 'url', MAX_TEXT)
    const title = readOptionalString(page, 'title', MAX_TEXT)
    const documentToken = readString(page, 'documentToken', MAX_TOKEN)
    const tabId = readOptionalString(page, 'tabId', MAX_TOKEN)
    const sessionIdOfPage = readOptionalString(page, 'sessionId', MAX_TOKEN)
    if (lease === undefined || partition === undefined || url === undefined || documentToken === undefined) {
      return { ok: false, reason: 'panel.pages entries need lease, partition, url and documentToken' }
    }
    parsedPages.push({
      lease, partition, url, documentToken,
      ...(title === undefined ? {} : { title }),
      ...(tabId === undefined ? {} : { tabId }),
      ...(sessionIdOfPage === undefined ? {} : { sessionId: sessionIdOfPage }),
    })
  }
  return {
    ok: true,
    hello: {
      kind: 'hello', protocolVersion: PROTOCOL_VERSION, connectionGeneration, sessionId,
      panel: { instanceId: panelInstance, pages: parsedPages },
    },
  }
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
export function commandEnvelope(input: { task: import("./task-scope.ts").RunScope; id: string; leaseId: string; connectionGeneration: number; epoch: number; sequence: number; deadlineAt: number; op: object; }) : Record<string, unknown> {
  return {
    kind: 'command',
    protocolVersion: PROTOCOL_VERSION,
    task: {...input.task},
    id: input.id,
    leaseId: input.leaseId,
    connectionGeneration: input.connectionGeneration,
    epoch: input.epoch,
    sequence: input.sequence,
    deadlineAt: input.deadlineAt,
    op: input.op,
  }
}

/**
 * Serialize a payload to lossless JSON with a size bound.
 * @param {unknown} value - payload.
 * @returns {{ ok: true, text: string } | { ok: false, reason: string }} encoded text or refusal.
 */
export function encodePayload(value: unknown) : {
    ok: true;
    text: string;
} | {
    ok: false;
    reason: string;
} {
  let text
  try {
    text = JSON.stringify(value)
  } catch (cause) {
    return { ok: false, reason: `payload is not JSON-serializable: ${String(cause)}` }
  }
  if (typeof text !== 'string') return { ok: false, reason: 'payload has no JSON representation' }
  if (text.length > MAX_PAYLOAD) return { ok: false, reason: 'payload exceeds the accepted size' }
  return { ok: true, text }
}
