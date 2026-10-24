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
import { validateExplorationCommand, ExplorationError } from "./task-exploration.js";
import { validUserWait, USER_WAIT_KINDS } from "./task-wait.js";
import { failure, success } from "./protocol.js";
/** Text block helper. @param {string} value - text. @returns {{ type: string, text: string }[]} content blocks. */
const text = (value) => [{ type: 'text', text: value }];
/** JSON output schema shared by every tool: the canonical value is an object. */
const OBJECT_SCHEMA = { type: 'object', additionalProperties: true };
/** Common privacy sentence carried by every tool description. */
const LOG_NOTICE = 'Tool arguments the model already sent may already be in the Harness message log; refusing to execute cannot retract them.';
/**
 * Build every tool definition bound to one service instance.
 * @param {ToolService} service - the browser-flow Host service.
 * @param {import('./config.ts').BrowserFlowConfig} config - resolved config.
 * @returns {object[]} tool definitions.
 */
export function createTools(service, config) {
    const definitions = [
        tabsTool(service),
        observeTool(service, config),
        findTool(service),
        actTool(service),
        waitTool(service, config),
        releaseTool(service),
    ];
    return definitions.map(definition => {
        const execute = definition.execute;
        return { ...definition, async execute(args, exec) {
                const result = await execute(args, exec);
                if (!service.annotate)
                    return result;
                const caller = service.resolveCaller(exec);
                return caller.ok && service.annotate ? service.annotate(caller.value, result) : result;
            } };
    });
}
/**
 * Shared output declaration: the canonical value is an object, rendered as JSON.
 * @param {string} name - tool name for the presentation metadata.
 * @returns {object} output definition.
 */
