import type {PageRuntime} from './runtime.ts'
import type {PagePolicy} from './types.ts'
/** Fixed page operation; parameters are serialized as JSON by the Host/Client builder. */
export function policy(runtime:PageRuntime, scope:PagePolicy|undefined,element:Element,ACTION:string) {
const {registry,visible,textOf}=runtime;

    const importRestriction = scope || registry().importState?.scope;
    if (importRestriction) {
      if (location.origin !== "https://fuwu.rsj.beijing.gov.cn" || ACTION !== 'click') return {ok:false,error:{code:'not_operable',message:'the import scope permits only its named navigation actions'}};
      const control = (element.closest('button,a,input,[role="button"],[role="tab"],.el-menu-item,.el-submenu__title') || element) as HTMLElement & {value?:string;type?:string};
      const clean = (value: unknown) => String(value || '').replace(/\s/g,'');
      const descriptions = [textOf(control), control.getAttribute('aria-label'), control.getAttribute('title'), control.value].filter(Boolean).map(clean);
      const label = clean(textOf(element));
      if (control instanceof HTMLButtonElement && control.form && control.type !== 'button') return {ok:false,error:{code:'not_operable',message:'form submission is outside the import scope'}};
      if (control.getAttribute('formaction') || descriptions.some(text=>/提交|保存|送达|审核|删除|上传|申报/.test(text))) return {ok:false,error:{code:'not_operable',message:'business dispatch is outside the import scope'}};
      const allowed = importRestriction.workflow === "navigation" ? ["在职职工管理","（增减员）","批量导入"] : [...["在职职工管理","（增减员）","批量导入","单位信息","单位信息变更","返回工作台"],...["信息录入成功","信息录入失败"],({"add":"批量增员","modify":"批量修改","reduce":"批量减员"} as Record<string,string>)[importRestriction.kind ?? '']];
      if (registry().importState?.selectedAt !== null && registry().importState?.selectedAt !== undefined && !registry().importState?.closed && ["信息录入成功","信息录入失败"].includes(label)) return {ok:false,error:{code:'not_operable',message:'result tabs cannot manufacture a refresh during import verification'}};
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

}
