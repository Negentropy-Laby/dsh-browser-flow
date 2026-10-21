/**
 * Validate and normalize one config object.
 * @param {unknown} input - raw plugin config.
 * @returns {Readonly<BrowserFlowConfig>} validated config with defaults applied.
 * @throws {Error} naming the offending field and the accepted range.
 */
export function resolveConfig(input: unknown): Readonly<BrowserFlowConfig>;
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
 * @property {number} graphMaxWorkers - graph worker deployment setting.
 * @property {number} graphIdleMs - graph worker deployment setting.
 * @property {number} graphRequestTimeoutMs - graph worker deployment setting.
 * @property {number} graphMaxFrameBytes - graph worker deployment setting.
 * @property {number} graphStderrBytes - graph worker deployment setting.
 * @property {number} graphTerminateGraceMs - graph worker deployment setting.
 * @property {number} graphColdRounds - graph worker deployment setting.
 * @property {number} graphMinGroup - graph worker deployment setting.
 * @property {string} localTasksDir - absolute local task directory; empty uses profileContext.home/browser-flow/tasks.
 * @property {string} importEvidenceDir - legacy configuration accepted for compatibility; new evidence is always under the bound task.
 */
/** Defaults applied when a field is omitted. @type {Readonly<BrowserFlowConfig>} */
export const DEFAULTS: Readonly<BrowserFlowConfig>;
/**
 * Standard Schema wrapper so Cordis validates the config before `apply`.
 *
 * `~standard.validate` returns either the value or a list of issues; Cordis
 * throws a `ValidationError` carrying the issue messages.
 */
export const Config: Readonly<{
    '~standard': Readonly<{
        version: 1;
        vendor: "negentropy";
        /**
         * Validate one raw config value.
         * @param {unknown} value - raw config.
         * @returns {{ value: unknown } | { issues: { message: string }[] }} result.
         */
        validate(value: unknown): {
            value: unknown;
        } | {
            issues: {
                message: string;
            }[];
        };
    }>;
}>;
export type BrowserFlowConfig = {
    /**
     * - end-to-end deadline for one command, queueing included.
     */
    commandBudgetMs: number;
    /**
     * - character budget of one observation.
     */
    observeMaxChars: number;
    /**
     * - element budget of one observation.
     */
    observeMaxNodes: number;
    /**
     * - matches per find.
     */
    findMaxMatches: number;
    /**
     * - longest accepted wait.
     */
    waitMaxMs: number;
    /**
     * - pending operations per page.
     */
    queueLimit: number;
    /**
     * - longest single panel poll.
     */
    pollWaitMs: number;
    /**
     * - idle window before a panel's leases expire.
     */
    connectionIdleMs: number;
    /**
     * - relative lifetime for one passive import collection.
     */
    importWindowMs: number;
    /**
     * - graph worker deployment setting.
     */
    graphMaxWorkers: number;
    /**
     * - graph worker deployment setting.
     */
    graphIdleMs: number;
    /**
     * - graph worker deployment setting.
     */
    graphRequestTimeoutMs: number;
    /**
     * - graph worker deployment setting.
     */
    graphMaxFrameBytes: number;
    /**
     * - graph worker deployment setting.
     */
    graphStderrBytes: number;
    /**
     * - graph worker deployment setting.
     */
    graphTerminateGraceMs: number;
    /**
     * - graph worker deployment setting.
     */
    graphColdRounds: number;
    /**
     * - graph worker deployment setting.
     */
    graphMinGroup: number;
    /**
     * - absolute local task directory; empty uses profileContext.home/browser-flow/tasks.
     */
    localTasksDir: string;
    /**
     * - legacy configuration accepted for compatibility; new evidence is always under the bound task.
     */
    importEvidenceDir: string;
};
