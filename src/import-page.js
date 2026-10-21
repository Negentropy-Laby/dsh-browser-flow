/** Fixed passive network observation and one-file assignment; never initiates requests or chooses a business step. */
import { prelude } from './pagecode.js'
import { IMPORT_ORIGIN, IMPORT_PATHS, IMPORT_TABS, IMPORT_DATA, BODY_LIMIT } from './import-rules.js'

/** @param {object | undefined} scope - Host-owned import restriction, absent for ordinary control. @returns {string} action restriction inside the common page prelude. */
export function importActionPolicy(scope) {
  return String.raw`
    const importRestriction = ${JSON.stringify(scope ?? null)} || registry().importState?.scope;
    if (importRestriction) {
      if (location.origin !== ${JSON.stringify(IMPORT_ORIGIN)} || ACTION !== 'click') return {ok:false,error:{code:'not_operable',message:'the import scope permits only its named navigation actions'}};
      const control = element.closest('button,a,input,[role="button"],[role="tab"],.el-menu-item,.el-submenu__title') || element;
      const clean = value => String(value || '').replace(/\s/g,'');
      const descriptions = [textOf(control), control.getAttribute('aria-label'), control.getAttribute('title'), control.value].filter(Boolean).map(clean);
      const label = clean(textOf(element));
      if (control instanceof HTMLButtonElement && control.form && control.type !== 'button') return {ok:false,error:{code:'not_operable',message:'form submission is outside the import scope'}};
      if (control.getAttribute('formaction') || descriptions.some(text=>/提交|保存|送达|审核|删除|上传|申报/.test(text))) return {ok:false,error:{code:'not_operable',message:'business dispatch is outside the import scope'}};
      const allowed = importRestriction.workflow === "navigation" ? ${JSON.stringify(IMPORT_DATA.readNavigationLabels.slice(0,3))} : [...${JSON.stringify(IMPORT_DATA.readNavigationLabels)},...${JSON.stringify(IMPORT_DATA.resultTabs)},${JSON.stringify(IMPORT_TABS)}[importRestriction.kind]];
      if (registry().importState?.selectedAt !== null && registry().importState?.selectedAt !== undefined && !registry().importState?.closed && ${JSON.stringify(IMPORT_DATA.resultTabs)}.includes(label)) return {ok:false,error:{code:'not_operable',message:'result tabs cannot manufacture a refresh during import verification'}};
      if (!allowed.includes(label) || descriptions.some(text=>text !== label)) {
        const box = control.closest('.el-message-box');
        const buttons = box ? Array.from(box.querySelectorAll('button,a,input,[role="button"]')).filter(visible) : [];
        const summary = box ? clean(box.textContent) : '';
        const dismissible = importRestriction.workflow !== "navigation" && box && /导入/.test(summary) && /(?:成功|失败|记录)/.test(summary)
          && buttons.length === 1 && buttons[0] === control && ['确定','关闭','Close'].includes(label)
          && control.type === 'button' && descriptions.every(text=>['确定','关闭','Close'].includes(text));
        if (!dismissible) return {ok:false,error:{code:'not_operable',message:'this action is outside the import scope'}};
      }
    }
  `
}

