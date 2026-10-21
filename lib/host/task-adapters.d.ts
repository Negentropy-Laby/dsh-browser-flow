/** @typedef {{ adapter:'bjrsj', workflow:'navigation'|'import', kind?: import('./import-rules.js').BatchKind }} PagePolicy */
/** @param {import('./task-store.js').Manifest} manifest - verified manifest. @param {import('./import-rules.js').BatchKind} [kind] - confirmed panel business scope. @returns {PagePolicy | undefined} fixed per-site action restrictions. */
export function pagePolicy(manifest: import("./task-store.js").Manifest, kind?: import("./import-rules.js").BatchKind): PagePolicy | undefined;
/** @param {import('./task-store.js').Manifest} manifest - current task. @param {Record<string, unknown>} page - current validated main-document observation. @returns {{verdict:string,source:'code_verified',reason:string}} code facts, never a generic success fallback. */
export function navigationVerdict(manifest: import("./task-store.js").Manifest, page: Record<string, unknown>): {
    verdict: string;
    source: "code_verified";
    reason: string;
};
export type PagePolicy = {
    adapter: "bjrsj";
    workflow: "navigation" | "import";
    kind?: import("./import-rules.js").BatchKind;
};
