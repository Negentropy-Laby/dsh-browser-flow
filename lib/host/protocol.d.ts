export type ErrorCode = (typeof ERROR_CODES)[number];
/** A page identity validated during the panel handshake. */
export interface PanelPage {
    lease: string;
    partition: string;
    url: string;
    documentToken: string;
    title?: string;
    tabId?: string;
    sessionId?: string;
}
/** Canonical panel registration; task authorization is a separate operation. */
export interface PanelHello {
    kind: 'hello';
    protocolVersion: 3;
    connectionGeneration: number;
    sessionId: string;
    panel: {
        instanceId: string;
        pages: PanelPage[];
    };
}
/** Canonical command identity, before an operation-specific consumer narrows its payload. */
export interface CommandEnvelope {
    kind: 'command';
    protocolVersion: 3;
    task: import('./task-scope.ts').RunScope;
    id: string;
    leaseId: string;
    connectionGeneration: number;
    epoch: number;
    sequence: number;
    deadlineAt: number;
    op: Record<string, unknown>;
}
/** Protocol revision. A mismatch fails the handshake loudly instead of guessing. */
export declare const PROTOCOL_VERSION = 3;
/** Base path of this plugin's Host routes on the existing `/api` connection. */
export declare const ROUTE_PREFIX = "/api/browser-flow";
/** Errors this plugin reports to the model and the panel. */
export declare const ERROR_CODES: readonly string[];
/** @typedef {typeof ERROR_CODES[number]} ErrorCode */
/** Error codes that mean "the action did not run and can be retried after re-observing". */
export declare const RETRYABLE_CODES: readonly string[];
/**
 * Whether a failure code may be retried after a fresh observation.
 * `unknown_outcome` is deliberately excluded: a write whose outcome is unknown
 * must never be re-sent automatically.
 * @param {string} code - failure code.
 * @returns {boolean} true when a retry after re-observing is meaningful.
 */
export declare function isRetryable(code: string): boolean;
/**
 * Build a structured failure payload.
 * @param {ErrorCode} code - stable failure category.
 * @param {string} message - human-actionable explanation without page secrets.
 * @param {Record<string, unknown>} [details] - extra structured facts.
 * @returns {{ ok: false, error: { code: string, message: string, details?: Record<string, unknown> } }} failure.
 */
export declare function failure(code: ErrorCode, message: string, details?: Record<string, unknown>): {
    ok: false;
    error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
};
/**
 * Build a structured success payload.
 * @param {unknown} value - canonical result.
 * @returns {{ ok: true, value: unknown }} success.
 */
export declare function success<T>(value: T): {
    ok: true;
    value: T;
};
/**
 * Whether a value is a plain JSON object.
 *
 * Declared as a type predicate so the validators below narrow their inputs: each
 * one starts from `unknown` and then reads named fields off the record.
 * @param {unknown} value - candidate.
 * @returns {value is Record<string, unknown>} whether it is a plain object.
 */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/**
 * Read a required string field with a length bound.
 * @param {Record<string, unknown>} row - source object.
 * @param {string} key - field name.
 * @param {number} [max] - maximum accepted length.
 * @returns {string | undefined} the value, or undefined when absent/invalid.
 */
export declare function readString(row: Record<string, unknown>, key: string, max?: number): string | undefined;
/**
 * Read an optional string field with a length bound.
 * @param {Record<string, unknown>} row - source object.
 * @param {string} key - field name.
 * @param {number} [max] - maximum accepted length.
 * @returns {string | undefined} the value when it is a bounded string.
 */
export declare function readOptionalString(row: Record<string, unknown>, key: string, max?: number): string | undefined;
/**
 * Read a required non-negative safe integer field.
 * @param {Record<string, unknown>} row - source object.
 * @param {string} key - field name.
 * @returns {number | undefined} the value, or undefined when absent/invalid.
 */
export declare function readCount(row: Record<string, unknown>, key: string): number | undefined;
/**
 * Read a boolean field.
 * @param {Record<string, unknown>} row - source object.
 * @param {string} key - field name.
 * @returns {boolean | undefined} the value, or undefined when absent/not boolean.
 */
export declare function readBoolean(row: Record<string, unknown>, key: string): boolean | undefined;
/** Kinds of page operations the plugin can dispatch. */
export declare const OP_KINDS: readonly string[];
/** Action kinds inside an `act` operation. */
export declare const ACTIONS: readonly string[];
/** Wait condition kinds. */
export declare const WAIT_CONDITIONS: readonly string[];
/**
 * Validate one Host → Client command envelope.
 *
 * The envelope is the only thing the Client executes, so every field is
 * checked here and nothing is coerced.
 * @param {unknown} value - candidate command.
 * @returns {{ ok: true, command: Record<string, unknown> } | { ok: false, reason: string }} verdict.
 */
export declare function validateCommand(value: unknown): {
    ok: true;
    command: CommandEnvelope;
} | {
    ok: false;
    reason: string;
};
/**
 * Validate one Client → Host result envelope.
 * @param {unknown} value - candidate result.
 * @returns {{ ok: true, result: Record<string, unknown> } | { ok: false, reason: string }} verdict.
 */
export declare function validateResult(value: unknown): {
    ok: true;
    result: Record<string, unknown>;
} | {
    ok: false;
    reason: string;
};
/**
 * Validate one Client → Host registration envelope (handshake).
 * @param {unknown} value - candidate hello.
 * @returns {{ ok: true, hello: Record<string, unknown> } | { ok: false, reason: string }} verdict.
 */
export declare function validateHello(value: unknown): {
    ok: true;
    hello: PanelHello;
} | {
    ok: false;
    reason: string;
};
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
export declare function commandEnvelope(input: {
    task: import("./task-scope.ts").RunScope;
    id: string;
    leaseId: string;
    connectionGeneration: number;
    epoch: number;
    sequence: number;
    deadlineAt: number;
    op: object;
}): Record<string, unknown>;
/**
 * Serialize a payload to lossless JSON with a size bound.
 * @param {unknown} value - payload.
 * @returns {{ ok: true, text: string } | { ok: false, reason: string }} encoded text or refusal.
 */
export declare function encodePayload(value: unknown): {
    ok: true;
    text: string;
} | {
    ok: false;
    reason: string;
};
