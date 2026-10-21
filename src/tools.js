/**
 * The six model-facing tools.
 *
 * Each tool is a thin, total adapter: it validates the model's arguments at the
 * JSON boundary, resolves the caller's live Agent and its control lease through
 * the service, and reports a structured failure the model can act on. No tool
 * accepts free-form script, credentials, or a page it was not authorized for.
 *
 * Tool privacy rules:
 *
 * - Nothing reads cookies, storage, or password values; the page programs
 *   refuse password fields outright.
 * - URLs and errors are redacted before they reach a model message.
 * - The tool descriptions state that the model's own arguments may already be
 *   in the Harness message log, so a refusal cannot retract them.
 *
 * @module @negentropy/dsh-browser-flow/tools
 */

import { validUserWait, USER_WAIT_KINDS } from './task-wait.js'
import { failure, success } from './protocol.js'

/**
 * One tool call's execution context, as the Host supplies it.
 * @typedef {object} ToolExec
 * @property {object} [agent] - the live Agent making the call.
 * @property {AbortSignal} signal - caller cancellation.
 */

/**
 * The Host service the tools call into.
 *
 * Declared structurally so this module stays independent of the service class.
 * @typedef {object} ToolService
 * @property {(caller: object, result: any) => any} [annotate] - bind canonical results to this task only.
 * @property {(exec: ToolExec) => { ok: true, value: object } | { ok: false, error: { code: string, message: string, details?: object } }} resolveCaller - resolve the calling Agent.
 * @property {(caller: object) => { ok: boolean, value?: object, error?: object }} listTabs - pages this Session may authorize.
 * @property {(caller: object, signal: AbortSignal, view?: string, detail?: {ref:string,offset:number}) => Promise<object>} observe - read the authorized page or import judgment.
 * @property {(caller: object, query: object, signal: AbortSignal) => Promise<object>} find - locate elements.
 * @property {(caller: object, action: object, signal: AbortSignal) => Promise<object>} act - run one action.
 * @property {(caller: object, input: object, signal: AbortSignal) => Promise<object>} wait - wait for a condition.
 * @property {(caller: object) => Promise<object>} release - detach control.
 */

/**
 * The Host service the tools call into.
 *
 * Declared structurally so this module stays independent of the service class.
 * @typedef {object} ToolServiceOld
 * @property {(exec: object) => { ok: true, value: object } | { ok: false, error: object }} resolveCaller - resolve the calling Agent.
 * @property {(caller: object) => object} listTabs - pages this Session may authorize.
 * @property {(caller: object, signal: AbortSignal) => Promise<object>} observe - read the authorized page.
 * @property {(caller: object, query: object, signal: AbortSignal) => Promise<object>} find - locate elements.
 * @property {(caller: object, action: object, signal: AbortSignal) => Promise<object>} act - run one action.
 * @property {(caller: object, input: object, signal: AbortSignal) => Promise<object>} wait - wait for a condition.
 * @property {(caller: object) => Promise<object>} release - detach control.
 */
/** Text block helper. @param {string} value - text. @returns {{ type: string, text: string }[]} content blocks. */
const text = value => [{ type: 'text', text: value }]

/** JSON output schema shared by every tool: the canonical value is an object. */
const OBJECT_SCHEMA = { type: 'object', additionalProperties: true }

/** Common privacy sentence carried by every tool description. */
const LOG_NOTICE = 'Tool arguments the model already sent may already be in the Harness message log; refusing to execute cannot retract them.'

/**
 * Build every tool definition bound to one service instance.
 * @param {ToolService} service - the browser-flow Host service.
 * @param {import('./config.js').BrowserFlowConfig} config - resolved config.
 * @returns {object[]} tool definitions.
 */
export function createTools(service, config) {
  const definitions = [
    tabsTool(service),
    observeTool(service, config),
    findTool(service, config),
    actTool(service),
    waitTool(service, config),
    releaseTool(service),
  ]
  return definitions.map(definition=>{
    const execute=/** @type {{execute:(args:Record<string,unknown>,exec:ToolExec)=>Promise<object>|object}} */(definition).execute
    return {...definition,async execute(/** @type {Record<string,unknown>} */ args,/** @type {ToolExec} */ exec){
      const result=await execute(args,exec)
      if(!service.annotate)return result
      const caller=service.resolveCaller(exec)
      return caller.ok && service.annotate ? service.annotate(caller.value,result) : result
    }}
  })
}

/**
 * Shared output declaration: the canonical value is an object, rendered as JSON.
 * @param {string} name - tool name for the presentation metadata.
 * @returns {object} output definition.
 */
