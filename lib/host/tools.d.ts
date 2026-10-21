import type { BrowserFlowService, ToolExec } from './index.ts';
export type { ToolExec } from './index.ts';
export type ToolService = Pick<BrowserFlowService, 'annotate' | 'resolveCaller' | 'listTabs' | 'observe' | 'find' | 'act' | 'wait' | 'release'>;
export type ToolDefinition = ReturnType<typeof createTools>[number];
/**
 * Build every tool definition bound to one service instance.
 * @param {ToolService} service - the browser-flow Host service.
 * @param {import('./config.ts').BrowserFlowConfig} config - resolved config.
 * @returns {object[]} tool definitions.
 */
export declare function createTools(service: ToolService, config: import('./config.ts').BrowserFlowConfig): ({
    execute(args: Record<string, unknown>, exec: ToolExec): Promise<{
        ok: false;
        error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
        };
    } | {
        ok: true;
        value: object;
    }>;
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
    execute(args: Record<string, unknown>, exec: ToolExec): Promise<{
        ok: false;
        error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
        };
    } | {
        ok: true;
        value: object;
    }>;
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            view: {
                type: string;
                enum: string[];
                description: string;
            };
            ref: {
                type: string;
                description: string;
            };
            offset: {
                type: string;
                minimum: number;
                description: string;
            };
        };
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
    execute(args: Record<string, unknown>, exec: ToolExec): Promise<{
        ok: false;
        error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
        };
    } | {
        ok: true;
        value: object;
    }>;
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
    execute(args: Record<string, unknown>, exec: ToolExec): Promise<{
        ok: false;
        error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
        };
    } | {
        ok: true;
        value: object;
    }>;
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
    execute(args: Record<string, unknown>, exec: ToolExec): Promise<{
        ok: false;
        error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
        };
    } | {
        ok: true;
        value: object;
    }>;
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
} | {
    execute(args: Record<string, unknown>, exec: ToolExec): Promise<{
        ok: false;
        error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
        };
    } | {
        ok: true;
        value: object;
    }>;
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
})[];
