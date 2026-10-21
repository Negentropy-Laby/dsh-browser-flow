/** Fixed passive observer and one-file assignment compiled from TypeScript. */
import { PAGE_RUNTIME_SOURCE, PASSIVE_IMPORT_SOURCE, PAGE_POLICY_SOURCE } from '#browser-flow/page-programs'
import { IMPORT_ORIGIN, IMPORT_PATHS, IMPORT_TABS, IMPORT_DATA, BODY_LIMIT } from './import-rules.ts'
import type { ImportInput, PagePolicy } from './page/types.ts'
/** @param scope - code-owned restriction. @returns Fixed policy declaration for program composition. */
export function importActionPolicy(scope:PagePolicy|undefined): string { return `const importPolicy=(${PAGE_POLICY_SOURCE});const importScope=${JSON.stringify(scope??null)};` }
/** @param input - validated owner, mode and relative lifetime. @returns Self-contained passive observation program. */
export function importProgram(input:ImportInput): string {
  const config={origin:IMPORT_ORIGIN,paths:IMPORT_PATHS,tabs:IMPORT_TABS,knowledge:IMPORT_DATA,limit:BODY_LIMIT}
  return `(function(){const runtime=(${PAGE_RUNTIME_SOURCE})();return (${PASSIVE_IMPORT_SOURCE})(runtime,${JSON.stringify(input)},${JSON.stringify(config)});})()`
}
