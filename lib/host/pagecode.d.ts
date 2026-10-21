import type { PageActionInput, PageWaitInput } from './page/types.ts';
/** @returns Shared runtime initialization for fixed program consumers. */
export declare function prelude(): string;
/** @returns Identity program for the current document. */
export declare function identityProgram(): string;
/** @param maxChars - text budget. @param maxNodes - node budget. @returns Bounded observation program. */
export declare function observeProgram(maxChars: number, maxNodes: number): string;
/** @param query - validated locator. @param limit - maximum returned matches. @returns Fixed locator program. */
export declare function findProgram(query: {
    by: string;
    value: string;
    name?: string;
}, limit: number): string;
/** @param input - validated page action and reference. @returns One fixed action without retries. */
export declare function actProgram(input: PageActionInput): string;
/** @param input - validated document condition and relative timeout. @returns Fixed DOM wait program. */
export declare function waitProgram(input: PageWaitInput): string;
/**
 * Redact a URL for display and logging.
 *
 * Query parameter values whose names look sensitive are replaced; user
 * information never survives.
 * @param {string} raw - URL as reported by the page.
 * @returns {string} redacted URL, or a placeholder when it cannot be parsed.
 */
export declare function redactUrl(raw: string): string;
/**
 * Whether a URL query carries a value this plugin must not echo.
 * @param {string} raw - URL.
 * @returns {boolean} true when at least one sensitive parameter is present.
 */
export declare function hasSensitiveQuery(raw: string): boolean;
