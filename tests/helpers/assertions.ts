/** Assertions at fixture boundaries retain failures while narrowing their results. */
import assert from 'node:assert/strict'
/** Require a fixture value. @param value - optional fixture result. @returns The present value. */
export function present<T>(value:T|null|undefined):T {assert.ok(value!==null&&value!==undefined,'fixture value must exist');return value}
/** Require success. @param result - canonical result. @returns Its successful payload. */
export function expectOk<T>(result:{ok:true;value:T}|{ok:false;error:object}):T {assert.equal(result.ok,true,JSON.stringify(result));assert.ok(result.ok);return result.value}
/** Require refusal. @param result - canonical result. @returns Its diagnostic. */
export function expectFailure(result:{ok:true;value:unknown}|{ok:false;error:{code:string;message:string}}) {assert.equal(result.ok,false,JSON.stringify(result));assert.ok(!result.ok);return result.error}
/** Check a dynamic object. @param value - untrusted fixture result. @returns Its record fields. */
export function expectRecord(value:unknown):Record<string,unknown> {assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value),'fixture JSON must be an object');return value as Record<string,unknown>}
/** Check a dynamic array. @param value - untrusted fixture result. @returns Its members. */
export function expectList(value:unknown):unknown[] {assert.ok(Array.isArray(value),'fixture JSON must be an array');return value}
/** Check dynamic text. @param value - untrusted fixture result. @returns The text. */
export function expectString(value:unknown):string {assert.equal(typeof value,'string','fixture JSON must be text');assert.ok(typeof value==='string');return value}
/** Check a dynamic sequence. @param value - untrusted fixture result. @returns The text or array. */
export function expectSized(value:unknown):string|unknown[] {assert.ok(typeof value==='string'||Array.isArray(value),'fixture value must have a sequence length');return value}
/** Check a dynamic number. @param value - untrusted fixture result. @returns The number. */
export function expectNumber(value:unknown):number {assert.equal(typeof value,'number','fixture JSON must be numeric');assert.ok(typeof value==='number');return value}
