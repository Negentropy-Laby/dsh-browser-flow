import { isRecord as object } from './object.ts';
import type { Manifest, TaskData, TaskEvent } from './task-store.ts';
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
    nodes: ReadonlyMap<string, ExplorationNode>;
    edges: readonly ExplorationEdge[];
    phase: 'planner' | 'worker';
    currentIntent: ExplorationNode | undefined;
    round: number;
}
export declare class ExplorationError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export { object };
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
export declare const originId: (manifest: Manifest) => string;
export declare function seedExploration(manifest: Manifest): ExplorationChange;
type MutableState = Omit<ExplorationState, 'nodes' | 'edges'> & {
    nodes: Map<string, ExplorationNode>;
    edges: ExplorationEdge[];
};
type Resource = {
    id: string;
    kind: string;
    snapshots: readonly string[];
    run: ReturnType<typeof explorationRun>;
};
export interface TaskDerivedIndex {
    run: ReturnType<typeof explorationRun>;
    processed: number;
    tail: string;
    assets: Map<string, TaskEvent>;
    currentAssets: Set<string>;
    state: MutableState;
    resources: Map<string, Resource>;
    view: ExplorationState;
    resourceView: ReadonlyMap<string, Resource>;
}
export declare function explorationState(task: TaskData): ExplorationState;
export declare function taskAsset(task: TaskData, id: string, currentRunOnly?: boolean): TaskEvent | undefined;
/** Validate only the proposed delta against the accepted prefix, without replay or mutation. */
export declare function assertExplorationChange(task: TaskData, change: ExplorationChange): void;
export declare function validExplorationEvent(row: Record<string, unknown>): boolean;
/** Reject an entire planned batch before evidence reads or any durable effects. */
export declare function assertExplorationCapacity(row: Record<string, unknown> & {
    changes: ExplorationChange;
}): void;
export declare const EXPLORATION_OPS: readonly ["set_goals", "add_hint", "add_intent", "claim_intent", "finish_intent", "record_fact", "check_evidence", "prove_goal"];
export declare function validateExplorationCommand(command: unknown): asserts command is Record<string, unknown>;
export declare function currentResources(task: TaskData): ReadonlyMap<string, Resource>;
/** Explicit resource and exact-snapshot anchors share the same Host relation index. */
export declare function resourceAnchors(state: ExplorationState, resources: ReturnType<typeof currentResources>): Map<string, Set<string>>;
export declare function planExploration(task: TaskData, command: Record<string, unknown>, checkPassed: (id: string, evidenceRefs: string[]) => boolean, checkRef?: string): {
    changes: ExplorationChange;
    result: Record<string, unknown>;
};
/** Only semantic observed facts with source-backed checks can establish a goal. */
export declare function proofAvailable(state: ExplorationState, goalId: string, check: (id: string, refs: string[]) => boolean): boolean;
export declare function explorationNodeView(n: ExplorationNode, state: ExplorationState, check: (id: string, refs: string[]) => boolean, compact?: boolean): {
    details?: string | undefined;
    text?: string | undefined;
    proofSource?: string | null | undefined;
    evidenceVerification?: string | null | undefined;
    data: Record<string, unknown>;
    summary: string;
    id: string;
    kind: ExplorationKind;
    source: "agent" | "host" | "user_declared";
    state: string;
    asset_ids: string[];
    sourceSeq?: number;
};
export declare function explorationOverview(task: TaskData, state?: ExplorationState, resources?: ReadonlyMap<string, Resource>, check?: (id: string, refs: string[]) => boolean): {
    phase: "worker" | "planner";
    currentIntent: string | null;
    round: number;
    originRef: string;
    goals: {
        details?: string | undefined;
        text?: string | undefined;
        proofSource?: string | null | undefined;
        evidenceVerification?: string | null | undefined;
        data: Record<string, unknown>;
        summary: string;
        id: string;
        kind: ExplorationKind;
        source: "agent" | "host" | "user_declared";
        state: string;
        asset_ids: string[];
        sourceSeq?: number;
    }[];
    goals_total: number;
    goals_unmet: number;
    goals_details: {
        op: string;
    };
    hints: {
        details?: string | undefined;
        text?: string | undefined;
        proofSource?: string | null | undefined;
        evidenceVerification?: string | null | undefined;
        data: Record<string, unknown>;
        summary: string;
        id: string;
        kind: ExplorationKind;
        source: "agent" | "host" | "user_declared";
        state: string;
        asset_ids: string[];
        sourceSeq?: number;
    }[];
    open_intents: {
        details?: string | undefined;
        text?: string | undefined;
        proofSource?: string | null | undefined;
        evidenceVerification?: string | null | undefined;
        data: Record<string, unknown>;
        summary: string;
        id: string;
        kind: ExplorationKind;
        source: "agent" | "host" | "user_declared";
        state: string;
        asset_ids: string[];
        sourceSeq?: number;
    }[];
    running_intents: {
        details?: string | undefined;
        text?: string | undefined;
        proofSource?: string | null | undefined;
        evidenceVerification?: string | null | undefined;
        data: Record<string, unknown>;
        summary: string;
        id: string;
        kind: ExplorationKind;
        source: "agent" | "host" | "user_declared";
        state: string;
        asset_ids: string[];
        sourceSeq?: number;
    }[];
    recent_done_intents: {
        details?: string | undefined;
        text?: string | undefined;
        proofSource?: string | null | undefined;
        evidenceVerification?: string | null | undefined;
        data: Record<string, unknown>;
        summary: string;
        id: string;
        kind: ExplorationKind;
        source: "agent" | "host" | "user_declared";
        state: string;
        asset_ids: string[];
        sourceSeq?: number;
    }[];
    recent_facts: {
        details?: string | undefined;
        text?: string | undefined;
        proofSource?: string | null | undefined;
        evidenceVerification?: string | null | undefined;
        data: Record<string, unknown>;
        summary: string;
        id: string;
        kind: ExplorationKind;
        source: "agent" | "host" | "user_declared";
        state: string;
        asset_ids: string[];
        sourceSeq?: number;
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
