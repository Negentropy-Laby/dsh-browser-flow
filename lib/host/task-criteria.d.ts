/** @typedef {{ role:string, path:string, sha256:string, bytes:number }} Artifact */
/** @typedef {{ value:Record<string,unknown>, files:Map<string,Buffer> }} CheckedProof */
/** @param {unknown} value - disk reference. @returns {value is Artifact} bounded, relative evidence file reference. */
export function validArtifact(value: unknown): value is Artifact;
/** @param {import('./task-store.js').Manifest} manifest - current owner. @returns {{id:string,validatorId:string,version:number,label:string} | undefined} code-owned criterion. */
export function trustedCriterion(manifest: import("./task-store.js").Manifest): {
    id: string;
    validatorId: string;
    version: number;
    label: string;
} | undefined;
/** @param {import('./task-store.js').TaskData} task - opened task. @param {Record<string,unknown>} row - journal judgment. @returns {string} verified current verdict or unverified. */
export function evidenceVerdict(task: import("./task-store.js").TaskData, row: Record<string, unknown>): string;
export type Artifact = {
    role: string;
    path: string;
    sha256: string;
    bytes: number;
};
export type CheckedProof = {
    value: Record<string, unknown>;
    files: Map<string, Buffer>;
};
