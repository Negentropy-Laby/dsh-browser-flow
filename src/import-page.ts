/** Fixed passive observer and one-file assignment compiled from TypeScript. */
import { PAGE_RUNTIME_SOURCE, PASSIVE_IMPORT_SOURCE } from '#browser-flow/page-programs'
import { IMPORT_ORIGIN, IMPORT_PATHS, IMPORT_TABS, IMPORT_DATA, BODY_LIMIT } from './import-rules.ts'
import type { ImportInput } from './page/input.ts'
/** @param input - validated owner, mode and relative lifetime. @returns Self-contained passive observation program. */
export function importProgram(input:ImportInput): string {
  const config={origin:IMPORT_ORIGIN,paths:IMPORT_PATHS,tabs:IMPORT_TABS,knowledge:IMPORT_DATA,limit:BODY_LIMIT}
  return `(function(){const runtime=(${PAGE_RUNTIME_SOURCE})();return (${PASSIVE_IMPORT_SOURCE})(runtime,${JSON.stringify(input)},${JSON.stringify(config)});})()`
}
