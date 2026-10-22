/** Fixed fixture functions compiled by the existing fixture preparation step. */
import {readFileSync} from 'node:fs'
import {expectRecord,expectString} from './assertions.ts'
/** @param name - selected synthetic form. @returns A fixed call to its compiler-emitted behavior. */
export function fixtureProgram(name:'installActionForm'|'installTableLoop'):string {
 const raw:unknown=JSON.parse(readFileSync(new URL('../../.cache/fixtures/programs.json',import.meta.url),'utf8'))
 return `(${expectString(expectRecord(raw)[name])})();`
}
