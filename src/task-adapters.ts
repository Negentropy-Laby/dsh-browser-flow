export type PagePolicy = {
    adapter: "bjrsj";
    workflow: "navigation" | "import";
    kind?: import("./import-rules.ts").BatchKind;
};

/** Trusted site policy. Definitions select supported adapters; they cannot supply validators or relax limits. */
import { IMPORT_ORIGIN, IMPORT_TABS } from './import-rules.ts'

/** @param {import('./task-store.ts').Manifest} manifest - verified manifest. @param {import('./import-rules.ts').BatchKind} [kind] - confirmed panel business scope. @returns {PagePolicy | undefined} fixed per-site action restrictions. */
export function pagePolicy(manifest: import('./task-store.ts').Manifest,kind?: import('./import-rules.ts').BatchKind) : PagePolicy | undefined {
  if(manifest.adapter!=='bjrsj')return undefined
  if(manifest.adapterVersion!==1 || !['navigation','import'].includes(manifest.workflowRef))throw new Error('unsupported-bjrsj-workflow')
  return {adapter:'bjrsj',workflow:((manifest.workflowRef) as 'navigation' | 'import'),...(kind?{kind}:{})}
}
/** @param {import('./task-store.ts').Manifest} manifest - current task. @param {Record<string, unknown>} page - current validated main-document observation. @returns {{verdict:string,source:'code_verified',reason:string}} code facts, never a generic success fallback. */
export function navigationVerdict(manifest: import('./task-store.ts').Manifest,page: Record<string, unknown>) : {
    verdict: string;
    source: 'code_verified';
    reason: string;
} {
  const fail=()=>({verdict:'unverified',source:(('code_verified') as const),reason:'required-visible-landmarks-not-proven'})
  if(manifest.adapter!=='bjrsj'||manifest.workflowRef!=='navigation')return fail()
  let url
  try{url=new URL(String(page.url))}catch{return fail()}
  if(url.origin!==IMPORT_ORIGIN || !/(?:^|\/)information-third-new\/imp(?:\/|$)/.test(url.pathname) || !Array.isArray(page.nodes))return fail()
  const labels=new Set(page.nodes.flatMap(node=>{
    if(!node||typeof node!=='object')return []
    return ['text','label'].map(key=>typeof node[key]==='string'?node[key].replace(/\s/g,''):'')
  }))
  if(!['模板下载','模版下载'].some(label=>labels.has(label))||!labels.has('上传申报信息')||!Object.values(IMPORT_TABS).every(label=>labels.has(label)))return fail()
  return {verdict:'entry_reached',source:'code_verified',reason:'exact-origin-route-and-visible-landmarks'}
}
