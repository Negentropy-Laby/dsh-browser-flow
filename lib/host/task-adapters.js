/** Trusted site policy. Definitions select supported adapters; they cannot supply validators or relax limits. */
import { IMPORT_ORIGIN, IMPORT_TABS } from './import-rules.js';
/** @typedef {{ adapter:'bjrsj', workflow:'navigation'|'import', kind?: import('./import-rules.js').BatchKind }} PagePolicy */
/** @param {import('./task-store.js').Manifest} manifest - verified manifest. @param {import('./import-rules.js').BatchKind} [kind] - confirmed panel business scope. @returns {PagePolicy | undefined} fixed per-site action restrictions. */
export function pagePolicy(manifest, kind) {
    if (manifest.adapter !== 'bjrsj')
        return undefined;
    if (manifest.adapterVersion !== 1 || !['navigation', 'import'].includes(manifest.workflowRef))
        throw new Error('unsupported-bjrsj-workflow');
    return { adapter: 'bjrsj', workflow: /** @type {'navigation'|'import'} */ (manifest.workflowRef), ...(kind ? { kind } : {}) };
}
/** @param {import('./task-store.js').Manifest} manifest - current task. @param {Record<string, unknown>} page - current validated main-document observation. @returns {{verdict:string,source:'code_verified',reason:string}} code facts, never a generic success fallback. */
export function navigationVerdict(manifest, page) {
    const fail = () => ({ verdict: 'unverified', source: /** @type {const} */ ('code_verified'), reason: 'required-visible-landmarks-not-proven' });
    if (manifest.adapter !== 'bjrsj' || manifest.workflowRef !== 'navigation')
        return fail();
    let url;
    try {
        url = new URL(String(page.url));
    }
    catch {
        return fail();
    }
    if (url.origin !== IMPORT_ORIGIN || !/(?:^|\/)information-third-new\/imp(?:\/|$)/.test(url.pathname) || !Array.isArray(page.nodes))
        return fail();
    const labels = new Set(page.nodes.flatMap(node => {
        if (!node || typeof node !== 'object')
            return [];
        return ['text', 'label'].map(key => typeof node[key] === 'string' ? node[key].replace(/\s/g, '') : '');
    }));
    if (!['模板下载', '模版下载'].some(label => labels.has(label)) || !labels.has('上传申报信息') || !Object.values(IMPORT_TABS).every(label => labels.has(label)))
        return fail();
    return { verdict: 'entry_reached', source: 'code_verified', reason: 'exact-origin-route-and-visible-landmarks' };
}