function outputOf(name) {
  return {
    schema: OBJECT_SCHEMA,
    render: (/** @type {object} */ _args, /** @type {unknown} */ value) => text(JSON.stringify(value, undefined, 2)),
    presentationMeta: (/** @type {object} */ _args, /** @type {unknown} */ value) => ({ tool: name }),
  }
}

/** @param {ToolService} service - Host service. @returns {object} `browser_tabs`. */
function tabsTool(service) {
  return {
    name: 'browser_tabs',
    description: 'List the pages of the current Session\'s Browser panel that this Agent may be authorized for. '
      + 'Returns plugin tab ids, redacted addresses, titles and whether control is authorized. '
      + 'It never returns another Session\'s pages or page content. '
      + 'Authorization is a separate, explicit user action in the plugin panel; this tool cannot grant it. '
      + LOG_NOTICE,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: outputOf('browser_tabs'),
    async execute(/** @type {Record<string, unknown>} */ _args, /** @type {ToolExec} */ exec) {
      const resolved = service.resolveCaller(exec)
      if (!resolved.ok) return resolved
      const listed = service.listTabs(resolved.value)
      if (!listed.ok) return listed
      return success(listed.value)
    },
  }
}

/** @param {ToolService} service - Host service. @param {import('./config.js').BrowserFlowConfig} config - config. @returns {object} `browser_observe`. */
function observeTool(service, config) {
  return {
    name: 'browser_observe',
    description: 'Read a bounded text view of the authorized page: redacted address, title, visible text, and a list of '
      + 'operable elements with element references. The result carries a documentToken; element references from an '
      + 'earlier observation are rejected as stale. Normal page operations require a bound task and an authorized page. view=task reads this Session’s task snapshot and instructions without page authorization; it never grants control. '
      + `Character and node budgets are ${String(config.observeMaxChars)} and ${String(config.observeMaxNodes)}. `
      + 'Password fields and storage values are never returned. view=bjrsj_import reads the private verifier\'s safe '
      + 'identity and import judgment after the user prepared a scoped file in the panel; it is not a general network reader. '
      + LOG_NOTICE,
    parameters: { type: 'object', properties: { view: { type: 'string', enum: ['page','bjrsj_import','task'], description: 'Default page, scoped Beijing import verifier, or the current task.' }, ref:{type:'string',description:'Task-local resource or asset reference from view=task.'},offset:{type:'integer',minimum:0,description:'Task detail continuation character offset.'} }, required: [], additionalProperties: false },
    output: outputOf('browser_observe'),
    async execute(/** @type {Record<string, unknown>} */ args, /** @type {ToolExec} */ exec) {
      if (args.view !== undefined && args.view !== 'page' && args.view !== 'bjrsj_import' && args.view !== 'task') return failure('invalid_request', 'view must be page, bjrsj_import or task')
      if((args.ref!==undefined&&(args.view!=='task'||typeof args.ref!=='string'||!args.ref||args.ref.length>240)) || (args.offset!==undefined&&(args.ref===undefined||typeof args.offset!=='number'||!Number.isSafeInteger(args.offset)||args.offset<0||args.offset>2_000_000)))return failure('invalid_request','task detail requires a bounded reference and nonnegative offset')
      const resolved = service.resolveCaller(exec)
      if (!resolved.ok) return resolved
      const observed = await service.observe(resolved.value, exec.signal, /** @type {string | undefined} */ (args.view),args.ref===undefined ? undefined : {ref:/** @type {string} */(args.ref),offset:/** @type {number} */(args.offset ?? 0)})
      return observed
    },
  }
}

