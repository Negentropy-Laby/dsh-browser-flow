/** Test-only process provider; production uses the mounted Host service. */
import { spawn,type ChildProcessWithoutNullStreams } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {ProcessHandle,SubprocessPort} from '../../src/graph/protocol.ts'
export const graphBinary=()=>({path:join(dirname(fileURLToPath(import.meta.url)),'..','..','.cache','graph-tests','worker'+(process.platform==='win32'?'.exe':'')),cwd:dirname(fileURLToPath(import.meta.url))})
export function graphRuntime(){
 const handles:(ProcessHandle & {child:ChildProcessWithoutNullStreams})[]=[]
 return {handles,spawn(spec:Parameters<SubprocessPort['spawn']>[0]){
   const child=spawn(spec.argv[0],spec.argv.slice(1),{cwd:spec.cwd,stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}})
   const done=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}))})
   child.stderr.resume()
   const handle={stdin:child.stdin,stdout:child.stdout,done,terminate(){child.kill()},async waitForExit(){await done.catch(()=>{});return true},child}
   handles.push(handle);return handle
 }}
}
