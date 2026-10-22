/** @param {unknown} raw - authenticated, identity-checked Client payload. @returns {{ unitBodies: string[], unitPending:number, coverage:boolean, closed:boolean, expired:boolean, cleanupFailed:boolean, fileGrantId:string|null, facts:import('./import-rules.ts').ImportFacts }} parsed private observations. */
export declare function decodeImportEvidence(raw: unknown): {
    unitBodies: string[];
    unitPending: number;
    coverage: boolean;
    closed: boolean;
    expired: boolean;
    cleanupFailed: boolean;
    fileGrantId: string | null;
    facts: import('./import-rules.ts').ImportFacts;
};
