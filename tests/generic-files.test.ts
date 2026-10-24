import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,readFile,open,type FileHandle} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import AdmZip from 'adm-zip'
import {GenericFiles} from '../src/generic-files.ts'
import {parseWorkbookData} from '../src/workbook-core.ts'
import {validateAssertion,evaluateAssertion} from '../src/exploration-checks.ts'
import {runScope,TASK} from './helpers/task-scope.ts'

async function fixture(t:import('node:test').TestContext){
 const root=await mkdtemp(join(tmpdir(),'bf-generic-files-')),files=new GenericFiles()
 const lease={id:'lease',state:'active',agent:{},sessionId:'owner',connectionInstanceId:'panel',connectionGeneration:1,epoch:1,documentToken:'doc',task:runScope(TASK),evidenceRoot:join(root,'evidence')}
 t.after(async()=>{await files.close();await rm(root,{recursive:true,force:true})})
 const path=join(root,'selection.json');await writeFile(path,JSON.stringify({columns:['key','amount'],rows:[['A',42]]}))
 return {root,files,lease,path}
}
test('neutral files require exact confirmation, preserve selected bytes and are single use',async t=>{
 const f=await fixture(t),preview=await f.files.prepare(f.lease,f.path)
 assert.equal(preview.kind,'generic');assert.equal(preview.format,'json')
 await assert.rejects(f.files.dispatch(f.lease,preview.fileGrantId),/not-confirmed/)
 f.files.confirm(f.lease,preview.fileGrantId)
 const payload=await f.files.dispatch(f.lease,preview.fileGrantId)
 assert.deepEqual(Buffer.from(payload.base64,'base64'),await readFile(f.path))
 assert.equal('expectedIdentity'in payload,false);assert.equal('path'in payload,false)
 await assert.rejects(f.files.dispatch(f.lease,preview.fileGrantId),/consumed/)
})
for(const change of ['source','snapshot','run','document','revoke'] as const)test(`neutral file dispatch rejects changed ${change}`,async t=>{
 const f=await fixture(t),preview=await f.files.prepare(f.lease,f.path),entry=f.files.current(f.lease)!
 f.files.confirm(f.lease,preview.fileGrantId)
 if(change==='source')await writeFile(f.path,'changed')
 if(change==='snapshot')await writeFile(entry.snapshot,'changed')
 if(change==='run')f.lease.task={...f.lease.task,runId:'run-00000000-0000-4000-8000-000000000099' as typeof f.lease.task.runId}
 if(change==='document')f.lease.documentToken='replacement'
 if(change==='revoke')f.lease.state='revoked'
 await assert.rejects(f.files.dispatch(f.lease,preview.fileGrantId))
})
function workbook(){
 const z=new AdmZip()
 z.addFile('[Content_Types].xml',Buffer.from('<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'))
 z.addFile('xl/workbook.xml',Buffer.from('<workbook xmlns:r="urn:r"><sheets><sheet name="Neutral A" sheetId="1" r:id="a"/><sheet name="Neutral B" sheetId="2" r:id="b"/></sheets></workbook>'))
 z.addFile('xl/_rels/workbook.xml.rels',Buffer.from('<Relationships><Relationship Id="a" Type="urn:example/worksheet" Target="worksheets/a.xml"/><Relationship Id="b" Type="urn:example/worksheet" Target="worksheets/b.xml"/></Relationships>'))
 z.addFile('xl/worksheets/a.xml',Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>任意字段</t></is></c><c r="B1"><v>42</v></c><c r="C1" t="b"><v>1</v></c></row></sheetData></worksheet>'))
 z.addFile('xl/worksheets/b.xml',Buffer.from('<worksheet><sheetData><row r="3"><c r="A3"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>'))
 return z.toBuffer()
}
test('XLSX reader returns multiple sheets, coordinates and types without interpreting headers or calculating formulas',()=>{
 const value=parseWorkbookData(workbook());assert.equal(value.sheets.length,2)
 assert.deepEqual(value.sheets[0].rows[0].cells.map(c=>[c.ref,c.type,c.value]),[['A1','text','任意字段'],['B1','number',42],['C1','boolean',true]])
 assert.deepEqual(value.sheets[1].rows[0].cells[0],{ref:'A3',type:'formula',formula:'1+1',value:null})
})
test('assertions are source-backed, bounded, typed comparisons with one composition level',()=>{
 const ref='asset-source',values=new Map([[ref,{names:['A','B'],count:2,status:'complete'}]])
 const assertion={op:'all',checks:[{op:'setEquals',left:{ref,path:['names']},right:{value:['B','A']}},{op:'count',left:{ref,path:['names']},right:{value:2}}]}
 validateAssertion(assertion);assert.equal(evaluateAssertion(assertion,values).passed,true)
 assert.throws(()=>validateAssertion({op:'equals',left:{value:true},right:{value:true}}))
 assert.throws(()=>validateAssertion({op:'all',checks:Array(33).fill(assertion.checks[0])}))
 assert.throws(()=>validateAssertion({op:'all',checks:[assertion]}))
 assert.throws(()=>validateAssertion({op:'exists',left:{ref,path:['__proto__']}}))
 assert.throws(()=>validateAssertion({op:'script',code:'return true'}))
})

test('an asynchronous prepare cannot adopt a changed document binding',async t=>{
 const f=await fixture(t),sample=await open(f.path,'r'),prototype=Object.getPrototypeOf(sample) as FileHandle,read=prototype.read
 await sample.close()
 let entered!:()=>void,release!:()=>void,held=false
 const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r)
 t.mock.method(prototype,'read',async function(this:FileHandle,...args:unknown[]){if(!held){held=true;entered();await gate};return Reflect.apply(read,this,args)})
 const preparing=f.files.prepare(f.lease,f.path);void preparing.catch(()=>{})
 await ready;f.lease.documentToken='new-document';f.lease.epoch++
 release();await assert.rejects(preparing,/binding-changed/)
 assert.equal(f.files.current(f.lease),undefined)
})
