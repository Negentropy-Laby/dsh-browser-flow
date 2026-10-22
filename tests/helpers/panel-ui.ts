/** Presentation-only stand-ins; native Desktop qualification uses the real Host module. */
import type {ReactLike} from '../../src/panel.ts'
import type {PanelUi,PanelButtonProps,PanelInputProps} from '../../src/panel-ui.ts'

/** @param React - fixture renderer. @returns Controls exposing native DOM behavior to controller tests. */
export function fixturePanelUi(React:Pick<ReactLike,'createElement'>):PanelUi {
 const h=React.createElement
 return {button:(props,...children)=>h('button',props,...children),input:props=>h('input',props),tag:(tone,text)=>h('span',{'data-tone':tone},text),dot:state=>h('span',{'data-state':state,'aria-hidden':true}),disclosure:props=>h('div',null,h('button',{type:'button',onClick:props.onToggle,'aria-expanded':props.open},props.title),props.open?props.children:null)}
}
/** @param React - real or fixture React. @returns A platform-module substitute for bundle protocol tests. */
export function fixturePrimitives(React:Pick<ReactLike,'createElement'>):object {
 const h=React.createElement
 return {
  Button:({children,variant,size,...props}:PanelButtonProps&{children?:unknown})=>h('button',props,children),
  Input:(props:PanelInputProps)=>h('input',props),
  Tag:({tone,children}:{tone:string;children?:unknown})=>h('span',{'data-tone':tone},children),
  StateDot:({state}:{state:string})=>h('span',{'data-state':state,'aria-hidden':true}),
  DisclosureRow:({title,open,onToggle,children}:{title:string;open:boolean;onToggle:()=>void;children?:unknown})=>h('div',null,h('button',{type:'button',onClick:onToggle,'aria-expanded':open},title),open?children:null),
 }
}
/** @param t - owns restoration. @returns Installed stylesheet handles without a browser dependency. */
export function styleDocument(t:import('node:test').TestContext){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document'),tags:{dataset:Record<string,string>;textContent:string;remove:()=>void}[]=[]
 const document={createElement(){const tag={dataset:{},textContent:'',remove(){const i=tags.indexOf(tag);if(i>=0)tags.splice(i,1)}};return tag},head:{appendChild(tag:typeof tags[number]){tags.push(tag)}}}
 Object.defineProperty(globalThis,'document',{value:document,configurable:true,writable:true})
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document')})
 return tags
}
