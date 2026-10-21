/** Build the owned helper; runtime never downloads Go or searches for executables. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const source=join(root,'native','graph-core')
const version=spawnSync('go',['version'],{env:{...process.env,GOTOOLCHAIN:'local'},encoding:'utf8'})
if(version.status!==0||!version.stdout.startsWith('go version go1.26.5 '))throw new Error('Build requires Go 1.26.5; runtime installation does not require Go')
const testing=process.argv.includes('--test-helper')
const os=testing?(process.platform==='win32'?'windows':process.platform):'windows'
const target=testing?join(root,'.cache','graph-tests','worker'+(process.platform==='win32'?'.exe':'')):join(root,'lib','native','win32-x64','browser-flow-graph.exe')
mkdirSync(dirname(target),{recursive:true})
const flags=['-trimpath','-buildvcs=false','-ldflags=-s -w -buildid=']
const result=spawnSync('go',['build',...flags,'-o',target,'./cmd/worker'],{cwd:source,env:{...process.env,GOTOOLCHAIN:'local',CGO_ENABLED:'0',GOOS:os,GOARCH:testing?process.arch==='arm64'?'arm64':'amd64':'amd64'},stdio:'inherit'})
if(result.status!==0)process.exit(result.status??1)
if(!testing){
 const hash=createHash('sha256')
 function visit(dir){for(const item of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(dir,item.name);if(item.isDirectory())visit(path);else if(item.name.endsWith('.go')||item.name==='go.mod'){hash.update(relative(source,path).replaceAll('\\','/'));hash.update(readFileSync(path))}}}
 visit(source)
 writeFileSync(join(root,'lib','native','manifest.json'),JSON.stringify({protocolVersion:1,kernelVersion:'1',rulesVersion:'structural-v1',goVersion:'go1.26.5',platform:'win32',arch:'x64',flags,sourceSha256:hash.digest('hex'),sha256:createHash('sha256').update(readFileSync(target)).digest('hex')},null,2)+'\n')
}
process.stdout.write('graph helper built: '+(testing?'test host':'Windows x64')+'\n')