/** @param {ToolService} service - Host service. @param {import('./config.js').BrowserFlowConfig} config - config. @returns {object} `browser_find`. */
function findTool(service, config) {
  return {
    name: 'browser_find',
    description: 'Locate elements on the authorized page by visible text, by an explicit DOM attribute value, or by ARIA role. '
      + 'Text queries return the deepest visible matches without counting their ancestors. '
      + 'Returns up to the configured limit of distinct matches with element references. '
      + 'When more than one element matches, the result reports ambiguous_match: pass a more specific query rather than '
      + 'guessing. Matches belong to the current documentToken and go stale after navigation or a new observation. '
      + LOG_NOTICE,
    parameters: {
      type: 'object',
      properties: {
        by: { type: 'string', enum: ['text', 'attr', 'role'], description: 'Match kind.' },
        value: { type: 'string', description: 'Text to find, attribute value, or ARIA role/tag name.' },
        name: { type: 'string', description: 'Attribute name, required when by is attr (for example data-cell-id).' },
      },
      required: ['by', 'value'],
      additionalProperties: false,
    },
    output: outputOf('browser_find'),
    async execute(/** @type {Record<string, unknown>} */ args, /** @type {ToolExec} */ exec) {
      const by = args.by
      const value = args.value
      const name = args.name
      if (typeof by !== 'string' || !['text', 'attr', 'role'].includes(by)) {
        return failure('invalid_request', 'by must be text, attr or role')
      }
      if (typeof value !== 'string' || value.length === 0) return failure('invalid_request', 'value is required')
      if (by === 'attr' && (typeof name !== 'string' || name.length === 0)) {
        return failure('invalid_request', 'name is required when by is attr')
      }
      if (name !== undefined && typeof name !== 'string') return failure('invalid_request', 'name must be a string')
      const resolved = service.resolveCaller(exec)
      if (!resolved.ok) return resolved
      return service.find(resolved.value, { by, value, ...(name === undefined ? {} : { name }) }, exec.signal)
    },
  }
}

