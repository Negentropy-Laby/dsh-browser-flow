import type {PageRuntime} from './runtime.ts'
import type {PageActionInput,PageWaitInput,PagePolicy,PageResult} from './types.ts'
/** Fixed page operation; parameters are serialized as JSON by the Host/Client builder. */
export function identity(runtime: PageRuntime) {
const {safeUrl,documentToken}=runtime;

    return {
      ok: true,
      value: {
        documentToken: documentToken(),
        url: safeUrl(location.href),
        title: (document.title || '').slice(0, 300),
        readyState: document.readyState,
      },
    };

}
/** Fixed page operation; parameters are serialized as JSON by the Host/Client builder. */
export function observe(runtime: PageRuntime, MAX_CHARS: number, MAX_NODES: number, options?:{view?:string;documentToken?:string;elementRef?:string}) {
const {registry,mintRef,visible,textOf,describe,safeUrl,documentToken}=runtime;



    // Rebuilding the map is what makes earlier element references stale. The
    // counter is deliberately not reset: reusing names would hand a caller's
    // old el-0 reference to whatever element happens to sort first this time, and the
    // document token is unchanged within a document, so that lookup would
    // succeed and act on the wrong element.
    let root:Element=document.body||document.documentElement;
    if(options?.elementRef){
      if(options.documentToken!==documentToken())return {ok:false,error:{code:'stale_observation',message:'observe the current document again'}};
      const found=runtime.elementOf(options.elementRef);
      if(!found||!visible(found))return {ok:false,error:{code:'stale_observation',message:'the observation region is no longer visible'}};
      root=found;
    }
    const state = registry();
    state.refs.clear();
    if(options?.view==='table'||options?.view==='region'){
      let used=0,count=0,truncated=false;
      const take=(element:Element)=>{const text=textOf(element).slice(0,MAX_CHARS);if(count>=MAX_NODES||used+text.length+60>MAX_CHARS){truncated=true;return undefined};count++;used+=text.length+60;return {elementRef:mintRef(element),text}};
      const tableSelector='table,[role="table"],[role="grid"]';
      const tables:Record<string,unknown>[]=[];
      const candidates=[...(root.matches(tableSelector)?[root]:[]),...root.querySelectorAll(tableSelector)].filter(visible);
      for(const table of candidates){
        const header:Record<string,unknown>[]=[],rows:Record<string,unknown>[]=[];
        if(count>=MAX_NODES||used+60>MAX_CHARS){truncated=true;break};count++;used+=60;const tableRef={elementRef:mintRef(table)};
        const allRows=Array.from(table.querySelectorAll('tr,[role="row"]')).filter(row=>row.closest(tableSelector)===table&&visible(row));
        for(const row of allRows){
          const cells:Record<string,unknown>[]=[];
          const sourceCells=Array.from(row.children).filter(c=>c.matches('th,td,[role="cell"],[role="gridcell"],[role="columnheader"],[role="rowheader"]')&&visible(c));
          for(let column=0;column<sourceCells.length;column++){
            const cell=sourceCells[column],value=take(cell);if(!value)break;
            const entry={column,...value};cells.push(entry);
            if(!rows.length&&(cell.matches('th,[role="columnheader"]')))header.push(entry);
          }
          if(cells.length)rows.push({index:rows.length,cells});
          if(truncated)break;
        }
        tables.push({elementRef:tableRef.elementRef,columns:header,rows,domComplete:!truncated,datasetComplete:false});
        if(truncated)break;
      }
      const region=options.view==='region'?take(root):undefined;
      return {ok:true,value:{documentToken:documentToken(),url:safeUrl(location.href),title:(document.title||'').slice(0,300),view:options.view,tables,...(region?{region}:{}),truncated,domComplete:!truncated,datasetComplete:false}};
    }
    const roots = [root];
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
    }).filter(Boolean).join('\n').slice(0, MAX_CHARS);
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

}
/** Fixed page operation; parameters are serialized as JSON by the Host/Client builder. */
export function find(runtime: PageRuntime, QUERY: {by:'text'|'role';value:string;name?:string}|{by:'attr';value:string;name:string}, LIMIT: number) {
const {mintRef,visible,tagOf,roleOf,textOf,describe,documentToken}=runtime;



    const candidates = new Set<Element>();
    const matchingAncestors = new Set<Element>();
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

}
/** Fixed page operation; parameters are serialized as JSON by the Host/Client builder. */
export function action(runtime: PageRuntime, input: PageActionInput, policy: (runtime:PageRuntime,scope:PagePolicy|undefined,element:Element,action:string)=>PageResult|undefined) {
const {elementOf,visible,operable,isPasswordField,documentToken}=runtime;

    if (documentToken() !== input.documentToken) {
      return { ok: false, error: { code: 'stale_observation', message: 'the document changed since the observation; observe again' } };
    }
    const element = elementOf(input.elementRef) as HTMLElement | undefined;
    if (element === undefined) {
      return { ok: false, error: { code: 'stale_observation', message: 'the referenced element is gone; observe again' } };
    }
    if (isPasswordField(element)) {
      return { ok: false, error: { code: 'unsupported', message: 'password fields are not operated by this plugin' } };
    }
    if (!visible(element)) {
      return { ok: false, error: { code: 'not_operable', message: 'the referenced element is not visible' } };
    }
    const refused=policy(runtime,input.pagePolicy??input.importScope,element,input.action);if(refused)return refused;
    if(input.action==='set_file'){
      if(!(element instanceof HTMLInputElement)||element.type!=='file'||!operable(element))return {ok:false,error:{code:'not_operable',message:'target must be a visible enabled file input'}};
      return (async()=>{
        const file=input.file,raw=atob(file.base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
        if(bytes.length!==file.bytes)return {ok:false,error:{code:'invalid_request',message:'file size mismatch'}};
        if(!globalThis.crypto?.subtle)return {ok:false,error:{code:'unsupported',message:'secure file digest is unavailable in this document'}};
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
        if(hash!==file.sha256)return {ok:false,error:{code:'invalid_request',message:'file digest mismatch'}};
        if(documentToken()!==input.documentToken||elementOf(input.elementRef)!==element||!visible(element)||!operable(element))return {ok:false,error:{code:'stale_observation',message:'file target changed before dispatch'}};
        const transfer=new DataTransfer();transfer.items.add(new File([bytes],file.name,{type:'application/octet-stream'}));
        element.files=transfer.files;
        element.dispatchEvent(new Event('input',{bubbles:true,composed:true}));element.dispatchEvent(new Event('change',{bubbles:true}));
        return {ok:true,value:{action:'set_file',fileGrantId:file.fileGrantId,dispatched:true,elementRef:input.elementRef}};
      })();
    }
    if (input.action === 'click') {
      if (!operable(element)) {
        return { ok: false, error: { code: 'not_operable', message: 'the referenced element is disabled or inert' } };
      }
      element.focus({ preventScroll: true });
      element.click();
      return { ok: true, value: { action: 'click', elementRef: input.elementRef, dispatched: true } };
    }
    if (input.action === 'type') {
      const isField = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
      if (!isField && !element.isContentEditable) {
        return { ok: false, error: { code: 'unsupported', message: 'this element does not accept text input' } };
      }
      if (!operable(element)) {
        return { ok: false, error: { code: 'not_operable', message: 'the referenced field is disabled or read-only' } };
      }
      if ('readOnly' in element && element.readOnly === true) {
        return { ok: false, error: { code: 'not_operable', message: 'the referenced field is read-only' } };
      }
      element.focus({ preventScroll: true });
      if (isField) {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value');
        if (setter && setter.set) setter.set.call(element, input.value);
        else element.value = input.value;
      } else {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = globalThis.getSelection();
        if (selection) { selection.removeAllRanges(); selection.addRange(range); }
        let inserted = false;
        if (typeof document.execCommand === 'function') {
          try { inserted = document.execCommand('insertText', false, input.value); } catch { inserted = false; }
        }
        if (!inserted) {
          element.textContent = input.value;
          const range2 = document.createRange();
          range2.selectNodeContents(element);
          const selection2 = globalThis.getSelection();
          if (selection2) { selection2.removeAllRanges(); selection2.addRange(range2); }
        }
      }
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: { action: 'type', elementRef: input.elementRef, dispatched: true, replaced: true, length: input.value.length } };
    }
    if (input.action === 'select') {
      if (!(element instanceof HTMLSelectElement)) {
        return { ok: false, error: { code: 'unsupported', message: 'the referenced element is not a select control' } };
      }
      if (!operable(element)) {
        return { ok: false, error: { code: 'not_operable', message: 'the select control is disabled' } };
      }
      const option = Array.from(element.options).find(candidate => candidate.value === input.value || (candidate.textContent || '').trim() === input.value);
      if (option === undefined) {
        return { ok: false, error: { code: 'not_found', message: 'no option matches the requested value' } };
      }
      element.focus({ preventScroll: true });
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      if (setter && setter.set) setter.set.call(element, option.value);
      else element.value = option.value;
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: { action: 'select', elementRef: input.elementRef, dispatched: true, selected: option.value } };
    }
    if (input.action === 'check') {
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
        if (setter && setter.set) setter.set.call(element, input.checked);
        else element.checked = input.checked;
      } else {
        element.setAttribute('aria-checked', input.checked ? 'true' : 'false');
      }
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: { action: 'check', elementRef: input.elementRef, dispatched: true, checked: input.checked } };
    }
    return { ok: false, error: { code: 'unsupported', message: 'unknown action' } };

}
/** Fixed page operation; parameters are serialized as JSON by the Host/Client builder. */
export function wait(runtime: PageRuntime, input: PageWaitInput) {
const {elementOf,visible,textOf,documentToken}=runtime;

    if (documentToken() !== input.target.documentToken) {
      return { ok: false, error: { code: 'stale_observation', message: 'the document changed since the observation; observe again' } };
    }
    const evaluate = () => {
      const element = elementOf(input.target.elementRef);
      if (input.condition === 'absent') return element === undefined || !visible(element);
      if (element === undefined) return false;
      if (input.condition === 'present') return visible(element);
      return textOf(element).includes((input.text??''));
    };
    if (evaluate()) {
      return { ok: true, value: { condition: input.condition, satisfied: true, waitedMs: 0 } };
    }
    const started = Date.now();
    return new Promise<PageResult>(resolve => {
      const finish = (satisfied: boolean, timedOut: boolean) => {
        observer.disconnect();
        clearTimeout(timer);
        resolve({ ok: true, value: { condition: input.condition, satisfied, timedOut, waitedMs: Date.now() - started } });
      };
      const observer = new MutationObserver(() => { if (evaluate()) finish(true, false); });
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      const timer = setTimeout(() => finish(evaluate(), true), Math.max(0, input.timeoutMs));
    });

}
