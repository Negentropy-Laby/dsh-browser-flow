/**
 * Deployment-varying settings, validated at plugin load.
 *
 * Values come from the profile's `cordis.patch.yml` (see the package's own
 * patch for the shipped defaults). An invalid value fails the load with the
 * field name and the accepted range instead of silently falling back, because
 * every field here changes a security or liveness property of the channel.
 *
 * The schema is a Standard Schema (`~standard.validate`) so it needs no
 * runtime dependency; Cordis validates it before `apply` runs.
 *
 * @module @negentropy/dsh-browser-flow/config
 */
import { isAbsolute } from 'node:path'

/**
 * @typedef {object} BrowserFlowConfig
 * @property {number} commandBudgetMs - end-to-end deadline for one command, queueing included.
 * @property {number} observeMaxChars - character budget of one observation.
 * @property {number} observeMaxNodes - element budget of one observation.
 * @property {number} findMaxMatches - matches per find.
 * @property {number} waitMaxMs - longest accepted wait.
 * @property {number} queueLimit - pending operations per page.
 * @property {number} pollWaitMs - longest single panel poll.
 * @property {number} connectionIdleMs - idle window before a panel's leases expire.
 * @property {number} importWindowMs - relative lifetime for one passive import collection.
 * @property {string} localTasksDir - absolute local task directory; empty uses profileContext.home/browser-flow/tasks.
 * @property {string} importEvidenceDir - legacy configuration accepted for compatibility; new evidence is always under the bound task.
 */

/** Defaults applied when a field is omitted. @type {Readonly<BrowserFlowConfig>} */
export const DEFAULTS = Object.freeze({
  commandBudgetMs: 15_000,
  observeMaxChars: 8_000,
  observeMaxNodes: 400,
  findMaxMatches: 20,
  waitMaxMs: 10_000,
  queueLimit: 4,
  pollWaitMs: 20_000,
  connectionIdleMs: 60_000,
  importWindowMs: 25_000,
  importEvidenceDir: '',
  localTasksDir: '',
})

/** Accepted range of every numeric field. @type {Readonly<Record<Exclude<keyof BrowserFlowConfig,'importEvidenceDir'|'localTasksDir'>, readonly [number, number]>>} */
const RANGES = Object.freeze({
  commandBudgetMs: [500, 300_000],
  observeMaxChars: [200, 100_000],
  observeMaxNodes: [10, 5_000],
  findMaxMatches: [1, 200],
  waitMaxMs: [100, 120_000],
  queueLimit: [1, 32],
  pollWaitMs: [1_000, 60_000],
  connectionIdleMs: [5_000, 600_000],
  importWindowMs: [100,900_000],
})

/**
 * Validate and normalize one config object.
 * @param {unknown} input - raw plugin config.
 * @returns {Readonly<BrowserFlowConfig>} validated config with defaults applied.
 * @throws {Error} naming the offending field and the accepted range.
 */
export function resolveConfig(input) {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new Error('browser-flow: config must be an object')
  }
  /** @type {Record<string, unknown>} */
  const raw = input === undefined || input === null ? {} : { ...input }
  const unknown = Object.keys(raw).filter(key => !(key in RANGES) && !['importEvidenceDir','localTasksDir'].includes(key))
  if (unknown.length > 0) throw new Error(`browser-flow: unknown config field(s): ${unknown.join(', ')}`)
  /** @type {Record<string, number>} */
  const resolved = {}
  for (const [key, range] of Object.entries(RANGES)) {
    const [min, max] = range
    const value = raw[key] ?? /** @type {Record<string, number|string>} */ (DEFAULTS)[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`browser-flow: config ${key} must be an integer from ${min} through ${max}, received ${String(value)}`)
    }
    resolved[key] = value
  }
  if (resolved.waitMaxMs > resolved.commandBudgetMs) {
    throw new Error('browser-flow: config waitMaxMs must not exceed commandBudgetMs')
  }
  if (resolved.pollWaitMs > resolved.connectionIdleMs) {
    throw new Error('browser-flow: config pollWaitMs must not exceed connectionIdleMs')
  }
  const paths = { importEvidenceDir: raw.importEvidenceDir ?? '', localTasksDir: raw.localTasksDir ?? '' }
  for (const [key, value] of Object.entries(paths)) {
    if (typeof value !== 'string' || value.length > 4096
    || (value !== '' && (!isAbsolute(value) || /^(?:\\\\|\/\/)|[\x00-\x1f]/.test(value)
      || (process.platform === 'win32' && (!/^[a-z]:[\\/]/i.test(value) || value.slice(2).includes(':')))))) {
      throw new Error(`browser-flow: ${key} must be a local absolute path or empty`)
    }
  }
  return Object.freeze({ .../** @type {Omit<BrowserFlowConfig,'importEvidenceDir'|'localTasksDir'>} */ (resolved), .../** @type {{importEvidenceDir:string,localTasksDir:string}} */ (paths) })
}

/**
 * Standard Schema wrapper so Cordis validates the config before `apply`.
 *
 * `~standard.validate` returns either the value or a list of issues; Cordis
 * throws a `ValidationError` carrying the issue messages.
 */
export const Config = Object.freeze({
  '~standard': Object.freeze({
    version: 1,
    vendor: 'negentropy',
    /**
     * Validate one raw config value.
     * @param {unknown} value - raw config.
     * @returns {{ value: unknown } | { issues: { message: string }[] }} result.
     */
    validate(value) {
      try {
        return { value: resolveConfig(value) }
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }
      }
    },
  }),
})
