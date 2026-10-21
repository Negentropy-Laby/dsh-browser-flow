import assert from 'node:assert/strict'
import { it } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root=dirname(dirname(fileURLToPath(import.meta.url)))

it('pairs the native artifact with its source identity and removes build-machine paths',()=>{
 const bytes=readFileSync(join(root,'lib/native/win32-x64/browser-flow-graph.exe'))
 const manifest=JSON.parse(readFileSync(join(root,'lib/native/manifest.json'),'utf8'))
 assert.equal(manifest.sha256,createHash('sha256').update(bytes).digest('hex'))
 assert.equal(manifest.goVersion,'go1.26.5');assert.equal(manifest.protocolVersion,1)
 for(const path of [root,homedir()])assert.ok(!bytes.includes(Buffer.from(path)),'native binary contains a build-machine path')
})
it('packs and installs without task data and loads six tools/seven routes under plain Node',{skip:!process.env.npm_execpath?'run via npm so its CLI is explicitly available':false},()=>{
 const scratch=mkdtempSync(join(tmpdir(),'bf-packed-graph-'))
 try{
  const npm=args=>{const result=spawnSync(process.execPath,[process.env.npm_execpath,...args],{cwd:root,encoding:'utf8',timeout:60000});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);return result.stdout}
  const packed=JSON.parse(npm(['pack','--json','--ignore-scripts','--pack-destination',scratch]))[0]
  assert.ok(packed.files.some(row=>row.path==='lib/host/index.js'))
  assert.ok(packed.files.some(row=>row.path==='lib/native/win32-x64/browser-flow-graph.exe'))
  assert.ok(packed.files.some(row=>row.path==='native/graph-core/GO-LICENSE'))
  for(const row of packed.files)assert.ok(!/^(tasks|\.cache|\.evidence)\//.test(row.path)&&!/(^|\/)\.env/.test(row.path),row.path)
  writeFileSync(join(scratch,'package.json'),'{"private":true,"type":"module"}\n')
  npm(['install','--prefix',scratch,'--omit=dev','--ignore-scripts','--no-audit','--no-fund',join(scratch,packed.filename)])
  const program=`
    import assert from 'node:assert/strict';
    import {apply} from '@negentropy/dsh-browser-flow';
    const tools=new Map(),routes=new Map(),effects=[];
    const agent={id:'synthetic-session'};
    const ctx={profileContext:{name:'synthetic',home:process.cwd()},agents:{get:()=>agent},tools:{register:d=>{tools.set(d.name,d);return()=>tools.delete(d.name)}},connection:{fetch:{register:r=>{routes.set(r.path,r);return()=>routes.delete(r.path)}}},effect:f=>effects.push(f()),inject:(deps,f)=>f(ctx)};
    await apply(ctx,{});assert.equal(tools.size,6);assert.equal(routes.size,7);
    const value=await tools.get('browser_observe').execute({view:'task'},{agent,signal:new AbortController().signal});
    assert.equal(value.error.code,'task_not_bound');
    for(const dispose of effects.reverse())await dispose();assert.equal(tools.size,0);assert.equal(routes.size,0);
    process.stdout.write(JSON.stringify({tools:6,routes:7,plainNode:true,noTasks:true}));
  `
  const loaded=spawnSync(process.execPath,['--input-type=module','-e',program],{cwd:scratch,env:{...process.env,NODE_OPTIONS:''},encoding:'utf8',timeout:15000})
  assert.equal(loaded.error,undefined);assert.equal(loaded.status,0,loaded.stderr)
  assert.equal(JSON.parse(loaded.stdout).plainNode,true)
 }finally{rmSync(scratch,{recursive:true,force:true})}
})
