export type PagePolicy = {
    adapter: "bjrsj";
    workflow: "navigation" | "import";
    kind?: import("./import-rules.ts").BatchKind;
};
/** @param {import('./task-store.ts').Manifest} manifest - verified manifest. @param {import('./import-rules.ts').BatchKind} [kind] - confirmed panel business scope. @returns {PagePolicy | undefined} fixed per-site action restrictions. */
export declare function pagePolicy(manifest: import('./task-store.ts').Manifest, kind?: import('./import-rules.ts').BatchKind): PagePolicy | undefined;
/** @param {import('./task-store.ts').Manifest} manifest - current task. @param {Record<string, unknown>} page - current validated main-document observation. @returns {{verdict:string,source:'code_verified',reason:string}} code facts, never a generic success fallback. */
export declare function navigationVerdict(manifest: import('./task-store.ts').Manifest, page: Record<string, unknown>): {
    verdict: string;
    source: 'code_verified';
    reason: string;
};
