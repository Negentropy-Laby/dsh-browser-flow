/** @param {import('./task-store.ts').TaskData} task - opened owned task. @returns {{verdict:string,sourceSeq:number|null,proofRef:string|null,criteria:import('./graph/protocol.ts').Criterion[]}} independently verified current facts. */
export declare function taskFacts(task: import('./task-store.ts').TaskData): {
    verdict: string;
    sourceSeq: number | null;
    proofRef: string | null;
    criteria: import('./graph/protocol.ts').Criterion[];
};
/** @param {import('./task-store.ts').TaskData} task - opened owned task. @returns {Set<string>} owned original references; no derived digest can authorize a relation. */
export declare function taskReferences(task: import('./task-store.ts').TaskData): Set<string>;
