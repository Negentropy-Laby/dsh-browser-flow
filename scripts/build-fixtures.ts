/** Assemble synthetic HTML with tsc-compiled fixture behavior; no real task data is read. */
import {spawnSync} from 'node:child_process'
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {compiledFunction} from './build-page.ts'
const root=join(dirname(fileURLToPath(import.meta.url)),'..')
/** @returns Nothing; compiler or fixture mismatches fail the build. */
export function buildFixtures(): void {
  rmSync(join(root,'.cache','fixture-js'),{recursive:true,force:true})
  rmSync(join(root,'.cache','fixtures.tsbuildinfo'),{force:true})
  const compiled=spawnSync(process.execPath,[join(root,'node_modules','typescript','bin','tsc'),'-p',join(root,'tsconfig.fixtures.json')],{cwd:root,stdio:'inherit'})
  if(compiled.status!==0)throw new Error('Synthetic fixture compilation failed')
  mkdirSync(join(root,'.cache','fixtures'),{recursive:true})
  for(const [name,symbol] of [['dom-table','installDomTable'],['bjrsj-import','installImport'],['second-page','installSecondPage']]){
    const html=readFileSync(join(root,'fixtures',name+'.html'),'utf8')
    if(/<script\b|\son\w+\s*=/i.test(html))throw new Error('Tracked fixture HTML must contain no handwritten executable code')
    const program=compiledFunction(join(root,'.cache','fixture-js',name+'.js'),symbol)
    if(!html.includes('<!-- browser-flow fixture script -->'))throw new Error('Fixture script marker missing')
    writeFileSync(join(root,'.cache','fixtures',name+'.html'),html.replace('<!-- browser-flow fixture script -->',`<script>(${program})();</script>`))
  }
}
if(process.argv[1]!==undefined&&fileURLToPath(import.meta.url)===process.argv[1]){
  buildFixtures()
  process.stdout.write('browser-flow: synthetic TypeScript fixtures compiled\n')
}
