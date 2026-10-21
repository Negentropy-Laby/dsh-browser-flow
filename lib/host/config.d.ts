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