/** @param {object} input - validated operation, owner and relative lifetime. @returns {string} self-contained fixed page program. */
export function importProgram(input) {
  return String.raw`(function () {${prelude()}
    const input = ${JSON.stringify(input)};
    const origin = ${JSON.stringify(IMPORT_ORIGIN)};
    const paths = ${JSON.stringify(IMPORT_PATHS)};
    const tabs = ${JSON.stringify(IMPORT_TABS)};
    const knowledge = ${JSON.stringify(IMPORT_DATA)};
    const limit = ${BODY_LIMIT};
    const refusal = (code,message) => ({ok:false,error:{code,message}});
    let state = registry().importState;
    if (input.mode === 'dispose') {
      if (state && state.owner === input.owner) {state.dispose(); delete registry().importState;}
      return {ok:true,value:{cleanupFailed:!!state?.cleanupFailed}};
    }
    if (location.origin !== origin) return refusal('unsupported','Beijing import requires its exact portal origin');
    if (!state || state.owner !== input.owner) {
      if (state) state.dispose();
      const originals = {fetch:globalThis.fetch, open:globalThis.XMLHttpRequest?.prototype.open, send:globalThis.XMLHttpRequest?.prototype.send};
      state = {owner:input.owner,scope:input.scope,documentToken:documentToken(),closed:false,cleanupFailed:false,coverage:false,
        requests:[],resources:[],unitBodies:[],unitPending:0,selectedAt:null,fileGrantId:null,selectedNode:null,acceptedChange:-1,rejectedChange:-1,version:0,summary:null,summaryAt:-1,issue:false,expired:false,cache:null,listeners:[],timer:null,observer:null,resourceObserver:null};
      registry().importState = state;
      const owned = state;
      const native = fn => typeof fn === 'function' && Function.prototype.toString.call(fn).includes('[native code]');
      const endpoint = (url) => {try {const parsed=new URL(url,location.href);return parsed.origin===origin ? parsed.pathname : null;}catch{return null;}};
      const unitPath = url => {const path=endpoint(url)?.toLowerCase();return path && knowledge.unitPathSuffixes.some(suffix=>path.endsWith(suffix));};
      const checkPath = url => Object.values(paths).includes(endpoint(url));
      const remember = (method,url) => {
        if (owned.closed) return null;
        const unit = !!unitPath(url); const check = checkPath(url);
        if (!unit && !check) return null;
        if (owned.requests.length >= 1000) {owned.issue=true;return null;}
        const request={id:'request-'+owned.requests.length,method:String(method).toUpperCase(),url:new URL(url,location.href).href,unit,check,owned:owned.selectedAt!==null,startedAt:performance.now(),complete:false,status:0,body:'',failed:false};
        owned.requests.push(request);if(unit) owned.unitPending++;
        return request;
      };
      const finish = (request,status,body,complete,responseUrl) => {
        if (!request || owned.closed || request.finished) return;
        request.finished=true;
        request.responseUrl=responseUrl||'';request.status=status;request.complete=!!complete&&request.responseUrl===request.url;request.body=typeof body==='string'?body.slice(0,limit):'';
        if(request.unit){owned.unitPending--;if(status>=200&&status<300&&request.complete&&typeof body==='string'&&body.length<limit){if(owned.unitBodies.length>=64)owned.issue=true;else owned.unitBodies.push(body);}else owned.issue=true;}
        owned.snapshot();
      };
      const xhrInfo = new WeakMap();
      const wrappedOpen = function(method,url,...rest) {xhrInfo.set(this,{method,url:String(url)});return Reflect.apply(originals.open,this,[method,url,...rest]);};
      const wrappedSend = function(...args) {
        const info=xhrInfo.get(this);const request=info?remember(info.method,info.url):null;
        if(request){const target=this;const listener=()=>{try{finish(request,target.status,target.responseType===''||target.responseType==='text'?target.responseText:null,true,target.responseURL);}catch{finish(request,0,null,false);}};
          target.addEventListener('loadend',listener,{once:true});owned.listeners.push({target,listener});}
        try{return Reflect.apply(originals.send,this,args);}catch(error){if(request){request.failed=true;finish(request,0,null,false);}throw error;}
      };
      const wrappedFetch = function(...args) {
        let request=null;
        try{const [resource,options]=args;request=remember(options?.method||(resource instanceof Request?resource.method:'GET'),resource instanceof Request?resource.url:String(resource));}catch{owned.issue=true;}
        let promise;
        try{promise=Reflect.apply(originals.fetch,this,args);}catch(error){if(request)finish(request,0,null,false);throw error;}
        if(request) void promise.then(async response=>{
          if(owned.closed)return;
          const reader=response.clone().body?.getReader();
          if(!reader){finish(request,response.status,'',true,response.url);return;}
          const decoder=new TextDecoder();let body='';let complete=false;
          try{while(!owned.closed){const chunk=await reader.read();if(chunk.done){body+=decoder.decode();complete=body.length<limit;break;}body+=decoder.decode(chunk.value,{stream:true});if(body.length>=limit)break;}}
          finally{void reader.cancel().catch(()=>{});}
          finish(request,response.status,body,complete,response.url);
        },()=>finish(request,0,null,false)).catch(()=>{owned.issue=true;});
        return promise;
      };
      owned.hooksIntact = () => globalThis.fetch===wrappedFetch && globalThis.XMLHttpRequest.prototype.open===wrappedOpen && globalThis.XMLHttpRequest.prototype.send===wrappedSend;
      owned.dispose = () => {
        if(owned.closed)return;
        owned.closed=true;clearTimeout(owned.timer);owned.observer?.disconnect();owned.resourceObserver?.disconnect();
        for(const {target,listener} of owned.listeners)target.removeEventListener('loadend',listener);
        try{if(globalThis.fetch===wrappedFetch)globalThis.fetch=originals.fetch;else owned.cleanupFailed=true;
          if(originals.open){const proto=globalThis.XMLHttpRequest.prototype;if(proto.open===wrappedOpen)proto.open=originals.open;else owned.cleanupFailed=true;if(proto.send===wrappedSend)proto.send=originals.send;else owned.cleanupFailed=true;}}
        catch{owned.cleanupFailed=true;}
      };
      const clean = value=>String(value||'').replace(/\s/g,'');
      const classify = table=>{
        const headers=Array.from(table.querySelectorAll('.el-table__header th')).map(el=>clean(el.textContent));
        if(headers.includes(knowledge.failureHeader))return 'rejectedChange';
        if(headers.includes(knowledge.successHeader)&&!headers.includes(knowledge.excludedHeader))return 'acceptedChange';
        return null;
      };
      const summary = () => {
        const candidates=Array.from(document.querySelectorAll('.el-message,.el-message-box__message,.el-notification__content')).map(el=>clean(el.textContent)).filter(text=>text.includes('导入')&&/(?:成功|失败|记录)/.test(text));
        if(candidates.length!==1)return null;
        const text=candidates[0];const success=/(?:成功)(\d+)/.exec(text)||/(\d+)(?:条)?(?:记录)?成功/.exec(text);const failure=/(?:失败)(\d+)/.exec(text)||/(\d+)(?:条)?(?:记录)?失败/.exec(text);const total=/有(\d+)条记录/.exec(text)||/共(\d+)条/.exec(text);
        if(!success||!failure||!total)return null;
        return {total:Number(total[1]),success:Number(success[1]),failure:Number(failure[1])};
      };
      const tables = completion => {
        const all=Array.from(document.querySelectorAll('.el-table'));
        const accepted=all.filter(el=>classify(el)==='acceptedChange');const rejected=all.filter(el=>classify(el)==='rejectedChange');
        const result={fresh:owned.acceptedChange>completion&&owned.rejectedChange>completion,complete:false,accepted:[],rejected:[]};
        if(accepted.length!==1||rejected.length!==1||Array.from(document.querySelectorAll('.el-pagination .btn-next')).some(el=>!el.disabled&&!el.classList.contains('disabled'))
          || Array.from(document.querySelectorAll('.el-loading-mask')).some(visible))return result;
        const version=owned.version;
        for(const [kind,table] of [['accepted',accepted[0]],['rejected',rejected[0]]]){
          const headers=Array.from(table.querySelectorAll('.el-table__header th')).map(el=>clean(el.textContent));
          const names=headers.flatMap((h,i)=>h===knowledge.nameHeader?[i]:[]);const ids=headers.flatMap((h,i)=>knowledge.identityHeaders.includes(h)?[i]:[]);const reasons=headers.flatMap((h,i)=>h===knowledge.failureHeader?[i]:[]);
          if(names.length!==1||ids.length!==1||headers.some(h=>!h)||(kind==='rejected'&&reasons.length!==1))return result;
          const rows=Array.from(table.querySelectorAll('.el-table__body-wrapper tbody tr'));
          for(const row of rows){const cells=Array.from(row.querySelectorAll('td')).map(el=>(el.textContent||'').trim());if(cells.length!==headers.length)return result;
            const name=cells[names[0]];const certificateNumber=cells[ids[0]].trim().toUpperCase();if(!name||!/^\d{17}[\dX]$/.test(certificateNumber)||(kind==='rejected'&&!cells[reasons[0]]))return result;result[kind].push({name,certificateNumber});}
          if(!rows.length&&!table.querySelector('.el-table__empty-block'))return result;
        }
        result.complete=version===owned.version;return result;
      };
      owned.snapshot = () => {
        if(owned.cache)return owned.cache;
        const active=owned.requests.filter(r=>r.check&&r.owned);
        const response=active.length===1?active[0]:null;
        const resources=response?owned.resources.filter(r=>r.name===response.url&&r.startTime>=owned.selectedAt):[];
        const resource=resources.length===1?resources[0]:null;
        const completion=resource&&resource.responseEnd>resource.startTime?resource.responseEnd:null;
        const interference=owned.issue||owned.requests.some(r=>r.check&&!r.owned&&r.complete&&owned.selectedAt!==null)
          ||(owned.selectedAt!==null&&owned.resources.some(r=>r.startTime<owned.selectedAt&&r.responseEnd>=(completion??owned.selectedAt)))
          ||(owned.selectedAt!==null&&owned.resources.filter(r=>r.startTime>=owned.selectedAt).length!==active.length)
          ||resources.length>1;
        const snapshot={requestCount:active.length,pending:active.filter(r=>!r.complete).length,interference,
          ...(response?{response:{requestId:response.id,responseRequestId:response.id,method:response.method,url:response.responseUrl||response.url,status:response.status,complete:response.complete&&completion!==null,body:response.body}}:{}),
          ...(completion!==null?{tables:tables(completion)}:{}),...(owned.summary&&owned.summaryAt>owned.selectedAt?{summary:owned.summary}:{})};
        return snapshot;
      };
      try {
        if(!native(originals.fetch)||!native(originals.open)||!native(originals.send)||typeof PerformanceObserver!=='function')throw new Error('capture-unsupported');
        globalThis.fetch=wrappedFetch;globalThis.XMLHttpRequest.prototype.open=wrappedOpen;globalThis.XMLHttpRequest.prototype.send=wrappedSend;
        owned.observer=new MutationObserver(records=>{
          if(owned.closed||owned.selectedAt===null)return;
          for(const record of records){const element=record.target.nodeType===1?record.target:record.target.parentElement;
            const table=element?.closest('.el-table');const region=element?.closest('tbody,.el-table__empty-block');
            if(table&&region){const key=classify(table);if(key){owned[key]=performance.now();owned.version++;}}
            for(const added of record.addedNodes){if(added.nodeType!==1)continue;for(const candidate of [added,...added.querySelectorAll('.el-table')]){const t=candidate.matches('.el-table')?candidate:candidate.matches('tbody,.el-table__body-wrapper,.el-table__empty-block')?candidate.closest('.el-table'):null;const key=t?classify(t):null;if(key){owned[key]=performance.now();owned.version++;}}}
          }
          const selector='.el-message,.el-message-box__message,.el-notification__content';
          const summaryChanged=records.some(record=>{const el=record.target.nodeType===1?record.target:record.target.parentElement;return el?.closest(selector)||Array.from(record.addedNodes).some(node=>node.nodeType===1&&(node.matches(selector)||node.querySelector(selector)));});
          if(summaryChanged){const current=summary();if(current){owned.summary=current;owned.summaryAt=performance.now();}}
        });owned.observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
        owned.resourceObserver=new PerformanceObserver(list=>{if(owned.closed)return;for(const entry of list.getEntries()){if(checkPath(entry.name)){if(owned.resources.length>=1000)owned.issue=true;else owned.resources.push({name:entry.name,startTime:entry.startTime,responseEnd:entry.responseEnd});}}});
        owned.resourceObserver.observe({type:'resource',buffered:true});
        owned.coverage=true;
      } catch {owned.coverage=false;owned.issue=true;owned.dispose();}
      if(!owned.closed)owned.timer=setTimeout(()=>{owned.cache=owned.snapshot();owned.expired=true;owned.dispose();},input.windowMs);
    }
    if (state.documentToken !== documentToken()) return refusal('stale_observation','the import document changed');
    if (input.mode === 'set_file') {
      if(state.closed||!state.coverage||state.issue||state.fileGrantId!==null)return refusal('not_operable','the import window is unavailable or already consumed');
      if(!state.hooksIntact())return refusal('not_operable','the observation hook changed');
      if(input.target.documentToken!==documentToken())return refusal('stale_observation','the file target document changed');
      const target=elementOf(input.target.elementRef);
      const container=target?.closest('.el-upload');
      const candidates=container?Array.from(container.querySelectorAll('input.el-upload__input[type="file"]')):[];
      const all=Array.from(document.querySelectorAll('input.el-upload__input[type="file"]'));
      const file=input.file;
      const active=Array.from(document.querySelectorAll('[role="tab"],.el-tabs__item')).filter(el=>el.classList.contains('is-active')||el.getAttribute('aria-selected')==='true');
      if(!target||!operable(target)||textOf(target).replace(/\s/g,'')!==knowledge.uploadLabel||candidates.length!==1||all.length!==1||candidates[0]!==all[0]
        ||candidates[0].disabled||!active.some(el=>textOf(el).replace(/\s/g,'')===tabs[file.kind])||active.some(el=>Object.values(tabs).includes(textOf(el).replace(/\s/g,''))&&textOf(el).replace(/\s/g,'')!==tabs[file.kind]))return refusal('not_operable','the unique file input or active business tab is not proven');
      const unitIds=new Set();const legalIds=new Set();
      for(const text of state.unitBodies){try{const body=JSON.parse(text);if(!Array.isArray(body?.map?.data))continue;for(const row of body.map.data){for(const scope of [row,row?.unitDTO,row?.unitExtensionDTO,...(Array.isArray(row?.unitInsuranceDTOList)?row.unitInsuranceDTOList:[])]){if(!scope)continue;if(typeof scope.unitId==='string')unitIds.add(scope.unitId.trim().toUpperCase());for(const key of ['socialCreditCode','unifiedSocialCreditCode','uscc'])if(typeof scope[key]==='string')legalIds.add(scope[key].trim().toUpperCase());}}}catch{return refusal('not_operable','the unit observation is unreadable');}}
      if(state.unitPending!==0||unitIds.size===0||legalIds.size===0||[...unitIds].some(id=>id!==file.expectedIdentity.unitId)||[...legalIds].some(id=>id!==file.expectedIdentity.legalIdentity))return refusal('not_operable','both current identity anchors must match before selection');
      let bytes;
      try{const binary=atob(file.base64);bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));if(bytes.length!==file.bytes)throw new Error('size');}catch{return refusal('invalid_request','file encoding is invalid');}
      const node=candidates[0];const transfer=new DataTransfer();transfer.items.add(new File([bytes],file.name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      if(!node.isConnected||elementOf(input.target.elementRef)!==target||document.querySelectorAll('input.el-upload__input[type="file"]').length!==1||registry().importState!==state||state.closed)return refusal('revoked','file authorization changed before selection');
      state.fileGrantId=file.fileGrantId;state.selectedNode=node;state.selectedAt=performance.now();state.acceptedChange=-1;state.rejectedChange=-1;state.summary=null;state.summaryAt=-1;
      clearTimeout(state.timer);
      state.timer=setTimeout(()=>{state.cache=state.snapshot();state.expired=true;state.dispose();},input.windowMs);
      try{node.files=transfer.files;node.dispatchEvent(new Event('input',{bubbles:true,composed:true}));node.dispatchEvent(new Event('change',{bubbles:true,composed:true}));}catch{return refusal('unknown_outcome','file selection may have run');}
      return {ok:true,value:{action:'set_file',dispatched:true,fileGrantId:file.fileGrantId}};
    }
    const collected=state.snapshot();
    if(!state.closed&&collected.response?.complete&&collected.tables?.fresh&&collected.tables?.complete&&collected.summary){state.cache=collected;state.dispose();}
    const evidence={unitBodies:state.unitBodies,unitPending:state.unitPending,coverage:state.coverage,closed:state.closed,expired:state.expired,cleanupFailed:state.cleanupFailed,fileGrantId:state.fileGrantId,facts:collected};
    return {ok:true,value:{documentToken:documentToken(),privateImport:evidence}};
  })()`
}
