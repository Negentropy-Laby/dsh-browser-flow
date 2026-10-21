import type {PageRegistry} from './types.ts'
/** Shared DOM helpers; this factory has no ambient module dependencies. */
export function createRuntime(){

  const REGISTRY = "__dshBrowserFlow";
  const SENSITIVE_QUERY = ["token","access_token","id_token","refresh_token","code","key","api_key","secret","client_secret","password","passwd","pwd","session","sessionid","auth","authorization","sig","signature","credential","otp"];
  const registry = (): PageRegistry => {
    const existing = Object.getOwnPropertyDescriptor(globalThis, REGISTRY);
    if (existing && existing.value && typeof existing.value === 'object') return existing.value as PageRegistry;
    // Not frozen: the counter and the reference map are the mutable part of the
    // document registry. The property itself is non-enumerable and non-writable
    // so page code cannot replace it wholesale.
    const created: PageRegistry = { documentToken: mintToken(), refs: new Map(), nextRef: 0 };
    Object.defineProperty(globalThis, REGISTRY, { value: created, configurable: true, enumerable: false, writable: false });
    return created;
  };
  const mintToken = () => {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  };
  const mintRef = (element: Element) => {
    const state = registry();
    const ref = 'el-' + (state.nextRef++).toString(36);
    state.refs.set(ref, element);
    return ref;
  };
  const elementOf = (ref: string) => {
    const element = registry().refs.get(ref);
    return element && element.isConnected ? element : undefined;
  };
  const visible = (element: Element | null | undefined): element is Element => {
    if (!element || !element.isConnected) return false;
    const style = (globalThis as Partial<Pick<Window,'getComputedStyle'>>).getComputedStyle ? getComputedStyle(element) : undefined;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const operable = (element: Element | null | undefined) => {
    if (!visible(element)) return false;
    if ('disabled' in element && element.disabled === true) return false;
    if (element.getAttribute && element.getAttribute('aria-disabled') === 'true') return false;
    if (element.closest && element.closest('[inert]')) return false;
    return true;
  };
  const isPasswordField = (element: Element) => element instanceof HTMLInputElement && element.type === 'password';
  const isHiddenField = (element: Element) => element instanceof HTMLInputElement && element.type === 'hidden';
  const tagOf = (element: Element) => (element.tagName || '').toLowerCase();
  const roleOf = (element: Element) => element.getAttribute('role') || '';
  const labelOf = (element: Element) => {
    const direct = element.getAttribute('aria-label');
    if (direct) return direct;
    const labelled = element.getAttribute('aria-labelledby');
    if (labelled) {
      const parts = labelled.split(/\s+/).map(id => {
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
  const textOf = (element: Element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return '';
    if (element instanceof HTMLSelectElement) {
      const option = element.options[element.selectedIndex];
      return option ? (option.textContent || '').trim() : '';
    }
    return ((element as HTMLElement).innerText !== undefined ? (element as HTMLElement).innerText : element.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const valueOf = (element: Element) => {
    if (isPasswordField(element) || isHiddenField(element)) return { redacted: true };
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return { value: element.value };
    if (element instanceof HTMLSelectElement) return { value: element.value, selected: element.selectedIndex };
    if ((element as HTMLElement).isContentEditable) return { value: ((element as HTMLElement).innerText || '').trim() };
    return {};
  };
  const stateOf = (element: Element) => {
    if (element instanceof HTMLInputElement) {
      return element.type === 'checkbox' || element.type === 'radio'
        ? { checked: element.checked, ...(isPasswordField(element) || isHiddenField(element) ? {} : { value: element.value }) }
        : isPasswordField(element) || isHiddenField(element) ? {} : { value: element.value };
    }
    if (element instanceof HTMLTextAreaElement) return isPasswordField(element) ? {} : { value: element.value };
    if (element instanceof HTMLSelectElement) return { value: element.value, selected: element.selectedIndex };
    if ((element as HTMLElement).isContentEditable) return { value: ((element as HTMLElement).innerText || '').trim() };
    return {};
  };
  const describe = (element: Element, ref: string) => ({
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
  const safeUrl = (value: string) => {
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

return {REGISTRY,SENSITIVE_QUERY,registry,mintToken,mintRef,elementOf,visible,operable,isPasswordField,isHiddenField,tagOf,roleOf,labelOf,textOf,valueOf,stateOf,describe,safeUrl,documentToken};
}
export type PageRuntime=ReturnType<typeof createRuntime>
