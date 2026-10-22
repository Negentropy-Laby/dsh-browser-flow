export type PageOperation = {
    kind: "observe" | "find" | "act" | "wait";
    maxChars?: number | undefined;
    maxNodes?: number | undefined;
    query?: object | undefined;
    limit?: number | undefined;
    target?: {
        documentToken: string;
        elementRef: string;
    } | undefined;
    action?: string | undefined;
    value?: string | undefined;
    checked?: boolean | undefined;
    condition?: string | undefined;
    timeoutMs?: number | undefined;
    text?: string | undefined;
    view?: string | undefined;
    pagePolicy?: object | undefined;
    importScope?: object | undefined;
    importOwner?: string | undefined;
    windowMs?: number | undefined;
    file?: {base64:string;sha256:string} | undefined;
};
export type PagePrograms = {
    identity: string;
    observe: (maxChars: number, maxNodes: number) => string;
    find: (query: object, limit: number) => string;
    act: (input: object) => string;
    wait: (input: object) => string;
    import?: ((input: object) => string) | undefined;
};

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

import { sameRunScope, validRunScope } from './task-scope.ts'

/** Marker the shipped Browser UI puts on a live Electron guest element. */
export const WEBVIEW_SELECTOR = 'webview[data-sidebar-browser-frame="webview"]'





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
export function programFor(pageCode: PagePrograms, op: PageOperation) : string {
  if (op.view === 'bjrsj_import' || (op.kind === 'act' && op.action === 'set_file')) {
    if (!pageCode.import) throw new Error('the scoped import program is unavailable')
    return pageCode.import({mode:op.action === 'set_file' ? 'set_file' : 'observe',owner:op.importOwner,scope:op.importScope,windowMs:op.windowMs,target:op.target,file:op.file})
  }
  if (op.kind === 'observe') return pageCode.observe(((op.maxChars) as number), ((op.maxNodes) as number))
  if (op.kind === 'find') return pageCode.find(((op.query) as object), ((op.limit) as number))
  if (op.kind === 'act') {
    const target = ((op.target) as {
    documentToken: string;
    elementRef: string;
})
    return pageCode.act({
      documentToken: target.documentToken,
      elementRef: target.elementRef,
      action: op.action,
      ...(op.pagePolicy === undefined ? {} : {pagePolicy:op.pagePolicy}),
      ...(op.importScope === undefined ? {} : {importScope:op.importScope}),
      ...(op.value === undefined ? {} : { value: op.value }),
      ...(op.checked === undefined ? {} : { checked: op.checked }),
    })
  }
  if (op.kind === 'wait') {
    return pageCode.wait({
      condition: op.condition,
      target: op.target,
      timeoutMs: op.timeoutMs,
      ...(op.text === undefined ? {} : { text: op.text }),
    })
  }
  throw new Error(`unsupported operation ${String(op.kind)}`)
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
export function identityOf(element: {getAttribute(name:string):string|null;closest(selector:string):{getAttribute(name:string):string|null}|null}) : {
    lease: string;
    partition: string;
    sessionId: string;
    tabId: string;
} {
  const sessionHost = element.closest('[data-sidebar-right-session]')
  const tabHost = element.closest('[data-sidebar-right-tab]') || element.closest('[data-dockkit-content]')
  return {
    lease: element.getAttribute('name') || '',
    partition: element.getAttribute('partition') || '',
    sessionId: sessionHost === null ? '' : (sessionHost.getAttribute('data-sidebar-right-session') || ''),
    tabId: tabHost === null ? '' : (tabHost.getAttribute('data-sidebar-right-tab') || tabHost.getAttribute('data-dockkit-content') || ''),
  }
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
export function classifyResult(result: unknown) : {
    outcome: 'ok';
    payload: unknown;
} | {
    outcome: 'failed' | 'unknown_outcome';
    error: {
        code: string;
        message: string;
    };
} {
  if (result === undefined || result === null) {
    return { outcome: 'unknown_outcome', error: { code: 'unknown_outcome', message: 'the page returned no result' } }
  }
  const record = typeof result === 'object' && result !== null ? ((result) as Record<string, unknown>) : undefined
  if (record === undefined || record.ok !== true) {
    const raw = record?.error
    const detail = typeof raw === 'object' && raw !== null ? ((raw) as Record<string, unknown>) : {}
    return {
      outcome: 'failed',
      error: {
        code: typeof detail.code === 'string' ? detail.code : 'internal',
        message: typeof detail.message === 'string' ? detail.message : 'the page reported a failure',
      },
    }
  }
  return { outcome: 'ok', payload: record.value }
}

/**
 * Classify a thrown execution.
 * @param {unknown} failure - thrown value.
 * @returns {{ outcome: 'unknown_outcome', error: { code: string, message: string } }} outcome.
 */
export function classifyThrow(failure: unknown) : {
    outcome: 'unknown_outcome';
    error: {
        code: string;
        message: string;
    };
} {
  return {
    outcome: 'unknown_outcome',
    error: { code: 'unknown_outcome', message: String(((failure) as {
    message?: unknown;
})?.message ?? failure) },
  }
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
export function indistinguishableFrom<T extends {lease?:string;url?:string;title?:string;tabId?:string}>(pages: readonly T[], chosen: {lease?:string;url?:string;title?:string;tabId?:string}) : T[] {
  return pages.filter(page => {
    if (page.lease === chosen.lease) return false
    return (page.url ?? '') === (chosen.url ?? '')
      && (page.title ?? '') === (chosen.title ?? '')
      && (page.tabId ?? '') === (chosen.tabId ?? '')
  })
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
export function refuseCommand(envelope: {task?:unknown;op?:{pagePolicy?:object};leaseId?:unknown;connectionGeneration?:unknown;epoch?:unknown;sequence?:unknown}, held: {task?:unknown;pagePolicy?:object;controlLeaseId?:unknown;epoch?:unknown;expectedSequence?:unknown} | undefined, generation: number) : {
    outcome: string;
    error: {
        code: string;
        message: string;
    };
} | undefined {
  if (held === undefined) {
    return { outcome: 'failed', error: { code: 'not_authorized', message: 'no page is authorized in this panel' } }
  }
  if (!validRunScope(envelope.task) || !validRunScope(held.task) || !sameRunScope(envelope.task,held.task)) return {outcome:'failed',error:{code:'task_scope_mismatch',message:'command task/run differs from the user-bound task'}}
  if(held.pagePolicy && (!samePolicy(envelope.op?.pagePolicy,held.pagePolicy)))return {outcome:'failed',error:{code:'task_scope_mismatch',message:'command omitted or changed the task site policy'}}
  if (envelope.leaseId !== held.controlLeaseId) {
    return { outcome: 'failed', error: { code: 'not_authorized', message: 'the command is for another authorization' } }
  }
  if (envelope.connectionGeneration !== generation) {
    return { outcome: 'failed', error: { code: 'connection_stale', message: 'the command is for an earlier panel connection' } }
  }
  if (envelope.epoch !== held.epoch) {
    return { outcome: 'failed', error: { code: 'stale_observation', message: 'the page changed since it was observed; observe it again' } }
  }
  if (envelope.sequence !== held.expectedSequence) {
    return { outcome: 'failed', error: { code: 'stale_observation', message: 'the command is out of sequence' } }
  }
  return undefined
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
export function capToBudget(operation: PageOperation, remainingMs: number, marginMs: number = 250): PageOperation {
  if (operation.kind !== 'wait') return operation
  const allowance = Math.max(0, Math.floor(remainingMs - marginMs))
  const requested = typeof operation.timeoutMs === 'number' ? operation.timeoutMs : allowance
  return { ...operation, timeoutMs: Math.max(0, Math.min(requested, allowance)) }
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
export function navigationEvent(before: string | undefined, after: string | undefined) : 'same_origin_navigation' | 'cross_origin_navigation' {
  try {
    if (before !== undefined && after !== undefined && new URL(before).origin === new URL(after).origin) {
      return 'same_origin_navigation'
    }
  } catch {
    // An unparseable address cannot be shown to share an origin.
  }
  return 'cross_origin_navigation'
}
/**
 * Whether the panel may run page programs on this host.
 *
 * The Web carrier renders the Browser as a cross-origin sandboxed iframe, so
 * only the Desktop carrier with its product bridge can execute page programs.
 * @param {object} [carrier] - `globalThis.dshDesktop`, when present.
 * @returns {boolean} true when the Desktop bridge is available.
 */
export function hostSupportsPageControl(carrier?: object) : boolean {
  return ((carrier ?? {}) as {
    protocolVersion?: number;
})?.protocolVersion === 1
}

function samePolicy(left:object|undefined,right:object):boolean {
  const l=left as Record<string,unknown>;const r=right as Record<string,unknown>
  return l?.adapter===r.adapter&&l?.workflow===r.workflow
}
