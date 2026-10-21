/**
 * The fixed page-side programs this plugin executes inside the user's webview.
 *
 * There is no general script-execution tool: every page interaction runs one
 * of the closures below through `executeJavaScript`. Parameters are embedded as
 * JSON literals (never concatenated as source), and each program returns a
 * JSON-serializable value.
 *
 * Page-side state is one non-enumerable registry property holding the current
 * document token and the element references minted by the last observation.
 * References are therefore valid for exactly one observation: a later observe
 * rebuilds the registry, which is what makes a stale reference detectable
 * instead of silently pointing at whatever now occupies that position.
 *
 * @module @negentropy/dsh-browser-flow/pagecode
 */
import { importActionPolicy } from './import-page.js';
/** Name of the page-side registry property. */
const REGISTRY = '__dshBrowserFlow';
/** Query value names whose values are never echoed back to the model. */
const SENSITIVE_QUERY_NAMES = Object.freeze([
    'token', 'access_token', 'id_token', 'refresh_token', 'code', 'key', 'api_key',
    'secret', 'client_secret', 'password', 'passwd', 'pwd', 'session', 'sessionid',
    'auth', 'authorization', 'sig', 'signature', 'credential', 'otp',
]);
/**
 * Runtime prelude shared by every program: registry access, reference minting,
 * visibility and operability tests, and the sensitive-value policy.
 *
 * It is a function body so each program stays one expression; the prelude never
 * reads or writes anything outside the registry property and the page's own DOM.
 * @returns {string} prelude source.
 */
export function prelude() {
    return `
  const REGISTRY = ${JSON.stringify(REGISTRY)};
  const SENSITIVE_QUERY = ${JSON.stringify(SENSITIVE_QUERY_NAMES)};
  const registry = () => {
    const existing = Object.getOwnPropertyDescriptor(globalThis, REGISTRY);
    if (existing && existing.value && typeof existing.value === 'object') return existing.value;
    // Not frozen: the counter and the reference map are the mutable part of the
    // document registry. The property itself is non-enumerable and non-writable
    // so page code cannot replace it wholesale.
    const created = { documentToken: mintToken(), refs: new Map(), nextRef: 0 };
    Object.defineProperty(globalThis, REGISTRY, { value: created, configurable: true, enumerable: false, writable: false });
    return created;
  };
  const mintToken = () => {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  };
  const mintRef = (element) => {
    const state = registry();
    const ref = 'el-' + (state.nextRef++).toString(36);
    state.refs.set(ref, element);
    return ref;
  };
  const elementOf = (ref) => {
    const element = registry().refs.get(ref);
    return element && element.isConnected ? element : undefined;
  };
  const visible = (element) => {
    if (!element || !element.isConnected) return false;
    const style = globalThis.getComputedStyle ? getComputedStyle(element) : undefined;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const operable = (element) => {
    if (!visible(element)) return false;
    if (element.disabled === true) return false;
    if (element.getAttribute && element.getAttribute('aria-disabled') === 'true') return false;
    if (element.closest && element.closest('[inert]')) return false;
    return true;
  };
  const isPasswordField = (element) => element instanceof HTMLInputElement && element.type === 'password';
  const isHiddenField = (element) => element instanceof HTMLInputElement && element.type === 'hidden';
  const tagOf = (element) => (element.tagName || '').toLowerCase();
  const roleOf = (element) => element.getAttribute('role') || '';
  const labelOf = (element) => {
    const direct = element.getAttribute('aria-label');
    if (direct) return direct;
    const labelled = element.getAttribute('aria-labelledby');
    if (labelled) {
      const parts = labelled.split(/\\s+/).map(id => {
        const target = document.getElementById(id);
        return target ? (target.textContent || '').trim() : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      const labels = element.labels;
      if (labels && labels.length) return (labels[0].textContent || '').trim();
      return element.getAttribute('name') || '';
    }
    return '';
  };
  const textOf = (element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return '';
    if (element instanceof HTMLSelectElement) {
      const option = element.options[element.selectedIndex];
      return option ? (option.textContent || '').trim() : '';
    }
    return (element.innerText !== undefined ? element.innerText : element.textContent || '').replace(/\\s+/g, ' ').trim();
  };
  const valueOf = (element) => {
    if (isPasswordField(element) || isHiddenField(element)) return { redacted: true };
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return { value: element.value };
    if (element instanceof HTMLSelectElement) return { value: element.value, selected: element.selectedIndex };
    if (element.isContentEditable) return { value: (element.innerText || '').trim() };
    return {};
  };
  const stateOf = (element) => {
    if (element instanceof HTMLInputElement) {
      return element.type === 'checkbox' || element.type === 'radio'
        ? { checked: element.checked, ...(isPasswordField(element) || isHiddenField(element) ? {} : { value: element.value }) }
        : isPasswordField(element) || isHiddenField(element) ? {} : { value: element.value };
    }
    if (element instanceof HTMLTextAreaElement) return isPasswordField(element) ? {} : { value: element.value };
    if (element instanceof HTMLSelectElement) return { value: element.value, selected: element.selectedIndex };
    if (element.isContentEditable) return { value: (element.innerText || '').trim() };
    return {};
  };
  const describe = (element, ref) => ({
    elementRef: ref,
    tag: tagOf(element),
    role: roleOf(element),
    label: labelOf(element),
    text: textOf(element).slice(0, 500),
    ...valueOf(element),
    ...(element instanceof HTMLInputElement ? { type: element.type } : {}),
    ...(element instanceof HTMLAnchorElement ? { href: safeUrl(element.href) } : {}),
    visible: visible(element),
    operable: operable(element),
    rect: (() => { const r = element.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })(),
  });
  const safeUrl = (value) => {
    try {
      const url = new URL(value);
      for (const name of [...url.searchParams.keys()]) {
        if (SENSITIVE_QUERY.some(sensitive => name.toLowerCase() === sensitive)) url.searchParams.set(name, '[redacted]');
      }
      url.username = '';
      url.password = '';
      return url.href;
    } catch { return '[invalid-url]'; }
  };
  const documentToken = () => registry().documentToken;
  `;
}
/**
 * Program that reports page identity without touching content.
 *
 * The token is minted once per document; the panel uses it to notice a reload
 * or a replaced document.
 * @returns {string} self-contained program source.
 */
