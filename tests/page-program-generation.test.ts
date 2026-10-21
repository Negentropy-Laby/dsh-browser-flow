import assert from 'node:assert/strict'
import {it} from 'node:test'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import {identityProgram,observeProgram,findProgram,actProgram,waitProgram} from '../src/pagecode.ts'

it('builds all fixed operations from compiled TypeScript with no module dependencies',()=>{
  const file=new URL('../lib/page-programs.js',import.meta.url)
  const bytes=readFileSync(file)
  const manifest: unknown=JSON.parse(readFileSync(new URL('../lib/page-programs.json',import.meta.url),'utf8'))
  assert.ok(manifest&&typeof manifest==='object'&&'sha256' in manifest)
  assert.equal(manifest.sha256,createHash('sha256').update(bytes).digest('hex'))
  const target={documentToken:'synthetic',elementRef:'synthetic'}
  for(const source of [identityProgram(),observeProgram(100,10),findProgram({by:'text',value:'literal'},2),actProgram({...target,action:'click'}),waitProgram({target,condition:'present',timeoutMs:1})]){
    assert.doesNotMatch(source,/__name|__awaiter/)
    const parsed=ts.createSourceFile('fixed.js',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS)
    const inspect=(node:ts.Node):void=>{
      assert.equal(ts.isImportDeclaration(node)||node.kind===ts.SyntaxKind.ImportKeyword,false)
      if(ts.isIdentifier(node))assert.equal(['process','require','Buffer'].includes(node.text),false)
      ts.forEachChild(node,inspect)
    }
    inspect(parsed)
    assert.doesNotMatch(source,/XMLHttpRequest|document\.cookie|localStorage|sessionStorage|indexedDB/)
  }
})

it('keeps tracked synthetic HTML static and assembles its compiled behavior privately',()=>{
  for(const name of ['dom-table','bjrsj-import','second-page']){
    const html=readFileSync(new URL('../fixtures/'+name+'.html',import.meta.url),'utf8')
    assert.doesNotMatch(html,/<script\b|\son\w+\s*=/i)
    const compiled=readFileSync(new URL('../.cache/fixtures/'+name+'.html',import.meta.url),'utf8')
    assert.match(compiled,/<script>/)
    assert.doesNotMatch(compiled,/__name|__awaiter/)
  }
})
