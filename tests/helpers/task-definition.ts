import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Entirely synthetic declaration; no business resources or copied runbook. */
export function syntheticDefinition({root=mkdtempSync(join(tmpdir(),'browser-task-def-')),id='synthetic',origin='https://example.test',marker='SYNTHETIC_LOCAL_MARKER'}={}) {
  const dir=join(root,id)
  mkdirSync(join(dir,'instructions'),{recursive:true})
  const definition={schemaVersion:1,id,version:'1',adapter:'generic',adapterVersion:1,origins:[origin],resources:['instructions/steps.md'],workflows:[{id:'read',skill:id+'-read',description:'Synthetic read workflow',instructions:['instructions/steps.md'],resources:[],stopBoundary:'read_only'}]}
  writeFileSync(join(dir,'definition.json'),JSON.stringify(definition)+'\n')
  writeFileSync(join(dir,'instructions/steps.md'),'Observe the current page; stop before changing it. '+marker+'\n')
  return {root,dir,definition,marker}
}
