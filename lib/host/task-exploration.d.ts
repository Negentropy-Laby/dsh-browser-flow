import type { Manifest, TaskData } from './task-store.ts';
export type ExplorationKind = 'goal' | 'intent' | 'fact' | 'hint';
export interface ExplorationNode {
    id: string;
    kind: ExplorationKind;
    source: 'agent' | 'host' | 'user_declared';
    state: string;
    data: Record<string, unknown>;
    asset_ids: string[];
    sourceSeq?: number;
}
export interface ExplorationEdge {
    id: string;
    from: string;
    to: string;
    relation: string;
}
export interface ExplorationChange {
    nodes: ExplorationNode[];
    edges: ExplorationEdge[];
    updates: {
        id: string;
        state: string;
    }[];
    round: boolean;
    completed: boolean;
}
export interface ExplorationState {
    nodes: Map<string, ExplorationNode>;
    edges: ExplorationEdge[];
    phase: 'planner' | 'worker';
    currentIntent: ExplorationNode | undefined;
    round: number;
}
export declare class ExplorationError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare const object: (v: unknown) => v is Record<string, unknown>;
export declare const isExploration: (m: Manifest) => boolean;
export declare const explorationRun: (task: TaskData) => {
    runId: import("./task-scope.ts").RunId;
    workflowRef: string;
    profileId: import("./task-scope.ts").ProfileId;
    taskId: import("./task-scope.ts").TaskId;
    ownerSessionId: string;
    scopeRevision: number;
};
export declare function canonical(value: unknown): string;
export declare function seedExploration(manifest: Manifest): ExplorationChange;
export declare function explorationState(task: TaskData): ExplorationState;
export declare function validExplorationEvent(row: Record<string, unknown>): boolean;
export declare const EXPLORATION_OPS: readonly ["set_goals", "add_hint", "add_intent", "claim_intent", "finish_intent", "record_fact", "check_evidence", "prove_goal"];
export declare function validateExplorationCommand(command: unknown): asserts command is Record<string, unknown>;
export declare function currentResources(task: TaskData): Map<string, {
    id: string;
    kind: string;
    snapshots: string[];
    run: ReturnType<typeof explorationRun>;
}>;
/** Explicit resource and exact-snapshot anchors share the same Host relation index. */
export declare function resourceAnchors(state: ExplorationState, resources: ReturnType<typeof currentResources>): Map<string, Set<string>>;
export declare function planExploration(task: TaskData, command: Record<string, unknown>, checkPassed: (id: string, evidenceRefs: string[]) => boolean, checkRef?: string): {
    changes: ExplorationChange;
    result: Record<string, unknown>;
};
export declare function explorationOverview(task: TaskData): {
    phase: "worker" | "planner";
    currentIntent: string | null;
    round: number;
    goals: {
        proofSource: string | null;
        asset_ids: string[];
        details: string;
        priority?: number | undefined;
        confidence?: string | undefined;
        id: string;
        state: string;
        source: "user_declared" | "host" | "agent";
        summary: string;
    }[];
    goals_total: number;
    goals_unmet: number;
    goals_details: {
        op: string;
    };
    hints: {
        asset_ids: string[];
        details: string;
        priority?: number | undefined;
        confidence?: string | undefined;
        id: string;
        state: string;
        source: "user_declared" | "host" | "agent";
        summary: string;
    }[];
    open_intents: {
        asset_ids: string[];
        details: string;
        priority?: number | undefined;
        confidence?: string | undefined;
        id: string;
        state: string;
        source: "user_declared" | "host" | "agent";
        summary: string;
    }[];
    running_intents: {
        asset_ids: string[];
        details: string;
        priority?: number | undefined;
        confidence?: string | undefined;
        id: string;
        state: string;
        source: "user_declared" | "host" | "agent";
        summary: string;
    }[];
    recent_done_intents: {
        asset_ids: string[];
        details: string;
        priority?: number | undefined;
        confidence?: string | undefined;
        id: string;
        state: string;
        source: "user_declared" | "host" | "agent";
        summary: string;
    }[];
    recent_facts: {
        asset_ids: string[];
        details: string;
        priority?: number | undefined;
        confidence?: string | undefined;
        id: string;
        state: string;
        source: "user_declared" | "host" | "agent";
        summary: string;
    }[];
    facts_total: number;
    assetCoverage: {
        denominator: number;
        tested: number;
        pct: number | null;
        note: string;
    };
    verification: string;
    details: string;
};
