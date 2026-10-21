/** Validation of private Client facts before the Host applies the domain judgment. */
import { record, BODY_LIMIT } from './import-rules.js'

/** @param {unknown} value - wire integer. @param {number} max - bound. @returns {number} bounded count. */
function count(value, max) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new Error('import-evidence-count'); return value }
/** @param {unknown} value - wire string. @param {number} max - bound. @returns {string} bounded text. */
function text(value, max) { if (typeof value !== 'string' || value.length > max) throw new Error('import-evidence-text'); return value }
/** @param {unknown} value - wire flag. @returns {boolean} exact flag. */
function flag(value) { if (typeof value !== 'boolean') throw new Error('import-evidence-flag'); return value }
/** @param {unknown} rows - wire rows. @returns {import('./import-rules.js').Person[]} complete typed rows. */
function people(rows) {
  if (!Array.isArray(rows) || rows.length > 10_000) throw new Error('import-evidence-rows')
  return rows.map(row=>{if(!record(row))throw new Error('import-evidence-row');return {name:text(row.name,256),certificateNumber:text(row.certificateNumber,64)}})
}

/** @param {unknown} raw - authenticated, identity-checked Client payload. @returns {{ unitBodies: string[], unitPending:number, coverage:boolean, closed:boolean, expired:boolean, cleanupFailed:boolean, fileGrantId:string|null, facts:import('./import-rules.js').ImportFacts }} parsed private observations. */
export function decodeImportEvidence(raw) {
  if (!record(raw) || !Array.isArray(raw.unitBodies) || raw.unitBodies.length > 64 || !record(raw.facts)) throw new Error('import-evidence-invalid')
  const data = raw.facts
  /** @type {import('./import-rules.js').ImportFacts} */
  const facts = {requestCount:count(data.requestCount,1000),pending:count(data.pending,1000),interference:flag(data.interference)}
  if (data.response !== undefined) {
    const r=data.response;if(!record(r))throw new Error('import-evidence-response')
    facts.response={requestId:text(r.requestId,200),responseRequestId:text(r.responseRequestId,200),method:text(r.method,20),url:text(r.url,4000),status:count(r.status,599),complete:flag(r.complete),body:text(r.body,BODY_LIMIT)}
  }
  if(data.tables!==undefined){const t=data.tables;if(!record(t))throw new Error('import-evidence-tables');facts.tables={fresh:flag(t.fresh),complete:flag(t.complete),accepted:people(t.accepted),rejected:people(t.rejected)}}
  if(data.summary!==undefined){const s=data.summary;if(!record(s))throw new Error('import-evidence-summary');facts.summary={total:count(s.total,10_000),success:count(s.success,10_000),failure:count(s.failure,10_000)}}
  return {unitBodies:raw.unitBodies.map(body=>text(body,BODY_LIMIT)),unitPending:count(raw.unitPending,1000),coverage:flag(raw.coverage),closed:flag(raw.closed),expired:flag(raw.expired),cleanupFailed:flag(raw.cleanupFailed),fileGrantId:raw.fileGrantId===null?null:text(raw.fileGrantId,200),facts}
}
