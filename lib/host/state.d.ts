export type PanelPage = {
    lease: string;
    partition: string;
    url: string;
    documentToken: string;
    tabId?: string | undefined;
    title?: string | undefined;
};
export type PanelConnection = {
    instanceId: string;
    generation: number;
    sessionId: string;
    pages: PanelPage[];
    lastSeen: number;
};
export type CommandEntry = {
    id: string;
    op: PageOperation;
    resolve: (value: Result<Record<string, unknown>>) => void;
    signal: AbortSignal | undefined;
    abortListener: (() => void) | undefined;
    settled: boolean;
    dispatched: boolean;
    deadlineAt: number;
    sequence: number;
};
export type InFlightRecord = {
    entry: CommandEntry;
    command: {
        deadlineAt: number;
        sequence: number;
        budgetMs: number;
    };
    outcome: "pending" | "settled" | "unknown_outcome" | "dropped";
    taken: boolean;
    delivery: {
        instanceId: string;
        generation: number;
        epoch: number;
    } | undefined;
};
export type ControlLease = {
    id: string;
    task?: import("./task-scope.ts").RunScope | undefined;
    sessionId: string;
    agentInstanceToken: string;
    agent: object;
    connectionInstanceId: string;
    connectionGeneration: number;
    lease: string;
    partition: string;
    documentToken: string;
    tabId: string;
    epoch: number;
    state: "active" | "revoked";
    nextSequence: number;
    abandoned: Set<string>;
    queue: CommandEntry[];
    inFlight: Map<string, InFlightRecord>;
    lastCompletedCommandId: string | undefined;
    revokedReason: string | undefined;
    importKind?: import('./import-rules.js').BatchKind;
    evidenceRoot?: string;
};
import { type Result, type PageOperation } from './protocol.ts';
export declare const INVALIDATION_EVENTS: readonly string[];
/**
 * Monotonic clock used for deadlines.
 * @returns {number} milliseconds on a monotonic scale.
 */
export declare function monotonicNow(): number;
/**
 * Create one control-state store.
 * @param {object} [options] - store options.
 * @param {() => number} [options.now] - monotonic clock injection for tests.
 * @returns {object} the store.
 */
export declare function createControlState(options?: {
    now?: (() => number) | undefined;
}): {
    close: () => void;
    registerConnection: (hello: {
        connectionGeneration: number;
        sessionId: string;
        panel: {
            instanceId: string;
            pages: PanelPage[];
        };
    }) => {
        ok: false;
        error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
        };
    } | {
        ok: true;
        value: {
            generation: number;
        };
    };
    connectionsFor: (sessionId: string) => PanelConnection[];
    expireIdleConnections: (idleMs: number) => string[];
    authorize: (input: {
        connectionInstanceId: string;
        connectionGeneration: number;
        task?: import("./task-scope.ts").RunScope | undefined;
        sessionId: string;
        agentInstanceToken: string;
        agent: object;
        lease: string;
        partition: string;
        documentToken: string;
        tabId?: string | undefined;
    }) => {
        ok: false;
        error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
        };
    } | {
        ok: true;
        value: {
            controlLeaseId: string;
            epoch: number;
            documentToken: string;
            sessionId: string;
            tabId: string;
            nextSequence: number;
        };
    };
    leaseFor: (agent: object, agentInstanceToken: string, sessionId: string) => ControlLease | undefined;
    leaseCountForSession: (sessionId: string) => number;
    retireLeasesOfReplacedAgents: (sessionId: string, liveAgent: object) => string[];
    listPages: (instanceId: string, generation: number) => {
        ok: false;
        error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
        };
    } | {
        ok: true;
        value: {
            pages: {
                controlLeaseId?: string | undefined;
                epoch?: number | undefined;
                lease: string;
                tabId: string;
                url: string;
                title: string;
                authorized: boolean;
            }[];
        };
    };
    reportInvalidation: (instanceId: string, generation: number, guestLease: string, event: string, documentToken?: string) => {
        ok: false;
        error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
        };
    } | {
        ok: true;
        value: {
            affected: {
                controlLeaseId: string;
                state: "active";
                epoch: number;
            }[];
        };
    };
    revoke: (input: {
        controlLeaseId?: string | undefined;
        sessionId?: string | undefined;
    }, reason: string) => {
        ok: false;
        error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
        };
    } | {
        ok: true;
        value: {
            revoked: string[];
            pageRetained: boolean;
        };
    };
    run: (lease: ControlLease, op: PageOperation, limits: import("./config.ts").BrowserFlowConfig, signal?: AbortSignal) => Promise<Result<Record<string, unknown>>>;
    pumpAll: (limits: import("./config.ts").BrowserFlowConfig) => void;
    takeCommands: (instanceId: string, generation: number, limits: import("./config.ts").BrowserFlowConfig) => {
        ok: false;
        error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
        };
    } | {
        ok: true;
        value: {
            commands: {
                deadlineAt: number;
                sequence: number;
                budgetMs: number;
            }[];
            dropped: string[];
        };
    };
    settle: (result: Omit<import("./protocol.ts").ResultEnvelope, "kind" | "protocolVersion" | "task"> & {
        task?: import("./task-scope.ts").RunScope;
    }, limits: import("./config.ts").BrowserFlowConfig) => {
        ok: false;
        error: {
            code: string;
            message: string;
            details?: Record<string, unknown>;
        };
    } | {
        ok: true;
        value: {
            settled: string;
            outcome: string;
        };
    };
    describeLease: (controlLeaseId: string) => {
        revokedReason?: string | undefined;
        controlLeaseId: string;
        state: "active" | "revoked";
        epoch: number;
        sessionId: string;
        tabId: string;
        guestLease: string;
        queueLength: number;
        inFlight: number;
    } | undefined;
    connectionCount: () => number;
    leaseCount: () => number;
};
