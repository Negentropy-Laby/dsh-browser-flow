/** Test-only process provider; production uses the mounted Host service. */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
export const graphBinary=()=>({path:join(dirname(fileURLToPath(import.meta.url)),'..','..','.cache','graph-tests','worker'+(process.platform==='win32'?'.exe':'')),cwd:dirname(fileURLToPath(import.meta.url))})
export function graphRuntime(){
 const handles=[]
 return {handles,spawn(spec){
   const child=spawn(spec.argv[0],spec.argv.slice(1),{cwd:spec.cwd,stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}})
   let resolveDone,rejectDone;const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject})
   child.on('error',rejectDone);child.on('close',(code,signal)=>resolveDone({code,signal}));child.stderr.resume()
   const handle={stdin:child.stdin,stdout:child.stdout,done,terminate(){child.kill()},async waitForExit(){await done.catch(()=>{});return true},child}
   handles.push(handle);return handle
 }}
}
