/**
 * Runtime prelude shared by every program: registry access, reference minting,
 * visibility and operability tests, and the sensitive-value policy.
 *
 * It is a function body so each program stays one expression; the prelude never
 * reads or writes anything outside the registry property and the page's own DOM.
 * @returns {string} prelude source.
 */
export function prelude(): string;
/**
 * Program that reports page identity without touching content.
 *
 * The token is minted once per document; the panel uses it to notice a reload
 * or a replaced document.
 * @returns {string} self-contained program source.
 */
export function identityProgram(): string;
/**
 * Program that collects a bounded text observation of the document.
 * @param {number} maxChars - character budget for the returned text.
 * @param {number} maxNodes - node budget for described elements.
 * @returns {string} self-contained program source.
 */
export function observeProgram(maxChars: number, maxNodes: number): string;
/**
 * Program that locates elements matching a bounded query.
 *
 * Matching is over visible text, an explicit attribute, or the ARIA role, and
 * never over generated selectors: the caller cannot express arbitrary CSS.
 * Text queries return the deepest visible matches; ancestors do not consume
 * the match limit or make a single target ambiguous.
 * Ambiguity is determined before truncation, including when the limit is one.
 * @param {{ by: 'text' | 'attr' | 'role', value: string, name?: string }} query - query.
 * @param {number} limit - maximum matches.
 * @returns {string} self-contained program source.
 */
export function findProgram(query: {
    by: "text" | "attr" | "role";
    value: string;
    name?: string;
}, limit: number): string;
/**
 * Program that dispatches one of the four supported actions on a referenced element.
 *
 * Every action re-checks the document token, the reference, the match, the
 * visibility and the operability before it touches the page. There is no
 * retry inside the page and no fallback to another element.
 * @param {object} input - action inputs.
 * @param {string} input.documentToken - token the reference was minted under.
 * @param {string} input.elementRef - element reference.
 * @param {'click' | 'type' | 'select' | 'check'} input.action - action.
 * @param {string} [input.value] - replacement text or option value.
 * @param {boolean} [input.checked] - explicit checked state.
 * @param {object} [input.pagePolicy] - trusted task site policy.
 * @param {object} [input.importScope] - scoped import restrictions; absent uses any current document restriction.
 * @returns {string} self-contained program source.
 */
export function actProgram(input: {
    documentToken: string;
    elementRef: string;
    action: "click" | "type" | "select" | "check";
    value?: string | undefined;
    checked?: boolean | undefined;
    pagePolicy?: object | undefined;
    importScope?: object | undefined;
}): string;
/**
 * Program that waits for one listed DOM condition and then returns.
 *
 * The wait is bounded in-page and re-checks cancellation through the caller's
 * deadline: the client stops reading the result when the command window closes,
 * and the page stops waiting on its own timeout.
 * @param {object} input - wait inputs.
 * @param {'present' | 'absent' | 'text'} input.condition - condition.
 * @param {{ documentToken: string, elementRef: string }} input.target - target element.
 * @param {string} [input.text] - required text for the `text` condition.
 * @param {number} input.timeoutMs - page-side bound.
 * @returns {string} self-contained program source.
 */
export function waitProgram(input: {
    condition: "present" | "absent" | "text";
    target: {
        documentToken: string;
        elementRef: string;
    };
    text?: string | undefined;
    timeoutMs: number;
}): string;
/**
 * Redact a URL for display and logging.
 *
 * Query parameter values whose names look sensitive are replaced; user
 * information never survives.
 * @param {string} raw - URL as reported by the page.
 * @returns {string} redacted URL, or a placeholder when it cannot be parsed.
 */
export function redactUrl(raw: string): string;
/**
 * Whether a URL query carries a value this plugin must not echo.
 * @param {string} raw - URL.
 * @returns {boolean} true when at least one sensitive parameter is present.
 */
export function hasSensitiveQuery(raw: string): boolean;
