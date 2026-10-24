/** Shared dependency-free JSON object shape guard; arrays and null are excluded. */
export function isRecord(value:unknown):value is Record<string,unknown> {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)
}
