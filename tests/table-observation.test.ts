import {test} from 'node:test'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {resolveDependency,entryOf} from './helpers/dom-host.ts'
import {observeProgram} from '../src/pagecode.ts'
const checkout=process.env.DSH_CHECKOUT??new URL('../../deepseek-harness',import.meta.url).pathname
async function observe(t:import('node:test').TestContext,html:string,chars=8000,nodes=300,view='table'){
 const dep=resolveDependency(checkout,'jsdom');assert.ok(dep,'Set DSH_CHECKOUT to the existing Harness with jsdom')
 const {JSDOM}=await import(pathToFileURL(entryOf(dep)).href),dom=new JSDOM(html,{url:'https://tables.example',runScripts:'dangerously'})
 t.after(()=>dom.window.close())
 dom.window.Element.prototype.getBoundingClientRect=()=>({x:0,y:0,top:0,left:0,right:100,bottom:20,width:100,height:20,toJSON(){return {}}})
 return dom.window.eval(observeProgram(chars,nodes,{view})).value as any
}
test('native spans retain header coordinates and row-group rowspan zero',async t=>{
 const v=await observe(t,'<table><thead><tr><th colspan="2">Name</th><th rowspan="2">Age</th></tr><tr><th>First</th><th>Last</th></tr></thead><tbody><tr><td rowspan="0">A</td><td>Smith</td><td>32</td></tr><tr><td>Lee</td><td>33</td></tr></tbody><tbody><tr><td>B</td><td>Jones</td><td>34</td></tr></tbody></table>')
 const table=v.tables[0];assert.equal(table.layoutComplete,true)
 assert.deepEqual(Array.from(table.columns,(c:any)=>[c.row,c.column,c.rowSpan,c.colSpan]),[[0,0,1,2],[0,2,2,1],[1,0,1,1],[1,1,1,1]])
 assert.equal(table.rows[2].cells[0].rowSpan,2)
 assert.deepEqual(Array.from(table.rows[3].cells,(c:any)=>c.column),[1,2]);assert.equal(table.rows[4].cells[0].column,0)
})
test('wrapped ARIA cells keep explicit indices and exclude nested table cells',async t=>{
 const v=await observe(t,'<div role="grid"><div role="row" aria-rowindex="3"><div><span role="columnheader" aria-colindex="2" aria-colspan="2">Title</span></div></div><div role="row" aria-rowindex="4"><div><span role="gridcell" aria-colindex="2">Value<table><tr><td>Nested</td></tr></table></span></div></div></div>')
 assert.equal(v.tables.length,2);assert.equal(v.tables[0].rows.length,2)
 assert.equal(v.tables[0].rows[0].index,2);assert.equal(v.tables[0].columns[0].colSpan,2)
 assert.equal(v.tables[0].rows[1].cells.length,1);assert.equal(v.tables[0].rows[1].cells[0].column,1)
})
test('ambiguous ARIA coordinates report incomplete layout instead of false columns',async t=>{
 const v=await observe(t,'<div role="grid"><div role="row"><span role="gridcell" aria-colspan="2">A</span><span role="gridcell" aria-colindex="2">B</span></div></div>')
 assert.equal(v.layoutComplete,false);assert.equal(v.domComplete,false)
 assert.equal(v.tables[0].rows[0].cells[1].column,null);assert.ok(v.tables[0].diagnostics.length)
})
test('large first cell and region use available text budget without splitting emoji',async t=>{
 const text='中😀'.repeat(4000),table=await observe(t,`<table><tr><td>${text}</td><td>next</td></tr></table>`,8000)
 const cell=table.tables[0].rows[0].cells[0];assert.ok(cell.text.length>7800);assert.equal(cell.truncated,true)
 assert.match(cell.elementRef,/^el-/);assert.equal(/[\uD800-\uDBFF]$/.test(cell.text),false)
 const region=await observe(t,`<section>${text}</section>`,8000,100,'region')
 assert.ok(region.region.text.length>7900);assert.equal(region.region.truncated,true);assert.equal(region.datasetComplete,false)
 const limited=await observe(t,'<table><tr><td>A</td><td>B</td></tr></table>',8000,2)
 assert.equal(limited.tables[0].rows[0].cells.length,1);assert.equal(limited.domComplete,false)
})
