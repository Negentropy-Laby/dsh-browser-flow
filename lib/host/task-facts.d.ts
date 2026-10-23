export interface TaskFacts {
    verdict: string;
    sourceSeq: number | null;
    proofRef: string | null;
    /** Diagnostic association only; this reference never proves a condition. */
    candidateProofRef: string | null;
    criteria: import('./graph/protocol.ts').Criterion[];
}
/** Independently verified current facts; callers may reuse them within one read phase. */
export declare function taskFacts(task: import('./task-store.ts').TaskData): TaskFacts;
/** Uses only Host facts. Call refreshEvidence before an authoritative tool read. */
export declare function taskCoverage(task: import('./task-store.ts').TaskData, facts?: TaskFacts): {
    total: number;
    verified: number;
    unverified: number;
    ratio: number | null;
    conditions: {
        verified: boolean;
        reason: string;
        proofRefs: string[];
        details: string;
        id: string;
        label: string;
        status: string;
        source: string;
        validatorId?: string;
        version?: number;
    }[];
};
/** New relations require both original endpoints in the exact current run. */
export declare function currentRunReferences(task: import('./task-store.ts').TaskData): Set<string>;
/** @param {import('./task-store.ts').TaskData} task - opened owned task. @returns {Set<string>} owned original references; no derived digest can authorize a relation. */
export declare function taskReferences(task: import('./task-store.ts').TaskData, { currentRunOnly }?: {
    currentRunOnly?: boolean;
}): Set<string>;
