/** Emit the Host face; installed profiles load plain ESM with no TypeScript loader. */
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=join(dirname(fileURLToPath(import.meta.url)),'..')
rmSync(join(root,'lib','host'),{recursive:true,force:true})
rmSync(join(root,'.cache','host.tsbuildinfo'),{force:true})
const result=spawnSync(process.execPath,[join(root,'node_modules','typescript','bin','tsc'),'-p',join(root,'tsconfig.host.json')],{cwd:root,stdio:'inherit'})
if(result.status!==0)process.exit(result.status??1)