function outputOf(name) {
    return {
        schema: OBJECT_SCHEMA,
        render: (_args, value) => text(JSON.stringify(value, undefined, 2)),
        presentationMeta: (_args, value) => ({ tool: name }),
    };
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
        async execute(_args, exec) {
            const resolved = service.resolveCaller(exec);
            if (!resolved.ok)
                return resolved;
            const listed = service.listTabs(resolved.value);
            if (!listed.ok)
                return listed;
            return success(listed.value);
        },
    };
}
/** @param {ToolService} service - Host service. @param {import('./config.ts').BrowserFlowConfig} config - config. @returns {object} `browser_observe`. */
function observeTool(service, config) {
    return {
        name: 'browser_observe',
        description: 'Read an authorized page, region or structured table with current document element references. No passwords or storage are read. '
            + 'Start with view=task and no query/ref to read the current task, workflow guide and knowledge overview without granting page control. For subsequent task queries set view=task explicitly: query supports graph_overview, list_goals, list_facts, node_detail, list_assets and asset_neighbors; assets and exploration nodes have distinct IDs. '
            + 'With view=task, ref reads bounded details including exploration:guide, graph:assets, graph:exploration, coverage and definition:<path>. Do not combine query with ref. Nonzero continuation requires projectionId. '
            + 'view=file with a file asset ref reads the user-selected original as neutral sheets/cells or supported text; no business field mapping is built in. '
            + 'view=table/region optionally scopes to documentToken and elementRef. Truncation and DOM completeness never establish dataset completeness. '
            + 'The legacy scoped verifier view remains available for old definition tasks. ' + LOG_NOTICE,
        parameters: { type: 'object', properties: {
                view: { type: 'string', enum: ['page', 'table', 'region', 'task', 'file', 'bjrsj_import'] }, ref: { type: 'string' },
                query: { type: 'object', properties: { op: { type: 'string', enum: ['graph_overview', 'list_goals', 'list_facts', 'node_detail', 'list_assets', 'asset_neighbors'] }, id: { type: 'string' }, q: { type: 'string' }, before: { type: 'string' }, projectionId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['op'], additionalProperties: false },
                documentToken: { type: 'string' }, elementRef: { type: 'string' }, projectionId: { type: 'string' }, offset: { type: 'integer', minimum: 0, maximum: config.graphMaxDetailBytes }
            }, required: [], additionalProperties: false }, output: outputOf('browser_observe'),
        async execute(args, exec) {
            const view = args.view ?? 'page';
            if (!['page', 'table', 'region', 'task', 'file', 'bjrsj_import'].includes(String(view)) || Object.keys(args).some(k => !['view', 'ref', 'query', 'documentToken', 'elementRef', 'projectionId', 'offset'].includes(k)))
                return failure('invalid_request', 'unsupported observation arguments');
            if (args.query !== undefined && (view !== 'task' || args.ref !== undefined || args.offset !== undefined || args.projectionId !== undefined || !args.query || typeof args.query !== 'object' || Array.isArray(args.query) || JSON.stringify(args.query).length > 3000))
                return failure('invalid_request', 'task query cannot be combined with a detail reference');
            if (args.ref !== undefined && (!['task', 'file'].includes(String(view)) || typeof args.ref !== 'string' || !args.ref || args.ref.length > 240))
                return failure('invalid_request', 'provide a bounded task or file reference');
            if (view === 'file' && args.ref === undefined)
                return failure('invalid_request', 'file snapshot reference required');
            if (args.offset !== undefined && (args.ref === undefined || !Number.isSafeInteger(args.offset) || Number(args.offset) < 0 || Number(args.offset) > config.graphMaxDetailBytes))
                return failure('invalid_request', 'invalid detail offset');
            if (args.projectionId !== undefined && (args.ref === undefined || typeof args.projectionId !== 'string' || !/^[a-f0-9]{64}$/.test(args.projectionId)))
                return failure('invalid_request', 'invalid detail projection identity');
            if ((args.documentToken !== undefined || args.elementRef !== undefined) && (!['table', 'region'].includes(String(view)) || typeof args.documentToken !== 'string' || !args.documentToken || typeof args.elementRef !== 'string' || !args.elementRef))
                return failure('invalid_request', 'region target requires current documentToken and elementRef');
            const caller = service.resolveCaller(exec);
            if (!caller.ok)
                return caller;
            const detail = args.ref !== undefined || args.query !== undefined || args.elementRef !== undefined ? { ref: typeof args.ref === 'string' ? args.ref : '', offset: Number(args.offset ?? 0), ...(typeof args.projectionId === 'string' ? { projectionId: args.projectionId } : {}), ...(args.query !== undefined ? { query: args.query } : {}), ...(typeof args.elementRef === 'string' ? { elementRef: args.elementRef, documentToken: String(args.documentToken) } : {}) } : undefined;
            return service.observe(caller.value, exec.signal, String(view), detail);
        }
    };
}
/** @param {ToolService} service - Host service. @returns {object} `browser_find`. */
function findTool(service) {
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
        async execute(args, exec) {
            const by = args.by;
            const value = args.value;
            const name = args.name;
            if (typeof by !== 'string' || !['text', 'attr', 'role'].includes(by)) {
                return failure('invalid_request', 'by must be text, attr or role');
            }
            if (typeof value !== 'string' || value.length === 0)
                return failure('invalid_request', 'value is required');
            if (by === 'attr' && (typeof name !== 'string' || name.length === 0)) {
                return failure('invalid_request', 'name is required when by is attr');
            }
            if (name !== undefined && typeof name !== 'string')
                return failure('invalid_request', 'name must be a string');
            const resolved = service.resolveCaller(exec);
            if (!resolved.ok)
                return resolved;
            return service.find(resolved.value, { by, value, ...(name === undefined ? {} : { name }) }, exec.signal);
        },
    };
}
/** @param {ToolService} service - Host service. @returns {object} `browser_act`. */
function actTool(service) {
    return {
        name: 'browser_act',
        description: 'Operate one element of the authorized page. Actions: click; type (replaces the whole value of an input, '
            + 'textarea or contenteditable, never appends); select (sets an explicit option); check (sets an explicit checked '
            + 'state); set_file (one user-confirmed file grant targeting its visible upload control). set_file accepts only '
            + 'fileGrantId, never a path or bytes; selection can immediately send the site\'s validation request and never means '
            + 'import_confirmed. Every page action re-validates the documentToken, the element reference, visibility and operability first, and '
            + 'fails with stale_observation rather than choosing another element. Actions are never retried automatically: '
            + 'page events and saves can have side effects, so confirm the result with browser_observe. Password fields are refused. '
            + 'await_user records a bounded human dependency in the current task without page authorization or dispatch. It takes only action and wait; the user must supply the condition and resume in the panel. It cannot grant control or prove success. '
            + 'explore records ARTEX-style semantic operations without entering the page: set_goals, add_hint, add_intent, claim_intent, finish_intent, record_fact, check_evidence and prove_goal. It requires requestId and expectedVersion. Commands are limited to 100000 characters, resulting events to 200000 characters and 256 edges; split oversized fact batches into separate requests. Claim one intent before page mutations, write observed/inferred facts, finish it, then prove goals using observed facts with passing original-backed checks. Business interpretation remains Agent-authored. '
            + LOG_NOTICE,
        parameters: {
            type: 'object',
            properties: {
                explore: { type: 'object', properties: {
                        op: { type: 'string', enum: ['set_goals', 'add_hint', 'add_intent', 'claim_intent', 'finish_intent', 'record_fact', 'check_evidence', 'prove_goal'] },
                        text: { type: 'string', description: 'New goal or planning hint.' }, goals: { type: 'array', maxItems: 32, items: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } },
                        summary: { type: 'string', description: 'Intent direction or integrated fact conclusion.' }, detail: { type: 'string', maxLength: 8000 }, evidence: { type: 'string', maxLength: 2000 },
                        confidence: { type: 'string', enum: ['observed', 'inferred'] }, intent_id: { type: 'string', description: 'Current semantic intent, not a browser attempt.' },
                        asset_ids: { type: 'array', items: { type: 'string' }, maxItems: 32, description: 'Current resource-* IDs.' }, parent_ids: { type: 'array', items: { type: 'string' }, maxItems: 32, description: 'Existing fact IDs; empty uses origin.' }, priority: { type: 'integer', minimum: 0, maximum: 10 },
                        evidence_refs: { type: 'array', items: { type: 'string' }, maxItems: 64, description: 'Exact original page/file asset-* snapshots.' }, check_refs: { type: 'array', items: { type: 'string' }, maxItems: 32, description: 'Passing check_evidence references for the same snapshots.' },
                        intents: { type: 'array', maxItems: 4, items: { type: 'object', properties: { summary: { type: 'string', maxLength: 2000 }, asset_ids: { type: 'array', items: { type: 'string' }, maxItems: 32 }, parent_ids: { type: 'array', items: { type: 'string' }, maxItems: 32 }, priority: { type: 'integer', minimum: 0, maximum: 10 } }, required: ['summary'], additionalProperties: false } },
                        facts: { type: 'array', maxItems: 32, items: { type: 'object', properties: { summary: { type: 'string', maxLength: 2000 }, detail: { type: 'string', maxLength: 8000 }, evidence: { type: 'string', maxLength: 2000 }, confidence: { type: 'string', enum: ['observed', 'inferred'] }, intent_id: { type: 'string' }, asset_ids: { type: 'array', items: { type: 'string' }, maxItems: 32 }, evidence_refs: { type: 'array', items: { type: 'string' }, maxItems: 64 }, check_refs: { type: 'array', items: { type: 'string' }, maxItems: 32 } }, required: ['summary', 'confidence'], additionalProperties: false } },
                        state: { type: 'string', enum: ['done', 'blocked', 'exhausted', 'stopped'] }, reason: { type: 'string' }, goal_id: { type: 'string' }, evidence_id: { type: 'string' },
                        assertion: { type: 'object', description: 'Source-backed atom {op,left:{ref,path},right:{value} or {ref,path}}; op exists, equals, contains, count or setEquals. exists omits right. Or {op:all|any,checks:[atoms]}, maximum 32 atoms; paths are arrays of keys/indices. No scripts or nested composition.', additionalProperties: true }
                    }, required: ['op'], additionalProperties: false },
                requestId: { type: 'string', description: 'Unique semantic request ID; reuse only for an identical acknowledgement retry.' }, expectedVersion: { type: 'integer', minimum: 1, description: 'Latest contextVersion returned by the current task.' },
                documentToken: { type: 'string', description: 'documentToken from the observation that produced elementRef.' },
                elementRef: { type: 'string', description: 'Element reference from browser_observe or browser_find.' },
                action: { type: 'string', enum: ['click', 'type', 'select', 'check', 'set_file', 'await_user', 'explore'], description: 'Page action, or await_user to record a task-local human dependency without entering a page. Only the user can resume.' },
                fileGrantId: { type: 'string', description: 'One confirmed file grant from browser_tabs, required only for set_file.' },
                value: { type: 'string', description: 'Replacement text for type, or option value/text for select.' },
                checked: { type: 'boolean', description: 'Explicit checked state for check.' },
                wait: { type: 'object', properties: { kind: { type: 'string', enum: [...USER_WAIT_KINDS] }, reason: { type: 'string', minLength: 1, maxLength: 1000 }, resumeCondition: { type: 'string', minLength: 1, maxLength: 1000 } }, required: ['kind', 'reason', 'resumeCondition'], additionalProperties: false },
            },
            required: ['action'],
            additionalProperties: false,
        },
        output: outputOf('browser_act'),
        async execute(args, exec) {
            if (args.action === 'explore') {
                if (Object.keys(args).some(k => !['action', 'explore', 'requestId', 'expectedVersion'].includes(k)))
                    return failure('invalid_request', 'explore takes only its command, requestId and expectedVersion');
                try {
                    validateExplorationCommand(args.explore);
                }
                catch (error) {
                    return failure('invalid_request', error instanceof ExplorationError ? error.message : 'invalid exploration command');
                }
                const caller = service.resolveCaller(exec);
                return caller.ok ? service.act(caller.value, { action: 'explore', explore: args.explore, requestId: args.requestId, expectedVersion: args.expectedVersion }, exec.signal) : caller;
            }
            if (args.action === 'await_user') {
                if (Object.keys(args).some(key => !['action', 'wait'].includes(key)) || !validUserWait(args.wait))
                    return failure('invalid_request', 'await_user takes only a user dependency, reason and resumeCondition');
                const caller = service.resolveCaller(exec);
                return caller.ok ? service.act(caller.value, { action: 'await_user', wait: args.wait }, exec.signal) : caller;
            }
            if (args.wait !== undefined)
                return failure('invalid_request', 'wait is only valid for await_user');
            const documentToken = args.documentToken;
            const elementRef = args.elementRef;
            const action = args.action;
            if (typeof documentToken !== 'string' || documentToken.length === 0)
                return failure('invalid_request', 'documentToken is required');
            if (typeof elementRef !== 'string' || elementRef.length === 0)
                return failure('invalid_request', 'elementRef is required');
            if (typeof action !== 'string' || !['click', 'type', 'select', 'check', 'set_file'].includes(action)) {
                return failure('invalid_request', 'action must be click, type, select, check or set_file');
            }
            if (action === 'type' && (typeof args.value !== 'string' || args.value.length === 0)) {
                return failure('invalid_request', 'value is required for type');
            }
            if (action === 'select' && (typeof args.value !== 'string' || args.value.length === 0)) {
                return failure('invalid_request', 'value is required for select');
            }
            if (action === 'check' && typeof args.checked !== 'boolean')
                return failure('invalid_request', 'checked is required for check');
            if (action === 'click' && (args.value !== undefined || args.checked !== undefined)) {
                return failure('invalid_request', 'click takes no value or checked');
            }
            if (action === 'set_file' && (typeof args.fileGrantId !== 'string' || !args.fileGrantId || args.fileGrantId.length > 200
                || Object.keys(args).some(key => !['documentToken', 'elementRef', 'action', 'fileGrantId'].includes(key))))
                return failure('invalid_request', 'set_file requires only a current target and fileGrantId');
            if (action !== 'set_file' && args.fileGrantId !== undefined)
                return failure('invalid_request', 'fileGrantId is only valid for set_file');
            const resolved = service.resolveCaller(exec);
            if (!resolved.ok)
                return resolved;
            return service.act(resolved.value, {
                documentToken, elementRef, action,
                ...(action === 'set_file' ? { fileGrantId: args.fileGrantId } : {}),
                ...(args.value === undefined ? {} : { value: args.value }),
                ...(args.checked === undefined ? {} : { checked: args.checked }),
            }, exec.signal);
        },
    };
}
/** @param {ToolService} service - Host service. @param {import('./config.ts').BrowserFlowConfig} config - config. @returns {object} `browser_wait`. */
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
        async execute(args, exec) {
            const documentToken = args.documentToken;
            const elementRef = args.elementRef;
            const condition = args.condition;
            const timeoutMs = args.timeoutMs;
            if (typeof documentToken !== 'string' || documentToken.length === 0)
                return failure('invalid_request', 'documentToken is required');
            if (typeof elementRef !== 'string' || elementRef.length === 0)
                return failure('invalid_request', 'elementRef is required');
            if (typeof condition !== 'string' || !['present', 'absent', 'text'].includes(condition)) {
                return failure('invalid_request', 'condition must be present, absent or text');
            }
            if (condition === 'text' && (typeof args.text !== 'string' || args.text.length === 0)) {
                return failure('invalid_request', 'text is required when condition is text');
            }
            if (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > config.waitMaxMs) {
                return failure('invalid_request', `timeoutMs must be an integer from 1 through ${String(config.waitMaxMs)}`);
            }
            const resolved = service.resolveCaller(exec);
            if (!resolved.ok)
                return resolved;
            return service.wait(resolved.value, {
                documentToken, elementRef, condition, timeoutMs,
                ...(args.text === undefined ? {} : { text: args.text }),
            }, exec.signal);
        },
    };
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
        async execute(_args, exec) {
            const resolved = service.resolveCaller(exec);
            if (!resolved.ok)
                return resolved;
            return service.release(resolved.value);
        },
    };
}
