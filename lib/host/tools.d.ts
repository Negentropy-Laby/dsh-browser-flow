import type { BrowserFlowService, ToolExec } from './index.ts';
export type { ToolExec } from './index.ts';
/** Tools forward opaque result objects; each owning service retains its richer result type. */
export type ToolService = Pick<BrowserFlowService, 'resolveCaller'> & Partial<Pick<BrowserFlowService, 'annotate'>> & {
    listTabs(...args: Parameters<BrowserFlowService['listTabs']>): import('./protocol.ts').Result<object>;
    observe(...args: Parameters<BrowserFlowService['observe']>): Promise<import('./protocol.ts').Result<object>>;
    find(...args: Parameters<BrowserFlowService['find']>): Promise<import('./protocol.ts').Result<object>>;
    act(...args: Parameters<BrowserFlowService['act']>): Promise<import('./protocol.ts').Result<object>>;
    wait(...args: Parameters<BrowserFlowService['wait']>): Promise<import('./protocol.ts').Result<object>>;
    release(...args: Parameters<BrowserFlowService['release']>): import('./protocol.ts').Result<object> | Promise<import('./protocol.ts').Result<object>>;
};
export type ToolDefinition = ReturnType<typeof createTools>[number];
/**
 * Build every tool definition bound to one service instance.
 * @param {ToolService} service - the browser-flow Host service.
 * @param {import('./config.ts').BrowserFlowConfig} config - resolved config.
 * @returns {object[]} tool definitions.
 */
export declare function createTools(service: ToolService, config: import('./config.ts').BrowserFlowConfig): ({
    execute(args: Record<string, unknown>, exec: ToolExec): Promise<import("./protocol.ts").Result<object>>;
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {};
        required: never[];
        additionalProperties: boolean;
    };
    output: {
        schema: {
            type: string;
            additionalProperties: boolean;
        };
        render: (_args: object, value: unknown) => {
            type: string;
            text: string;
        }[];
        presentationMeta: (_args: object, value: unknown) => {
            tool: string;
        };
    };
} | {
    execute(args: Record<string, unknown>, exec: ToolExec): Promise<import("./protocol.ts").Result<object>>;
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            by: {
                type: string;
                enum: string[];
                description: string;
            };
            value: {
                type: string;
                description: string;
            };
            name: {
                type: string;
                description: string;
            };
        };
        required: string[];
        additionalProperties: boolean;
    };
    output: {
        schema: {
            type: string;
            additionalProperties: boolean;
        };
        render: (_args: object, value: unknown) => {
            type: string;
            text: string;
        }[];
        presentationMeta: (_args: object, value: unknown) => {
            tool: string;
        };
    };
} | {
    execute(args: Record<string, unknown>, exec: ToolExec): Promise<import("./protocol.ts").Result<object>>;
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            documentToken: {
                type: string;
                description: string;
            };
            elementRef: {
                type: string;
                description: string;
            };
            action: {
                type: string;
                enum: string[];
                description: string;
            };
            fileGrantId: {
                type: string;
                description: string;
            };
            value: {
                type: string;
                description: string;
            };
            checked: {
                type: string;
                description: string;
            };
            wait: {
                type: string;
                properties: {
                    kind: {
                        type: string;
                        enum: string[];
                    };
                    reason: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    resumeCondition: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                };
                required: string[];
                additionalProperties: boolean;
            };
        };
        required: string[];
        additionalProperties: boolean;
    };
    output: {
        schema: {
            type: string;
            additionalProperties: boolean;
        };
        render: (_args: object, value: unknown) => {
            type: string;
            text: string;
        }[];
        presentationMeta: (_args: object, value: unknown) => {
            tool: string;
        };
    };
} | {
    execute(args: Record<string, unknown>, exec: ToolExec): Promise<import("./protocol.ts").Result<object>>;
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            documentToken: {
                type: string;
                description: string;
            };
            elementRef: {
                type: string;
                description: string;
            };
            condition: {
                type: string;
                enum: string[];
                description: string;
            };
            text: {
                type: string;
                description: string;
            };
            timeoutMs: {
                type: string;
                description: string;
            };
        };
        required: string[];
        additionalProperties: boolean;
    };
    output: {
        schema: {
            type: string;
            additionalProperties: boolean;
        };
        render: (_args: object, value: unknown) => {
            type: string;
            text: string;
        }[];
        presentationMeta: (_args: object, value: unknown) => {
            tool: string;
        };
    };
})[];
