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
    graphStderrBytes: number;
    graphTerminateGraceMs: number;
    graphColdRounds: number;
    graphMinGroup: number;
    localTasksDir: string;
    importEvidenceDir: string;
};
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
export declare const DEFAULTS: Readonly<BrowserFlowConfig>;
/**
 * Validate and normalize one config object.
 * @param {unknown} input - raw plugin config.
 * @returns {Readonly<BrowserFlowConfig>} validated config with defaults applied.
 * @throws {Error} naming the offending field and the accepted range.
 */
export declare function resolveConfig(input: unknown): Readonly<BrowserFlowConfig>;
/**
 * Standard Schema wrapper so Cordis validates the config before `apply`.
 *
 * `~standard.validate` returns either the value or a list of issues; Cordis
 * throws a `ValidationError` carrying the issue messages.
 */
export declare const Config: Readonly<{
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