/** @param {ToolService} service - Host service. @returns {object} `browser_act`. */
function actTool(service) {
  return {
    name: 'browser_act',
    description: 'Operate one element of the authorized page. Actions: click; type (replaces the whole value of an input, '
      + 'textarea or contenteditable, never appends); select (sets an explicit option); check (sets an explicit checked '
      + 'state); set_file (one confirmed Beijing file grant, targeting its visible upload control). set_file accepts only '
      + 'fileGrantId, never a path or bytes; selection can immediately send the site\'s validation request and never means '
      + 'import_confirmed. Every page action re-validates the documentToken, the element reference, visibility and operability first, and '
      + 'fails with stale_observation rather than choosing another element. Actions are never retried automatically: '
      + 'page events and saves can have side effects, so confirm the result with browser_observe. Password fields are refused. '
      + 'await_user records a bounded human dependency in the current task without page authorization or dispatch. It takes only action and wait; the user must supply the condition and resume in the panel. It cannot grant control or prove success. '
      + LOG_NOTICE,
    parameters: {
      type: 'object',
      properties: {
        documentToken: { type: 'string', description: 'documentToken from the observation that produced elementRef.' },
        elementRef: { type: 'string', description: 'Element reference from browser_observe or browser_find.' },
        action: { type: 'string', enum: ['click', 'type', 'select', 'check','set_file','await_user'], description: 'Page action, or await_user to record a task-local human dependency without entering a page. Only the user can resume.' },
        fileGrantId: { type: 'string', description: 'One confirmed file grant from browser_tabs, required only for set_file.' },
        value: { type: 'string', description: 'Replacement text for type, or option value/text for select.' },
        checked: { type: 'boolean', description: 'Explicit checked state for check.' },
        wait: {type:'object',properties:{kind:{type:'string',enum:[...USER_WAIT_KINDS]},reason:{type:'string',minLength:1,maxLength:1000},resumeCondition:{type:'string',minLength:1,maxLength:1000}},required:['kind','reason','resumeCondition'],additionalProperties:false},
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: outputOf('browser_act'),
    async execute(/** @type {Record<string, unknown>} */ args, /** @type {ToolExec} */ exec) {
      if(args.action==='await_user'){
        if(Object.keys(args).some(key=>!['action','wait'].includes(key))||!validUserWait(args.wait))return failure('invalid_request','await_user takes only a user dependency, reason and resumeCondition')
        const caller=service.resolveCaller(exec)
        return caller.ok?service.act(caller.value,{action:'await_user',wait:args.wait},exec.signal):caller
      }
      if(args.wait!==undefined)return failure('invalid_request','wait is only valid for await_user')
      const documentToken = args.documentToken
      const elementRef = args.elementRef
      const action = args.action
      if (typeof documentToken !== 'string' || documentToken.length === 0) return failure('invalid_request', 'documentToken is required')
      if (typeof elementRef !== 'string' || elementRef.length === 0) return failure('invalid_request', 'elementRef is required')
      if (typeof action !== 'string' || !['click', 'type', 'select', 'check','set_file'].includes(action)) {
        return failure('invalid_request', 'action must be click, type, select, check or set_file')
      }
      if (action === 'type' && (typeof args.value !== 'string' || args.value.length === 0)) {
        return failure('invalid_request', 'value is required for type')
      }
      if (action === 'select' && (typeof args.value !== 'string' || args.value.length === 0)) {
        return failure('invalid_request', 'value is required for select')
      }
      if (action === 'check' && typeof args.checked !== 'boolean') return failure('invalid_request', 'checked is required for check')
      if (action === 'click' && (args.value !== undefined || args.checked !== undefined)) {
        return failure('invalid_request', 'click takes no value or checked')
      }
      if (action === 'set_file' && (typeof args.fileGrantId !== 'string' || !args.fileGrantId || args.fileGrantId.length > 200
        || Object.keys(args).some(key=>!['documentToken','elementRef','action','fileGrantId'].includes(key)))) return failure('invalid_request', 'set_file requires only a current target and fileGrantId')
      if (action !== 'set_file' && args.fileGrantId !== undefined) return failure('invalid_request', 'fileGrantId is only valid for set_file')
      const resolved = service.resolveCaller(exec)
      if (!resolved.ok) return resolved
      return service.act(resolved.value, {
        documentToken, elementRef, action,
        ...(action === 'set_file' ? { fileGrantId: args.fileGrantId } : {}),
        ...(args.value === undefined ? {} : { value: args.value }),
        ...(args.checked === undefined ? {} : { checked: args.checked }),
      }, exec.signal)
    },
  }
}

/** @param {ToolService} service - Host service. @param {import('./config.js').BrowserFlowConfig} config - config. @returns {object} `browser_wait`. */
function waitTool(service, config) {
  return {
    name: 'browser_wait',
    description: 'Wait for one listed DOM condition on the authorized page: present (element visible), absent (element gone '
      + 'or hidden), or text (element text contains a string). The wait is bounded and cancellable; it is not a general '
      + 'flow engine and it never dispatches page actions. A stale document or reference fails immediately. '
      + `The longest accepted wait is ${String(config.waitMaxMs)} ms. `
      + LOG_NOTICE,
    parameters: {
      type: 'object',
      properties: {
        documentToken: { type: 'string', description: 'documentToken the element reference belongs to.' },
        elementRef: { type: 'string', description: 'Element reference to watch.' },
        condition: { type: 'string', enum: ['present', 'absent', 'text'], description: 'Condition to wait for.' },
        text: { type: 'string', description: 'Substring required when condition is text.' },
        timeoutMs: { type: 'integer', description: 'Wait bound in milliseconds.' },
      },
      required: ['documentToken', 'elementRef', 'condition', 'timeoutMs'],
      additionalProperties: false,
    },
    output: outputOf('browser_wait'),
    async execute(/** @type {Record<string, unknown>} */ args, /** @type {ToolExec} */ exec) {
      const documentToken = args.documentToken
      const elementRef = args.elementRef
      const condition = args.condition
      const timeoutMs = args.timeoutMs
      if (typeof documentToken !== 'string' || documentToken.length === 0) return failure('invalid_request', 'documentToken is required')
      if (typeof elementRef !== 'string' || elementRef.length === 0) return failure('invalid_request', 'elementRef is required')
      if (typeof condition !== 'string' || !['present', 'absent', 'text'].includes(condition)) {
        return failure('invalid_request', 'condition must be present, absent or text')
      }
      if (condition === 'text' && (typeof args.text !== 'string' || args.text.length === 0)) {
        return failure('invalid_request', 'text is required when condition is text')
      }
      if (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > config.waitMaxMs) {
        return failure('invalid_request', `timeoutMs must be an integer from 1 through ${String(config.waitMaxMs)}`)
      }
      const resolved = service.resolveCaller(exec)
      if (!resolved.ok) return resolved
      return service.wait(resolved.value, {
        documentToken, elementRef, condition, timeoutMs,
        ...(args.text === undefined ? {} : { text: args.text }),
      }, exec.signal)
    },
  }
}

/** @param {ToolService} service - Host service. @returns {object} `browser_release`. */
function releaseTool(service) {
  return {
    name: 'browser_release',
    description: 'Detach this Agent\'s control from the authorized page and end the authorization. The page stays open, '
      + 'stays logged in, and the user keeps using it; nothing is closed, reloaded or cleared. Any queued operation is '
      + 'dropped and an operation already sent whose result has not arrived is reported as unknown_outcome, never resent. '
      + 'Use this when the task is finished. '
      + LOG_NOTICE,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: outputOf('browser_release'),
    async execute(/** @type {Record<string, unknown>} */ _args, /** @type {ToolExec} */ exec) {
      const resolved = service.resolveCaller(exec)
      if (!resolved.ok) return resolved
      return service.release(resolved.value)
    },
  }
}
