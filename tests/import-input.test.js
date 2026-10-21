import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import AdmZip from 'adm-zip'
import { importScope, judgeIdentity, extractIdentity, judgeImport, BODY_LIMIT } from '../src/import-rules.js'
import { parseWorkbook } from '../src/import-workbook.js'
import { ImportFiles } from '../src/import-files.js'
import { workbook, people, scope, facts } from './import-fixture.js'

describe('Beijing domain facts and frozen input', () => {
  for (const kind of ['add','modify','reduce']) it(`proves ${kind} only from its own complete consistent evidence`, () => {
    assert.equal(judgeImport(importScope({ ...scope, kind }), people, facts(kind)).verdict, 'import_confirmed')
  })
  it('requires both typed identity anchors and rejects a conflicting extra anchor', () => {
    assert.equal(judgeIdentity({ unitIds:['UNIT1'], legalIdentities:[] },scope),'unverified')
    assert.equal(judgeIdentity({ unitIds:['UNIT1','OTHER'], legalIdentities:[scope.legalIdentity] },scope),'mismatch')
    assert.equal(judgeIdentity(extractIdentity({map:{data:[{unitDTO:{unitId:'UNIT1',socialCreditCode:scope.legalIdentity}}]}}),scope),'verified')
    assert.throws(() => importScope({...scope,unitId:'PENDING-1'}))
  })
  for (const [name, mutate] of [
    ['old response', f => {f.response.responseRequestId='old'}],
    ['two dispatches', f => {f.requestCount=2}],
    ['pending second request', f => {f.pending=1}],
    ['old resource interference', f => {f.interference=true}],
    ['wrong method', f => {f.response.method='GET'}],
    ['other business endpoint', f => {f.response.url=f.response.url.replace('ExcelCheck','ModifyExcelCheck')}],
    ['foreign origin', f => {f.response.url=f.response.url.replace('fuwu.rsj.beijing.gov.cn','example.test')}],
    ['longer endpoint', f => {f.response.url+='/extra'}],
    ['HTTP failure', f => {f.response.status=500}],
    ['stream pending', f => {f.response.complete=false}],
    ['body cap', f => {f.response.body=' '.repeat(BODY_LIMIT)}],
    ['non JSON', f => {f.response.body='bad'}],
    ['old tables', f => {f.tables.fresh=false}],
    ['incomplete tables', f => {f.tables.complete=false}],
    ['missing summary', f => {delete f.summary}],
    ['summary conflict', f => {f.summary.success=2}],
    ['personnel mismatch', f => {f.tables.accepted=[{...people[0],name:'另一人'}]}],
    ['unknown failure count', f => {f.summary.failure=null}],
  ]) it(`never confirms ${name}`, () => { const f=facts();mutate(f);assert.notEqual(judgeImport(scope,people,f).verdict,'import_confirmed') })
  it('does not confuse appcode acceptance with accepted rows', () => {
    const f=facts();const body=JSON.parse(f.response.body);body.map.data[0].errorMessage='错误';f.response.body=JSON.stringify(body)
    assert.equal(judgeImport(scope,people,f).verdict,'rejected')
    body.map.data[0].errorMessage='';body.map.data[0].validateStatus='0';f.response.body=JSON.stringify(body)
    assert.equal(judgeImport(scope,people,f).verdict,'rejected')
  })
  it('parses actual workbook rows and rejects duplicate or numeric personnel', () => {
    assert.deepEqual(parseWorkbook(workbook()).people,people)
    assert.throws(() => parseWorkbook(workbook([...people,...people])),/duplicate/)
    assert.throws(() => parseWorkbook(Buffer.from('not zip')))
    const zip=new AdmZip(workbook());let xml=zip.readAsText('xl/worksheets/sheet1.xml');xml=xml.replace('r="B2" t="inlineStr"><is><t>110101199001010011</t></is>','r="B2"><v>110101199001010011</v>');zip.updateFile('xl/worksheets/sheet1.xml',Buffer.from(xml))
    assert.throws(() => parseWorkbook(zip.toBuffer()),/numeric/)
  })
  it('rejects one certificate repeated under different names', () => {
    assert.throws(() => parseWorkbook(workbook([...people, { ...people[0], name: '另一名字' } ])), /duplicate/)
  })
  for (const [name, change] of [
    ['formula', xml=>xml.replace('</sheetData>','</sheetData><f>SUM(A1)</f>')],
    ['hidden row',xml=>xml.replace('row r="2"','row r="2" hidden="1"')],
    ['merged data',xml=>xml.replace('</worksheet>','<mergeCells><mergeCell ref="A2:B2"/></mergeCells></worksheet>')],
  ]) it(`rejects ${name} before any browser action`,()=>{const zip=new AdmZip(workbook());zip.updateFile('xl/worksheets/sheet1.xml',Buffer.from(change(zip.readAsText('xl/worksheets/sheet1.xml'))));assert.throws(()=>parseWorkbook(zip.toBuffer()))})

  it('binds confirmation and exactly one dispatch to the same live document', async t => {
    const root=await mkdtemp(join(tmpdir(),'bf-import-'));t.after(()=>rm(root,{recursive:true,force:true}))
    const path=join(root,'input.xlsx');await writeFile(path,workbook())
    const lease={id:'lease',state:'active',agent:{},sessionId:'s',connectionInstanceId:'p',connectionGeneration:1,epoch:0,documentToken:'d'}
    const store=new ImportFiles(join(root,'private'))
    const preview=await store.prepare(lease,path,scope)
    assert.equal(preview.rows,1)
    await assert.rejects(store.dispatch(lease,preview.fileGrantId),/not-confirmed/)
    store.confirm(lease,preview.fileGrantId)
    const selected=await store.dispatch(lease,preview.fileGrantId)
    assert.equal(selected.sha256,preview.sha256)
    await assert.rejects(store.dispatch(lease,preview.fileGrantId),/consumed/)
    assert.equal(Buffer.from(selected.base64,'base64').length,preview.bytes)
    assert.ok((await readFile(path)).length)
  })
  it('does not resurrect preparation or dispatch after an asynchronous revocation', async t => {
    const root=await mkdtemp(join(tmpdir(),'bf-race-'));t.after(()=>rm(root,{recursive:true,force:true}))
    const path=join(root,'input.xlsx');await writeFile(path,workbook())
    const lease={id:'l',state:'active',agent:{},sessionId:'s',connectionInstanceId:'p',connectionGeneration:1,epoch:0,documentToken:'d'}
    const store=new ImportFiles(join(root,'private'))
    const pending=store.prepare(lease,path,scope);lease.epoch++
    await assert.rejects(pending,/binding-changed/)
    const p=await store.prepare(lease,path,scope);store.confirm(lease,p.fileGrantId)
    const dispatch=store.dispatch(lease,p.fileGrantId);lease.state='revoked'
    await assert.rejects(dispatch,/binding-changed/)
  })
  it('refuses source swaps and another session without returning private data', async t => {
    const root=await mkdtemp(join(tmpdir(),'bf-swap-'));t.after(()=>rm(root,{recursive:true,force:true}))
    const path=join(root,'input.xlsx');await writeFile(path,workbook())
    const lease={id:'l',state:'active',agent:{},sessionId:'s',connectionInstanceId:'p',connectionGeneration:1,epoch:0,documentToken:'d'}
    const store=new ImportFiles(join(root,'private'));const p=await store.prepare(lease,path,scope)
    assert.throws(()=>store.confirm({...lease,agent:{}},p.fileGrantId),/binding-changed/)
    store.confirm(lease,p.fileGrantId);await writeFile(path,Buffer.from('changed'))
    await assert.rejects(store.dispatch(lease,p.fileGrantId),/source-changed/)
  })
  it('refuses a changed snapshot and awaits preparation during unload',async t=>{
    const root=await mkdtemp(join(tmpdir(),'bf-snapshot-'));t.after(()=>rm(root,{recursive:true,force:true}))
    const path=join(root,'input.xlsx');await writeFile(path,workbook())
    const lease={id:'l',state:'active',agent:{},sessionId:'s',connectionInstanceId:'p',connectionGeneration:1,epoch:0,documentToken:'d'}
    const store=new ImportFiles(join(root,'private'));const p=await store.prepare(lease,path,scope)
    store.confirm(lease,p.fileGrantId)
    await writeFile(store.entries.get(p.fileGrantId).snapshot,'altered')
    await assert.rejects(store.dispatch(lease,p.fileGrantId),/snapshot-changed/)
    await store.close()
    const next=new ImportFiles(join(root,'next'))
    const preparing=next.prepare(lease,path,scope)
    const failed=assert.rejects(preparing,/binding-changed/)
    await next.close();await failed
    assert.equal(next.entries.size,0);assert.equal(next.tasks.size,0)
  })
})
