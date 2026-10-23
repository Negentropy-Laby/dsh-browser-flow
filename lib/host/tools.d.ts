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
            explore: {
                type: string;
                properties: {
                    op: {
                        type: string;
                        enum: string[];
                    };
                    text: {
                        type: string;
                        description: string;
                    };
                    goals: {
                        type: string;
                        maxItems: number;
                        items: {
                            type: string;
                            properties: {
                                text: {
                                    type: string;
                                };
                            };
                            required: string[];
                            additionalProperties: boolean;
                        };
                    };
                    summary: {
                        type: string;
                        description: string;
                    };
                    detail: {
                        type: string;
                    };
                    evidence: {
                        type: string;
                    };
                    confidence: {
                        type: string;
                        enum: string[];
                    };
                    intent_id: {
                        type: string;
                        description: string;
                    };
                    asset_ids: {
                        type: string;
                        items: {
                            type: string;
                        };
                        maxItems: number;
                        description: string;
                    };
                    parent_ids: {
                        type: string;
                        items: {
                            type: string;
                        };
                        maxItems: number;
                        description: string;
                    };
                    priority: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    evidence_refs: {
                        type: string;
                        items: {
                            type: string;
                        };
                        maxItems: number;
                        description: string;
                    };
                    check_refs: {
                        type: string;
                        items: {
                            type: string;
                        };
                        maxItems: number;
                        description: string;
                    };
                    intents: {
                        type: string;
                        maxItems: number;
                        items: {
                            type: string;
                            properties: {
                                summary: {
                                    type: string;
                                };
                                asset_ids: {
                                    type: string;
                                    items: {
                                        type: string;
                                    };
                                };
                                parent_ids: {
                                    type: string;
                                    items: {
                                        type: string;
                                    };
                                };
                                priority: {
                                    type: string;
                                    minimum: number;
                                    maximum: number;
                                };
                            };
                            required: string[];
                            additionalProperties: boolean;
                        };
                    };
                    facts: {
                        type: string;
                        maxItems: number;
                        items: {
                            type: string;
                            properties: {
                                summary: {
                                    type: string;
                                };
                                detail: {
                                    type: string;
                                };
                                evidence: {
                                    type: string;
                                };
                                confidence: {
                                    type: string;
                                    enum: string[];
                                };
                                intent_id: {
                                    type: string;
                                };
                                asset_ids: {
                                    type: string;
                                    items: {
                                        type: string;
                                    };
                                };
                                evidence_refs: {
                                    type: string;
                                    items: {
                                        type: string;
                                    };
                                };
                                check_refs: {
                                    type: string;
                                    items: {
                                        type: string;
                                    };
                                };
                            };
                            required: string[];
                            additionalProperties: boolean;
                        };
                    };
                    state: {
                        type: string;
                        enum: string[];
                    };
                    reason: {
                        type: string;
                    };
                    goal_id: {
                        type: string;
                    };
                    evidence_id: {
                        type: string;
                    };
                    assertion: {
                        type: string;
                        description: string;
                        additionalProperties: boolean;
                    };
                };
                required: string[];
                additionalProperties: boolean;
            };
            requestId: {
                type: string;
                description: string;
            };
            expectedVersion: {
                type: string;
                minimum: number;
                description: string;
            };
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
