export type BrowserFlowConfig = {
    commandBudgetMs: number;
    observeMaxChars: number;
    observeMaxNodes: number;
    findMaxMatches: number;
    waitMaxMs: number;
    queueLimit: number;
    pollWaitMs: number;
    connectionIdleMs: number;
    importWindowMs: number;
    graphMaxWorkers: number;
    graphIdleMs: number;
    graphRequestTimeoutMs: number;
    graphMaxFrameBytes: number;
    /** Maximum canonical UTF-8 bytes and offset ceiling for every task detail, including Go graph transfer. */
    graphMaxDetailBytes: number;
    graphStderrBytes: number;
    graphTerminateGraceMs: number;
    graphColdRounds: number;
    graphMinGroup: number;
    localTasksDir: string;
    importEvidenceDir: string;
};

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

/** Defaults applied when a field is omitted. @type {Readonly<BrowserFlowConfig>} */
export const DEFAULTS: Readonly<BrowserFlowConfig> = Object.freeze({
  graphMaxWorkers: 4,
  graphIdleMs: 60000,
  graphRequestTimeoutMs: 5000,
  graphMaxFrameBytes: 8388608,
  graphMaxDetailBytes: 33554432,
  graphStderrBytes: 16384,
  graphTerminateGraceMs: 1000,
  graphColdRounds: 6,
  graphMinGroup: 2,
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
const RANGES: Readonly<Record<Exclude<keyof BrowserFlowConfig, 'importEvidenceDir' | 'localTasksDir'>, readonly [
    number,
    number
]>> = Object.freeze({
  graphMaxWorkers: [1, 32],
  graphIdleMs: [1000, 600000],
  graphRequestTimeoutMs: [100, 300000],
  graphMaxFrameBytes: [65536, 33554432],
  graphMaxDetailBytes: [65536, 268435456],
  graphStderrBytes: [1024, 1048576],
  graphTerminateGraceMs: [1, 60000],
  graphColdRounds: [1, 10000],
  graphMinGroup: [2, 10000],
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
export function resolveConfig(input: unknown) : Readonly<BrowserFlowConfig> {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new Error('browser-flow: config must be an object')
  }

  const raw: Record<string, unknown> = input === undefined || input === null ? {} : { ...input }
  const unknown = Object.keys(raw).filter(key => !(key in RANGES) && !['importEvidenceDir','localTasksDir'].includes(key))
  if (unknown.length > 0) throw new Error(`browser-flow: unknown config field(s): ${unknown.join(', ')}`)

  const resolved: Record<string, number> = {}
  for (const [key, range] of Object.entries(RANGES)) {
    const [min, max] = range
    const value = raw[key] ??  (DEFAULTS as Record<string, number | string>)[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`browser-flow: config ${key} must be an integer from ${min} through ${max}, received ${String(value)}`)
    }
    resolved[key] = value
  }
  if(resolved.graphMaxDetailBytes<resolved.graphMaxFrameBytes)throw new Error('browser-flow: graphMaxDetailBytes must not be smaller than graphMaxFrameBytes')
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
  return Object.freeze({ ... (resolved as Omit<BrowserFlowConfig, 'importEvidenceDir' | 'localTasksDir'>), ... (paths as {
    importEvidenceDir: string;
    localTasksDir: string;
}) })
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
    validate(value: unknown) : {
    value: unknown;
} | {
    issues: {
        message: string;
    }[];
} {
      try {
        return { value: resolveConfig(value) }
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }
      }
    },
  }),
})
