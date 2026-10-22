/** Typed presentation adapter to the Host's shared controls; no control authority. */
import type {ReactLike} from './panel.ts'

export type PanelElementType=string|((...args:never[])=>unknown)|{readonly $$typeof:symbol}
export type PanelTone='outline'|'neutral'|'success'|'info'|'warning'|'danger'
export type PanelDot='done'|'warning'|'ongoing'|'error'|'idle'
export interface PanelButtonProps {
 type?:'button'|'submit';variant?:'primary'|'ghost'|'outline'|'toolbar';size?:'sm'|'md'
 className?:string;disabled?:boolean;onClick?:()=>void;'aria-label'?:string;'aria-busy'?:boolean
 'aria-expanded'?:boolean;'aria-controls'?:string;'data-browser-flow-action'?:string
}
export interface PanelInputProps {
 id?:string;type?:string;value:string;disabled?:boolean;readOnly?:boolean;placeholder?:string
 className?:string;autoComplete?:string;'aria-label'?:string;'aria-invalid'?:boolean;'aria-describedby'?:string
 'data-browser-flow-input'?:string;onChange?:(event:{target:HTMLInputElement})=>void
}
export interface PanelDisclosureProps {
 title:string;open:boolean;onToggle:()=>void;children?:unknown;className?:string
}
export interface PanelUi {
 button(props:PanelButtonProps,...children:unknown[]):unknown
 input(props:PanelInputProps):unknown
 tag(tone:PanelTone,text:string):unknown
 dot(state:PanelDot):unknown
 disclosure(props:PanelDisclosureProps):unknown
}
function component(value:unknown):value is Exclude<PanelElementType,string>{
 return typeof value==='function'||value!==null&&typeof value==='object'&&'$$typeof'in value&&typeof value.$$typeof==='symbol'
}
/** @param React - shared renderer. @param platform - actual frozen platform module. @returns Typed render functions, refusing missing shared controls. */
export function createPanelUi(React:Pick<ReactLike,'createElement'>,platform:unknown):PanelUi {
 if(platform===null||typeof platform!=='object'||!('Button'in platform)||!component(platform.Button)||!('Input'in platform)||!component(platform.Input)||!('Tag'in platform)||!component(platform.Tag)||!('StateDot'in platform)||!component(platform.StateDot)||!('DisclosureRow'in platform)||!component(platform.DisclosureRow))throw new Error('Browser Flow requires the matching Host UI primitives; reload the paired Client')
 const {Button,Input,Tag,StateDot,DisclosureRow}=platform,h=React.createElement
 return {
  button:(props,...children)=>h(Button,{type:'button',size:'sm',variant:'outline',...props,'data-browser-flow-ui':'button'},...children),
  input:props=>h(Input,{...props,'data-browser-flow-ui':'input'}),
  tag:(tone,text)=>h(Tag,{tone},text),
  dot:state=>h(StateDot,{state}),
  disclosure:({children,...props})=>h(DisclosureRow,{icon:null,expandable:true,expandOnRowClick:true,...props},children),
 }
}
/** @param effect - owning plugin effect registration. @param css - bundled, root-scoped stylesheet. @returns Styles are removed with the plugin and never installed during module evaluation. */
export function installPanelStyles(effect:(callback:()=>()=>void,label:string)=>void,css:string):void {
 effect(()=>{
  const tag=document.createElement('style')
  tag.dataset.plugin='@negentropy/dsh-browser-flow';tag.textContent=css
  document.head.appendChild(tag)
  return ()=>tag.remove()
 },'browser-flow: panel styles')
}
