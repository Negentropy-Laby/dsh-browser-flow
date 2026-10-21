/**
 * Build every tool definition bound to one service instance.
 * @param {ToolService} service - the browser-flow Host service.
 * @param {import('./config.js').BrowserFlowConfig} config - resolved config.
 * @returns {object[]} tool definitions.
 */
export function createTools(service: ToolService, config: import("./config.js").BrowserFlowConfig): object[];
/**
 * One tool call's execution context, as the Host supplies it.
 */
export type ToolExec = {
    /**
     * - the live Agent making the call.
     */
    agent?: object | undefined;
    /**
     * - caller cancellation.
     */
    signal: AbortSignal;
};
/**
 * The Host service the tools call into.
 *
 * Declared structurally so this module stays independent of the service class.
 */
export type ToolService = {
    /**
     * - bind canonical results to this task only.
     */
    annotate?: ((caller: object, result: any) => any) | undefined;
    /**
     * - resolve the calling Agent.
     */
    resolveCaller: (exec: ToolExec) => {
        ok: true;
        value: object;
    } | {
        ok: false;
        error: {
            code: string;
            message: string;
            details?: object;
        };
    };
    /**
     * - pages this Session may authorize.
     */
    listTabs: (caller: object) => {
        ok: boolean;
        value?: object;
        error?: object;
    };
    /**
     * - read the authorized page or import judgment.
     */
    observe: (caller: object, signal: AbortSignal, view?: string, detail?: {
        ref: string;
        offset: number;
    }) => Promise<object>;
    /**
     * - locate elements.
     */
    find: (caller: object, query: object, signal: AbortSignal) => Promise<object>;
    /**
     * - run one action.
     */
    act: (caller: object, action: object, signal: AbortSignal) => Promise<object>;
    /**
     * - wait for a condition.
     */
    wait: (caller: object, input: object, signal: AbortSignal) => Promise<object>;
    /**
     * - detach control.
     */
    release: (caller: object) => Promise<object>;
};
/**
 * The Host service the tools call into.
 *
 * Declared structurally so this module stays independent of the service class.
 */
export type ToolServiceOld = {
    /**
     * - resolve the calling Agent.
     */
    resolveCaller: (exec: object) => {
        ok: true;
        value: object;
    } | {
        ok: false;
        error: object;
    };
    /**
     * - pages this Session may authorize.
     */
    listTabs: (caller: object) => object;
    /**
     * - read the authorized page.
     */
    observe: (caller: object, signal: AbortSignal) => Promise<object>;
    /**
     * - locate elements.
     */
    find: (caller: object, query: object, signal: AbortSignal) => Promise<object>;
    /**
     * - run one action.
     */
    act: (caller: object, action: object, signal: AbortSignal) => Promise<object>;
    /**
     * - wait for a condition.
     */
    wait: (caller: object, input: object, signal: AbortSignal) => Promise<object>;
    /**
     * - detach control.
     */
    release: (caller: object) => Promise<object>;
};
