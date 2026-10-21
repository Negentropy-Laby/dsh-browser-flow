/** @param {import('./task-store.ts').TaskData} task - opened task. @param {import('./graph/protocol.ts').GraphConfig} config - resolved graph limits. @returns {import('./graph/protocol.ts').GraphInput} safe replay input without original assets or physical paths. */
export declare function graphInput(task: import('./task-store.ts').TaskData, config: import('./graph/protocol.ts').GraphConfig): import('./graph/protocol.ts').GraphInput;
/** @param {import('./task-store.ts').TaskData} task - current Host data. @param {number} budget - optional display budget. @param {Record<string,unknown>|undefined} derived - validated Go view. @param {string} reason - component status. @param {boolean} writable - current durable writer availability. @param {string} [projectionId] - exact safe input hash. @returns {Record<string,unknown>} five-module view with Host authority over safety and criteria. */
export declare function taskView(task: import('./task-store.ts').TaskData, budget: number, derived: Record<string, unknown> | undefined, reason: string, writable: boolean, projectionId?: string, cleanup?: {
    state: 'pending' | 'failed';
    code?: string;
}): {
    basic_law_index: {
        events: number;
        healthy: boolean;
        recent: {
            seq: number;
            hash: string;
            type: string;
        }[];
    };
    procedural_law_index: {
        goal: {
            text: string;
            source: string;
        };
        constraints: string[];
        criteria: import("./graph/protocol.ts").Criterion[];
        waiting: {
            id: string;
            kind: string;
            owner: string;
            source: string;
            reason: string;
            resumeCondition: string;
        }[];
        historicalWaiting: {
            sourceSeq: number;
            type: string;
        }[];
    };
    technical_law_index: Record<string, unknown>;
    knowledge_graph: Record<string, unknown>;
    active_context: {
        complete: boolean;
        pageControl: string;
        waiting: {
            id: string;
            kind: string;
            owner: string;
            source: string;
            reason: string;
            resumeCondition: string;
        } | null;
        waitingRef: string | null;
        taskId: import("./task-scope.ts").TaskId;
        contextVersion: number;
        state: string;
        goal: string;
        writeBlocked: boolean;
        logHealthy: boolean;
        businessVerdict: string;
        sourceSeq: number | null;
        storage: {
            schemaVersion: number | null;
            readOnly: boolean;
            issue: string | null;
        };
        evidenceIssues: string[];
        unmetCriteria: string[];
        criteriaRef: string;
        currentRun: import("./task-scope.ts").RunId;
        pendingAttempts: string[];
        unknownOutcomes: unknown[];
        sources: {
            seq: number;
            hash: string;
            type: string;
        }[];
        graph: {
            kernelVersion: string;
            cleanup?: {
                state: "pending" | "failed";
                code?: string;
            } | undefined;
            projectionId?: string | undefined;
            status: string;
            reason: string;
        };
    };
} | {
    basic_law_index: {
        events: number;
        healthy: boolean;
    };
    procedural_law_index: {
        details: string;
        criteriaRef: string;
    };
    technical_law_index: {
        details: string;
    };
    knowledge_graph: {
        details: string;
        digestCount: {};
    };
    active_context: {
        goal: string;
        waiting: {
            reason: string;
            resumeCondition: string;
            id: string;
            kind: string;
            owner: string;
            source: string;
        } | null;
        sources: never[];
        unmetCriteria: string[];
        unmetCount: number;
        unknownOutcomes: unknown[];
        unknownCount: number;
        evidenceIssues: string[];
        evidenceIssueCount: number;
        truncated: boolean;
        complete: boolean;
        pageControl: string;
        waitingRef: string | null;
        taskId: import("./task-scope.ts").TaskId;
        contextVersion: number;
        state: string;
        writeBlocked: boolean;
        logHealthy: boolean;
        businessVerdict: string;
        sourceSeq: number | null;
        storage: {
            schemaVersion: number | null;
            readOnly: boolean;
            issue: string | null;
        };
        criteriaRef: string;
        currentRun: import("./task-scope.ts").RunId;
        pendingAttempts: string[];
        graph: {
            kernelVersion: string;
            cleanup?: {
                state: "pending" | "failed";
                code?: string;
            } | undefined;
            projectionId?: string | undefined;
            status: string;
            reason: string;
        };
    };
};
