import type {materializeFile} from './file.ts'
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
      let used=0,count=0,truncated=false,exhausted=false;
      const reserve=()=>{if(count>=MAX_NODES||MAX_CHARS-used<60){truncated=true;exhausted=true;return false}count++;used+=60;return true};
      const take=(element:Element)=>{
        if(!reserve())return undefined;
        const raw=textOf(element),remaining=MAX_CHARS-used;
        let text=raw.slice(0,remaining);
        // A text boundary must not split a UTF-16 surrogate pair.
        if(text.length<raw.length&&/[\uD800-\uDBFF]$/.test(text))text=text.slice(0,-1);
        used+=text.length;const clipped=text.length<raw.length;
        if(clipped)truncated=true;
        return {elementRef:mintRef(element),text,truncated:clipped};
      };
      // Region text is the requested primary observation; structure uses the remainder.
      const region=options.view==='region'?take(root):undefined;
      const tableSelector='table,[role="table"],[role="grid"]',rowSelector='tr,[role="row"]';
      const cellSelector='th,td,[role="cell"],[role="gridcell"],[role="columnheader"],[role="rowheader"]';
      const tables:Record<string,unknown>[]=[];
      const candidates=[...(root.matches(tableSelector)?[root]:[]),...root.querySelectorAll(tableSelector)].filter(visible);
      for(const table of candidates){
        if(!reserve())break;
        const tableRef=mintRef(table),columns:Record<string,unknown>[]=[],rows:Record<string,unknown>[]=[],diagnostics:string[]=[];
        const allRows=Array.from(table.querySelectorAll(rowSelector)).filter(row=>row.closest(tableSelector)===table);
        const occupied=new Map<number,number>();let previousRow=-1,tableTruncated=false;
        const number=(element:Element,name:string,fallback:number,zero=false)=>{
          const raw=element.getAttribute(name);if(raw===null)return fallback;
          if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<(zero?0:1)||Number(raw)>10000){diagnostics.push('invalid '+name);return null}
          return Number(raw);
        };
        for(let ordinal=0;ordinal<allRows.length;ordinal++){
          const row=allRows[ordinal],native=table.tagName==='TABLE',declared=native?ordinal+1:number(row,'aria-rowindex',previousRow+2);
          if(declared===null||declared-1<=previousRow){diagnostics.push('ambiguous row index');continue}
          const rowIndex=declared-1;previousRow=rowIndex;let nextColumn=0;
          const cells:Record<string,unknown>[]=[],sourceCells=Array.from(row.querySelectorAll(cellSelector)).filter(c=>c.closest(rowSelector)===row&&c.closest(tableSelector)===table);
          for(const cell of sourceCells){
            const rowSpanValue=number(cell,native?'rowspan':'aria-rowspan',1,native),colSpan=number(cell,native?'colspan':'aria-colspan',1);
            if(rowSpanValue===null||colSpan===null){diagnostics.push('ambiguous cell span');continue}
            const groupEnd=native?allRows.findIndex((r,i)=>i>ordinal&&r.parentElement!==row.parentElement):-1;
            const remainingGroup=(groupEnd<0?allRows.length:groupEnd)-ordinal;
            const rowSpan=native?Math.min(rowSpanValue===0?remainingGroup:rowSpanValue,remainingGroup):rowSpanValue;
            while((occupied.get(nextColumn)??-1)>=rowIndex)nextColumn++;
            const explicit=native?nextColumn+1:number(cell,'aria-colindex',nextColumn+1);
            let column=explicit===null?null:explicit-1;
            if(column!==null&&(column<nextColumn||Array.from({length:colSpan},(_,i)=>column!+i).some(c=>(occupied.get(c)??-1)>=rowIndex))){diagnostics.push('overlapping cell coordinates');column=null}
            if(column!==null){for(let c=column;c<column+colSpan;c++)occupied.set(c,rowIndex+rowSpan-1);nextColumn=column+colSpan}
            if(!visible(row)||!visible(cell))continue;
            const value=take(cell);if(!value){tableTruncated=true;break}
            tableTruncated ||= value.truncated;
            const entry={row:rowIndex,column,rowSpan,colSpan,...value};cells.push(entry);
            if(cell.matches('th,[role="columnheader"]'))columns.push(entry);
          }
          if(cells.length)rows.push({index:rowIndex,cells});
          if(exhausted)break;
        }
        const layoutComplete=diagnostics.length===0;
        tables.push({elementRef:tableRef,columns,rows,layoutComplete,diagnostics:[...new Set(diagnostics)],truncated:tableTruncated,domComplete:!tableTruncated&&!exhausted&&layoutComplete,datasetComplete:false});
        if(exhausted)break;
      }
      const layoutComplete=tables.every(table=>table.layoutComplete===true);
      return {ok:true,value:{documentToken:documentToken(),url:safeUrl(location.href),title:(document.title||'').slice(0,300),view:options.view,tables,...(region?{region}:{}),truncated,layoutComplete,domComplete:!truncated&&layoutComplete,datasetComplete:false}};
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
export function action(runtime: PageRuntime, input: PageActionInput, policy: (runtime:PageRuntime,scope:PagePolicy|undefined,element:Element,action:string)=>PageResult|undefined,materialize:typeof materializeFile) {
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
      return materialize(element,input.file,{mime:'application/octet-stream',digest:true,inputComposed:true,changeComposed:false,elementRef:input.elementRef,
        recheck:()=>documentToken()!==input.documentToken||elementOf(input.elementRef)!==element||!visible(element)||!operable(element)?{ok:false,error:{code:'stale_observation',message:'file target changed before dispatch'}}:undefined});
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
