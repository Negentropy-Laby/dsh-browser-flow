/** @param {import('./task-store.js').TaskData} task - opened owned task. @returns {{verdict:string,sourceSeq:number|null,proofRef:string|null,criteria:import('./graph/protocol.ts').Criterion[]}} independently verified current facts. */
export function taskFacts(task: import("./task-store.js").TaskData): {
    verdict: string;
    sourceSeq: number | null;
    proofRef: string | null;
    criteria: import("./graph/protocol.ts").Criterion[];
};
/** @param {import('./task-store.js').TaskData} task - opened owned task. @returns {Set<string>} owned original references; no derived digest can authorize a relation. */
export function taskReferences(task: import("./task-store.js").TaskData): Set<string>;
