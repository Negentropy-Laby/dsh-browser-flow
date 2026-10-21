import assert from 'node:assert/strict'
import { it } from 'node:test'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { listDefinitions } from '../src/task-definitions.ts'
import { syntheticDefinition } from './helpers/task-definition.js'

it('isolates a definition whose skill name is invalid for the real Harness registry',()=>{
  const good=syntheticDefinition()
  try{
    const bad=syntheticDefinition({root:good.root,id:'bad'})
    writeFileSync(join(bad.dir,'definition.json'),JSON.stringify({...bad.definition,workflows:bad.definition.workflows.map(row=>({...row,skill:'INVALID_SKILL'}))}))
    assert.deepEqual(listDefinitions(good.root).map(snapshot=>snapshot.definition.id),['synthetic'])
  }finally{rmSync(good.root,{recursive:true,force:true})}
})
