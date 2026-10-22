import assert from 'node:assert/strict'
import {it} from 'node:test'
import {createPanelUi,installPanelStyles} from '../src/panel-ui.ts'
import {fixturePrimitives,styleDocument} from './helpers/panel-ui.ts'
import {expectRecord} from './helpers/assertions.ts'

it('accepts Host forwardRef/memo controls and preserves native action and input properties',()=>{
 const calls:{type:unknown;props:object|null;children:unknown[]}[]=[]
 const React={createElement:(type:unknown,props:object|null,...children:unknown[])=>{const row={type,props,children};calls.push(row);return row}}
 const platform={...fixturePrimitives(React),Button:{$$typeof:Symbol.for('react.forward_ref')},DisclosureRow:{$$typeof:Symbol.for('react.memo')}}
 const ui=createPanelUi(React,platform),clicked=()=>{},changed=()=>{}
 ui.button({disabled:true,onClick:clicked,'data-browser-flow-action':'revoke'},'Revoke')
 ui.input({value:'draft',onChange:changed,'data-browser-flow-input':'goal'})
 ui.disclosure({title:'Details',open:false,onToggle:clicked})
 assert.equal(calls[0].type,platform.Button);assert.equal(expectRecord(calls[0].props).onClick,clicked)
 assert.equal(expectRecord(calls[0].props).disabled,true);assert.equal(expectRecord(calls[1].props).onChange,changed)
 assert.equal(calls[2].type,platform.DisclosureRow)
})
it('refuses a missing or incompatible Host control instead of silently returning unstyled controls',()=>{
 const React={createElement:()=>({})}
 for(const platform of [undefined,{}, {...fixturePrimitives(React),Button:'button'},{...fixturePrimitives(React),DisclosureRow:null}]){
  assert.throws(()=>createPanelUi(React,platform),/matching Host UI/)
 }
})
it('installs styles only in the owning plugin effect and removes them on disposal',t=>{
 const tags=styleDocument(t),effects:{callback:()=>()=>void;label:string}[]=[]
 installPanelStyles((callback,label)=>{effects.push({callback,label})},'[data-browser-flow-panel] {padding:16px}')
 assert.equal(tags.length,0)
 const dispose=effects[0].callback();assert.equal(tags.length,1);assert.equal(tags[0].dataset.plugin,'@negentropy/dsh-browser-flow')
 assert.match(tags[0].textContent,/data-browser-flow-panel/)
 dispose();assert.equal(tags.length,0)
 const remove=effects[0].callback();assert.equal(tags.length,1);remove();assert.equal(tags.length,0)
})
