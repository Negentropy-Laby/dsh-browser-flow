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
  rmSync(join(root,'.cache','desktop-js'),{recursive:true,force:true})
  rmSync(join(root,'.cache','desktop-programs.tsbuildinfo'),{force:true})
  for(const config of ['tsconfig.fixtures.json','tsconfig.desktop-programs.json']){
    const compiled=spawnSync(process.execPath,[join(root,'node_modules','typescript','bin','tsc'),'-p',join(root,config)],{cwd:root,stdio:'inherit'})
    if(compiled.status!==0)throw new Error('Synthetic fixture compilation failed')
  }
  mkdirSync(join(root,'.cache','fixtures'),{recursive:true})
  const programs:Record<string,string>={}
  for(const [file,symbols] of [['desktop-js/programs',['desktopIdentity','createImportFixture','executeFixturePage','fixtureRequests','destroyFixture','qualifyInstalledPackage']],['fixture-js/native-probes',['fixtureState','fixtureResponse','fixtureRestored']],['fixture-js/tool-fixtures',['installActionForm','installTableLoop']]] as const){
    for(const symbol of symbols)programs[symbol]=compiledFunction(join(root,'.cache',file+'.js'),symbol)
  }
  writeFileSync(join(root,'.cache','fixtures','programs.json'),JSON.stringify(programs)+'\n')
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
