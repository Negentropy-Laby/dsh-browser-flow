/** Check Host/Client sources with the declared local compiler; absence is failure. */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const compiler=process.env.DSH_TSC??join(root,'node_modules','typescript','bin','tsc')
if(!existsSync(compiler))throw new Error('Install the declared TypeScript development dependency before typecheck')
for(const config of ['tsconfig.host.json','tsconfig.client.json','tsconfig.scripts.json','tsconfig.tests.json']){
  const result=spawnSync(process.execPath,[compiler,'-p',join(root,config),'--noEmit'],{cwd:root,stdio:'inherit'})
  if(result.status!==0)process.exit(result.status??1)
}
process.stdout.write('browser-flow: Host and Client typecheck clean\n')
