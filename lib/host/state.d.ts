/**
 * Monotonic clock used for deadlines.
 * @returns {number} milliseconds on a monotonic scale.
 */
export function monotonicNow(): number;
/**
 * Create one control-state store.
 * @param {object} [options] - store options.
 * @param {() => number} [options.now] - monotonic clock injection for tests.
 * @returns {object} the store.
 */
export function createControlState(options?: {
    now?: (() => number) | undefined;
}): object;
export const INVALIDATION_EVENTS: readonly string[];
/**
 * One page the panel reports, as the Host remembers it.
 */
export type PanelPage = {
    /**
     * - guest lease the webview carries as its `name`.
     */
    lease: string;
    /**
     * - guest partition.
     */
    partition: string;
    /**
     * - redacted address, for display only.
     */
    url: string;
    /**
     * - page-minted document identity.
     */
    documentToken: string;
    /**
     * - plugin tab alias, for display only.
     */
    tabId?: string | undefined;
    /**
     * - page title, for display only.
     */
    title?: string | undefined;
};
/**
 * One registered panel connection (one live panel instance at one generation).
 */
export type PanelConnection = {
    /**
     * - panel instance identity.
     */
    instanceId: string;
    /**
     * - connection generation.
     */
    generation: number;
    /**
     * - Session the panel belongs to.
     */
    sessionId: string;
    /**
     * - pages the panel can see.
     */
    pages: PanelPage[];
    /**
     * - monotonic time of the last poll.
     */
    lastSeen: number;
};
/**
 * One queued or in-flight command.
 */
export type CommandEntry = {
    /**
     * - command identity.
     */
    id: string;
    /**
     * - validated operation.
     */
    op: object;
    /**
     * - settles the caller.
     */
    resolve: (value: object) => void;
    /**
     * - caller cancellation.
     */
    signal: AbortSignal | undefined;
    /**
     * - registered abort listener.
     */
    abortListener: (() => void) | undefined;
    /**
     * - whether the caller has been answered.
     */
    settled: boolean;
    /**
     * - whether the panel took the command.
     */
    dispatched: boolean;
    /**
     * - monotonic deadline.
     */
    deadlineAt: number;
    /**
     * - assigned on dispatch.
     */
    sequence: number;
};
/**
 * One dispatched command awaiting its result.
 *
 * Keyed by command id. `command` is the wire envelope handed to the panel;
 * `entry` is the local caller's record.
 */
export type InFlightRecord = {
    /**
     * - the command.
     */
    entry: CommandEntry;
    /**
     * - wire envelope for the panel.
     */
    command: {
        deadlineAt: number;
        sequence: number;
        budgetMs: number;
    };
    /**
     * - result state.
     */
    outcome: "pending" | "settled" | "unknown_outcome" | "dropped";
    /**
     * - whether the panel has taken it.
     */
    taken: boolean;
    /**
     * - immutable recipient recorded on take.
     */
    delivery: {
        instanceId: string;
        generation: number;
        epoch: number;
    } | undefined;
};
/**
 * One control lease: the authorization to operate one page for one Agent.
 */
export type ControlLease = {
    /**
     * - control lease identity.
     */
    id: string;
    /**
     * - verified immutable task/run binding.
     */
    task?: import("./task-scope.ts").RunScope | undefined;
    /**
     * - authorized Session.
     */
    sessionId: string;
    /**
     * - plugin-minted token of the exact Agent.
     */
    agentInstanceToken: string;
    /**
     * - the exact live Agent object.
     */
    agent: object;
    /**
     * - panel instance that authorized it.
     */
    connectionInstanceId: string;
    /**
     * - generation that authorized it.
     */
    connectionGeneration: number;
    /**
     * - guest lease.
     */
    lease: string;
    /**
     * - guest partition.
     */
    partition: string;
    /**
     * - document identity at authorization.
     */
    documentToken: string;
    /**
     * - plugin tab alias.
     */
    tabId: string;
    /**
     * - observation epoch.
     */
    epoch: number;
    /**
     * - lease state.
     */
    state: "active" | "revoked";
    /**
     * - next accepted result sequence.
     */
    nextSequence: number;
    /**
     * - ids the Host settled without a result.
     */
    abandoned: Set<string>;
    /**
     * - commands waiting to dispatch.
     */
    queue: CommandEntry[];
    /**
     * - dispatched commands by command id.
     */
    inFlight: Map<string, InFlightRecord>;
    /**
     * - last settled command.
     */
    lastCompletedCommandId: string | undefined;
    /**
     * - why control ended, when revoked.
     */
    revokedReason: string | undefined;
};