export function identityProgram() {
    return `(function () {${prelude()}
    return {
      ok: true,
      value: {
        documentToken: documentToken(),
        url: safeUrl(location.href),
        title: (document.title || '').slice(0, 300),
        readyState: document.readyState,
      },
    };
  })()`;
}
/**
 * Program that collects a bounded text observation of the document.
 * @param {number} maxChars - character budget for the returned text.
 * @param {number} maxNodes - node budget for described elements.
 * @returns {string} self-contained program source.
 */
export function observeProgram(maxChars, maxNodes) {
    return `(function () {${prelude()}
    const MAX_CHARS = ${JSON.stringify(maxChars)};
    const MAX_NODES = ${JSON.stringify(maxNodes)};
    // Rebuilding the map is what makes earlier element references stale. The
    // counter is deliberately not reset: reusing names would hand a caller's
    // old el-0 reference to whatever element happens to sort first this time, and the
    // document token is unchanged within a document, so that lookup would
    // succeed and act on the wrong element.
    const state = registry();
    state.refs.clear();
    const roots = [document.body || document.documentElement];
    const candidates = [];
    const interactive = 'a[href],button,input,select,textarea,[role],[contenteditable=""],[contenteditable="true"],[tabindex]';
    for (const root of roots) {
      if (!root) continue;
      for (const element of root.querySelectorAll('*')) {
        if (candidates.length >= MAX_NODES) break;
        if (element.closest('script,style,noscript,template')) continue;
        if (element === document.documentElement) continue;
        const hasText = (element.children.length === 0) && textOf(element).length > 0;
        const matches = element.matches(interactive);
        if (!hasText && !matches) continue;
        if (!visible(element)) continue;
        candidates.push(element);
      }
    }
    const nodes = [];
    let used = 0;
    let truncated = false;
    for (const element of candidates) {
      const ref = mintRef(element);
      const entry = describe(element, ref);
      const cost = (entry.text || '').length + (entry.label || '').length + 40;
      if (used + cost > MAX_CHARS) { truncated = true; break; }
      used += cost;
      nodes.push(entry);
    }
    const text = candidates.slice(0, nodes.length).map(element => {
      const entry = textOf(element);
      return entry ? entry : '';
    }).filter(Boolean).join('\\n').slice(0, MAX_CHARS);
    return {
      ok: true,
      value: {
        documentToken: documentToken(),
        url: safeUrl(location.href),
        title: (document.title || '').slice(0, 300),
        readyState: document.readyState,
        nodes,
        text,
        truncated,
      },
    };
  })()`;
}
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
export function findProgram(query, limit) {
    return `(function () {${prelude()}
    const QUERY = ${JSON.stringify(query)};
    const LIMIT = ${JSON.stringify(limit)};
    const state = registry();
    const candidates = new Set();
    const matchingAncestors = new Set();
    const matches = [];
    for (const element of document.querySelectorAll('*')) {
      if (QUERY.by !== 'text' && candidates.size >= Math.max(2, LIMIT)) break;
      if (element.closest('script,style,noscript,template')) continue;
      if (!visible(element)) continue;
      let hit = false;
      if (QUERY.by === 'text') {
        const text = textOf(element);
        hit = text.length > 0 && text.includes(QUERY.value);
      } else if (QUERY.by === 'attr') {
        hit = element.getAttribute(QUERY.name) === QUERY.value;
      } else {
        hit = roleOf(element) === QUERY.value || tagOf(element) === QUERY.value;
      }
      if (!hit) continue;
      candidates.add(element);
      if (QUERY.by === 'text') {
        for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
          matchingAncestors.add(ancestor);
        }
      }
    }
    const distinct = Array.from(candidates).filter(element => !matchingAncestors.has(element));
    for (const element of distinct) {
      if (matches.length >= LIMIT) break;
      const ref = mintRef(element);
      state.refs.set(ref, element);
      matches.push(describe(element, ref));
    }
    return {
      ok: true,
      value: {
        documentToken: documentToken(),
        matches,
        ambiguous: distinct.length > 1,
        limitReached: matches.length >= LIMIT,
      },
    };
  })()`;
}
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
export function actProgram(input) {
    return `(function () {${prelude()}
    const DOCUMENT_TOKEN = ${JSON.stringify(input.documentToken)};
    const ELEMENT_REF = ${JSON.stringify(input.elementRef)};
    const ACTION = ${JSON.stringify(input.action)};
    const VALUE = ${JSON.stringify(input.value ?? null)};
    const CHECKED = ${JSON.stringify(input.checked ?? null)};
    if (documentToken() !== DOCUMENT_TOKEN) {
      return { ok: false, error: { code: 'stale_observation', message: 'the document changed since the observation; observe again' } };
    }
    const element = elementOf(ELEMENT_REF);
    if (element === undefined) {
      return { ok: false, error: { code: 'stale_observation', message: 'the referenced element is gone; observe again' } };
    }
    if (isPasswordField(element)) {
      return { ok: false, error: { code: 'unsupported', message: 'password fields are not operated by this plugin' } };
    }
    if (!visible(element)) {
      return { ok: false, error: { code: 'not_operable', message: 'the referenced element is not visible' } };
    }
    ${importActionPolicy(input.pagePolicy ?? input.importScope)}
    if (ACTION === 'click') {
      if (!operable(element)) {
        return { ok: false, error: { code: 'not_operable', message: 'the referenced element is disabled or inert' } };
      }
      element.focus({ preventScroll: true });
      element.click();
      return { ok: true, value: { action: 'click', elementRef: ELEMENT_REF, dispatched: true } };
    }
    if (ACTION === 'type') {
      const isField = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
      if (!isField && !element.isContentEditable) {
        return { ok: false, error: { code: 'unsupported', message: 'this element does not accept text input' } };
      }
      if (!operable(element)) {
        return { ok: false, error: { code: 'not_operable', message: 'the referenced field is disabled or read-only' } };
      }
      if (element.readOnly === true) {
        return { ok: false, error: { code: 'not_operable', message: 'the referenced field is read-only' } };
      }
      element.focus({ preventScroll: true });
      if (isField) {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value');
        if (setter && setter.set) setter.set.call(element, VALUE);
        else element.value = VALUE;
      } else {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = globalThis.getSelection();
        if (selection) { selection.removeAllRanges(); selection.addRange(range); }
        let inserted = false;
        if (typeof document.execCommand === 'function') {
          try { inserted = document.execCommand('insertText', false, VALUE); } catch { inserted = false; }
        }
        if (!inserted) {
          element.textContent = VALUE;
          const range2 = document.createRange();
          range2.selectNodeContents(element);
          const selection2 = globalThis.getSelection();
          if (selection2) { selection2.removeAllRanges(); selection2.addRange(range2); }
        }
      }
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: { action: 'type', elementRef: ELEMENT_REF, dispatched: true, replaced: true, length: VALUE.length } };
    }
    if (ACTION === 'select') {
      if (!(element instanceof HTMLSelectElement)) {
        return { ok: false, error: { code: 'unsupported', message: 'the referenced element is not a select control' } };
      }
      if (!operable(element)) {
        return { ok: false, error: { code: 'not_operable', message: 'the select control is disabled' } };
      }
      const option = Array.from(element.options).find(candidate => candidate.value === VALUE || (candidate.textContent || '').trim() === VALUE);
      if (option === undefined) {
        return { ok: false, error: { code: 'not_found', message: 'no option matches the requested value' } };
      }
      element.focus({ preventScroll: true });
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      if (setter && setter.set) setter.set.call(element, option.value);
      else element.value = option.value;
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: { action: 'select', elementRef: ELEMENT_REF, dispatched: true, selected: option.value } };
    }
    if (ACTION === 'check') {
      const boxy = element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio');
      const aria = element.getAttribute('aria-checked');
      if (!boxy && aria === null) {
        return { ok: false, error: { code: 'unsupported', message: 'the referenced element has no checkable state' } };
      }
      if (!operable(element)) {
        return { ok: false, error: { code: 'not_operable', message: 'the referenced control is disabled' } };
      }
      element.focus({ preventScroll: true });
      if (boxy) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
        if (setter && setter.set) setter.set.call(element, CHECKED);
        else element.checked = CHECKED;
      } else {
        element.setAttribute('aria-checked', CHECKED ? 'true' : 'false');
      }
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: { action: 'check', elementRef: ELEMENT_REF, dispatched: true, checked: CHECKED } };
    }
    return { ok: false, error: { code: 'unsupported', message: 'unknown action' } };
  })()`;
}
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
export function waitProgram(input) {
    return `(function () {${prelude()}
    const DOCUMENT_TOKEN = ${JSON.stringify(input.target.documentToken)};
    const ELEMENT_REF = ${JSON.stringify(input.target.elementRef)};
    const CONDITION = ${JSON.stringify(input.condition)};
    const TEXT = ${JSON.stringify(input.text ?? '')};
    const TIMEOUT = ${JSON.stringify(input.timeoutMs)};
    if (documentToken() !== DOCUMENT_TOKEN) {
      return { ok: false, error: { code: 'stale_observation', message: 'the document changed since the observation; observe again' } };
    }
    const evaluate = () => {
      const element = elementOf(ELEMENT_REF);
      if (CONDITION === 'absent') return element === undefined || !visible(element);
      if (element === undefined) return false;
      if (CONDITION === 'present') return visible(element);
      return textOf(element).includes(TEXT);
    };
    if (evaluate()) {
      return { ok: true, value: { condition: CONDITION, satisfied: true, waitedMs: 0 } };
    }
    const started = Date.now();
    return new Promise(resolve => {
      const finish = (satisfied, timedOut) => {
        observer.disconnect();
        clearTimeout(timer);
        resolve({ ok: true, value: { condition: CONDITION, satisfied, timedOut, waitedMs: Date.now() - started } });
      };
      const observer = new MutationObserver(() => { if (evaluate()) finish(true, false); });
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      const timer = setTimeout(() => finish(evaluate(), true), Math.max(0, TIMEOUT));
    });
  })()`;
}
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
