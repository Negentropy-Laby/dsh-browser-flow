import assert from 'node:assert/strict'
import {it} from 'node:test'
import {readFileSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import {identityProgram,observeProgram,findProgram,actProgram,waitProgram} from '../src/pagecode.ts'

it('builds all fixed operations from compiled TypeScript with no module dependencies',()=>{
  const file=new URL('../lib/page-programs.js',import.meta.url)
  const bytes=readFileSync(file)
  const manifest: unknown=JSON.parse(readFileSync(new URL('../.cache/page-programs.json',import.meta.url),'utf8'))
  assert.ok(manifest&&typeof manifest==='object'&&'sha256' in manifest)
  assert.equal(manifest.sha256,createHash('sha256').update(bytes).digest('hex'))
  const target={documentToken:'synthetic',elementRef:'synthetic'}
  for(const source of [identityProgram(),observeProgram(100,10),findProgram({by:'text',value:'literal'},2),actProgram({...target,action:'click'}),waitProgram({target,condition:'present',timeoutMs:1})] as const){
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

it('ships page declarations without a Client-only Host wrapper or verification metadata',()=>{
  assert.equal(readFileSync(new URL('../lib/page-programs.d.ts',import.meta.url),'utf8'),readFileSync(new URL('../src/page/program-sources.d.ts',import.meta.url),'utf8'))
  for(const path of ['lib/page-programs.json','lib/host/import-page.js','lib/host/import-page.d.ts'])assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path)
})

it('keeps tracked synthetic HTML static and assembles its compiled behavior privately',()=>{
  for(const name of ['dom-table','bjrsj-import','second-page'] as const){
    const html=readFileSync(new URL('../fixtures/'+name+'.html',import.meta.url),'utf8')
    assert.doesNotMatch(html,/<script\b|\son\w+\s*=/i)
    const compiled=readFileSync(new URL('../.cache/fixtures/'+name+'.html',import.meta.url),'utf8')
    assert.match(compiled,/<script>/)
    assert.doesNotMatch(compiled,/__name|__awaiter/)
  }
  for(const name of ['actions-and-refusals','dom-table-loop']){
    const text=readFileSync(new URL('./'+name+'.test.ts',import.meta.url),'utf8')
    const file=ts.createSourceFile(name+'.ts',text,ts.ScriptTarget.ES2022,true)
    const inspect=(node:ts.Node):void=>{
      if(ts.isStringLiteralLike(node))assert.doesNotMatch(node.text,/<script\b/i,'fixture behavior must come from compiled TypeScript')
      ts.forEachChild(node,inspect)
    }
    inspect(file)
  }

})

it('serialization refuses a compiler helper captured outside the fixed function',async()=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const {compiledFunction}=await import('../scripts/build-page.ts')
  const root=await mkdtemp(join(tmpdir(),'bf-helper-refusal-'))
  try{
    const file=join(root,'negative.js')
    // Deliberately malformed emitted code, never a program executed in a page.
    await writeFile(file,'export function negative(){return __rewriteRelativeImportExtension("fixture")}\n')
    assert.throws(()=>compiledFunction(file,'negative'),/compiler helpers/)
  }finally{await rm(root,{recursive:true,force:true})}
})
