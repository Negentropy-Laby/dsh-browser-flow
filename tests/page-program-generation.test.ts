import assert from 'node:assert/strict'
import {it} from 'node:test'
import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import ts from 'typescript'
import {prelude,identityProgram,observeProgram,findProgram,actProgram,waitProgram} from '../src/pagecode.ts'

/** @param file - generated test input. @param prepareCommand - explicit preparation command. @returns UTF-8 input; missing inputs explain preparation. */
function readGeneratedArtifact(file:URL,prepareCommand:string):string {
  try{return readFileSync(file,'utf8')}
  catch(error){
    if(error instanceof Error&&'code' in error&&error.code==='ENOENT'){
      throw new Error(`Missing generated test artifact ${fileURLToPath(file)}. Run "${prepareCommand}" before running this test.`,{cause:error})
    }
    throw error
  }
}

for(const [path,command] of [
  ['.cache/page-programs.json','node --import tsx/esm scripts/build-page.ts'],
  ...['dom-table','bjrsj-import','second-page'].map(name=>[`.cache/fixtures/${name}.html`,'npm run build:fixtures']),
])it(`reports the preparation command for missing ${path}`,()=>{
  const root=mkdtempSync(join(tmpdir(),'bf-missing-artifact-'))
  try{
    const file=pathToFileURL(join(root,path))
    assert.throws(()=>readGeneratedArtifact(file,command),error=>{
      assert.ok(error instanceof Error)
      assert.match(error.message,/Missing generated test artifact/)
      assert.ok(error.message.includes(fileURLToPath(file)))
      assert.ok(error.message.includes(command))
      return true
    })
    assert.equal(existsSync(file),false)
  }finally{rmSync(root,{recursive:true,force:true})}
})

it('preserves read errors other than missing generated artifacts',()=>{
  assert.throws(()=>readGeneratedArtifact(new URL('https://example.test/generated.json'),'unused preparation command'),{code:'ERR_INVALID_URL_SCHEME'})
})

it('preserves the public prelude helper bindings',()=>{
  const file=ts.createSourceFile('prelude.js',prelude(),ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS)
  const bindings=file.statements.filter(ts.isVariableStatement).flatMap(row=>row.declarationList.declarations).flatMap(row=>ts.isObjectBindingPattern(row.name)?row.name.elements.map(element=>element.name.getText(file)):[])
  for(const name of ['REGISTRY','SENSITIVE_QUERY','registry','mintRef','elementOf','visible','safeUrl','documentToken'])assert.ok(bindings.includes(name),name)
})

it('builds all fixed operations from compiled TypeScript with no module dependencies',()=>{
  const file=new URL('../lib/page-programs.js',import.meta.url)
  const bytes=readFileSync(file)
  const manifest: unknown=JSON.parse(readGeneratedArtifact(new URL('../.cache/page-programs.json',import.meta.url),'node --import tsx/esm scripts/build-page.ts'))
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
    const compiled=readGeneratedArtifact(new URL('../.cache/fixtures/'+name+'.html',import.meta.url),'npm run build:fixtures')
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
