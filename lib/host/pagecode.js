/** Fixed program builders serialize only JSON arguments into compiled TypeScript functions. */
import { PAGE_RUNTIME_SOURCE, PAGE_IDENTITY_SOURCE, PAGE_OBSERVE_SOURCE, PAGE_FIND_SOURCE, PAGE_ACTION_SOURCE, PAGE_WAIT_SOURCE, PAGE_POLICY_SOURCE } from '#browser-flow/page-programs';
const SENSITIVE_QUERY_NAMES = Object.freeze([
    'token', 'access_token', 'id_token', 'refresh_token', 'code', 'key', 'api_key',
    'secret', 'client_secret', 'password', 'passwd', 'pwd', 'session', 'sessionid',
    'auth', 'authorization', 'sig', 'signature', 'credential', 'otp',
]);
/** @returns Shared runtime initialization for fixed program consumers. */
export function prelude() { return `const runtime=(${PAGE_RUNTIME_SOURCE})();const {REGISTRY,SENSITIVE_QUERY,registry,mintToken,mintRef,elementOf,visible,operable,isPasswordField,isHiddenField,tagOf,roleOf,labelOf,textOf,valueOf,stateOf,describe,safeUrl,documentToken}=runtime;`; }
/** @returns Identity program for the current document. */
export function identityProgram() { return `(function(){${prelude()}return (${PAGE_IDENTITY_SOURCE})(runtime);})()`; }
/** @param maxChars - text budget. @param maxNodes - node budget. @returns Bounded observation program. */
export function observeProgram(maxChars, maxNodes, options) { return `(function(){${prelude()}return (${PAGE_OBSERVE_SOURCE})(runtime,${JSON.stringify(maxChars)},${JSON.stringify(maxNodes)},${JSON.stringify(options ?? {})});})()`; }
/** @param query - validated locator. @param limit - maximum returned matches. @returns Fixed locator program. */
export function findProgram(query, limit) { return `(function(){${prelude()}return (${PAGE_FIND_SOURCE})(runtime,${JSON.stringify(query)},${JSON.stringify(limit)});})()`; }
/** @param input - validated page action and reference. @returns One fixed action without retries. */
export function actProgram(input) { return `(function(){${prelude()}return (${PAGE_ACTION_SOURCE})(runtime,${JSON.stringify(input)},(${PAGE_POLICY_SOURCE}));})()`; }
/** @param input - validated document condition and relative timeout. @returns Fixed DOM wait program. */
export function waitProgram(input) { return `(function(){${prelude()}return (${PAGE_WAIT_SOURCE})(runtime,${JSON.stringify(input)});})()`; }
/**
 * Redact a URL for display and logging.
 *
 * Query parameter values whose names look sensitive are replaced; user
 * information never survives.
 * @param {string} raw - URL as reported by the page.
 * @returns {string} redacted URL, or a placeholder when it cannot be parsed.
 */
export function redactUrl(raw) {
    try {
        const url = new URL(raw);
        for (const name of [...url.searchParams.keys()]) {
            if (SENSITIVE_QUERY_NAMES.includes(name.toLowerCase()))
                url.searchParams.set(name, '[redacted]');
        }
        url.username = '';
        url.password = '';
        return url.href;
    }
    catch {
        return '[invalid-url]';
    }
}
/**
 * Whether a URL query carries a value this plugin must not echo.
 * @param {string} raw - URL.
 * @returns {boolean} true when at least one sensitive parameter is present.
 */
export function hasSensitiveQuery(raw) {
    try {
        const url = new URL(raw);
        return [...url.searchParams.keys()].some(name => SENSITIVE_QUERY_NAMES.includes(name.toLowerCase()));
    }
    catch {
        return false;
    }
}
