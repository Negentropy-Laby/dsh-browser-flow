import assert from 'node:assert/strict'
import {it} from 'node:test'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {BinaryVerifier} from '../src/graph/binary.ts'

it('hashes successful artifacts once per plugin and detects replacement before a new worker',t=>{
 const root=mkdtempSync(join(tmpdir(),'bf-binary-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const dir=join(root,'lib/native/win32-x64');mkdirSync(dir,{recursive:true})
 const binary=join(dir,'browser-flow-graph.exe'),manifest=join(root,'lib/native/manifest.json'),bytes=Buffer.from('synthetic executable')
 writeFileSync(binary,bytes)
 const metadata={protocolVersion:2,kernelVersion:'5',rulesVersion:'structural-v1',sha256:createHash('sha256').update(bytes).digest('hex')}
 writeFileSync(manifest,JSON.stringify(metadata))
 let reads=0;const verifier=new BinaryVerifier(root,path=>{reads++;return readFileSync(path)})
 verifier.resolve();verifier.resolve();verifier.resolve();assert.equal(reads,2)
 writeFileSync(binary,'replacement executable')
 assert.throws(()=>verifier.resolve(),/binary_changed_reload_required/);assert.equal(reads,2)
 writeFileSync(binary,bytes)
 const reloaded=new BinaryVerifier(root);reloaded.resolve()
 writeFileSync(manifest,'broken')
 const retry=new BinaryVerifier(root);assert.throws(()=>retry.resolve(),/binary_unavailable/)
 writeFileSync(manifest,JSON.stringify(metadata));assert.doesNotThrow(()=>retry.resolve())
 writeFileSync(manifest,JSON.stringify({...metadata,kernelVersion:'3'}))
 assert.throws(()=>new BinaryVerifier(root).resolve(),/binary_mismatch/)
})
