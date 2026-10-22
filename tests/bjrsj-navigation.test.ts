import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { definitionSkills, loadDefinition, listDefinitions, tasksRoot } from '../src/task-definitions.ts'
import { syntheticDefinition } from './helpers/task-definition.ts'

describe('local declarative task definitions',()=>{
  it('loads without local definitions and does not fall back to bundled Beijing data',()=>{
    assert.deepEqual(listDefinitions(undefined),[])
    assert.deepEqual(listDefinitions('/missing-browser-flow-definitions'),[])
    assert.equal(tasksRoot('',undefined),undefined)
    assert.equal(tasksRoot('',{home:'/profile',name:'desktop'}),join('/profile','browser-flow','tasks'))
  })
  it('isolates invalid entries, preserves content and only registers explicit entrypoints',()=>{
    const fixture=syntheticDefinition()
    try {
      mkdirSync(join(fixture.root,'bad'))
      writeFileSync(join(fixture.root,'bad/definition.json'),'{}')
      const invalid:string[]=[]
      const snapshots=listDefinitions(fixture.root,id=>invalid.push(id))
      assert.deepEqual(invalid,['bad'])
      assert.equal(snapshots.length,1)
      const skill=definitionSkills(snapshots[0])[0]
      assert.deepEqual(skill.invocation,{modelInvocable:false,userInvocable:true})
      assert.match(skill.content,/view="task"/)
      assert.ok(!skill.content.includes(fixture.marker),'entrypoint does not smuggle mutable local instructions')
      assert.ok(snapshots[0].files['instructions/steps.md'].includes(fixture.marker))
    } finally {rmSync(fixture.root,{recursive:true,force:true})}
  })
  it('rejects arbitrary code, resource escape, links, and weakened trusted origin',()=>{
    const fixture=syntheticDefinition()
    const path=join(fixture.dir,'definition.json')
    try {
      for(const patch of [{module:'evil.js'},{resources:['../outside']},{adapter:'bjrsj'},{adapterVersion:2},{resources:['/outside']}] as const){
        writeFileSync(path,JSON.stringify({...fixture.definition,...patch}))
        assert.throws(()=>loadDefinition(fixture.root,fixture.definition.id))
      }
      writeFileSync(path,JSON.stringify(fixture.definition))
      rmSync(join(fixture.dir,'instructions/steps.md'))
      symlinkSync(path,join(fixture.dir,'instructions/steps.md'))
      assert.throws(()=>loadDefinition(fixture.root,fixture.definition.id),/link/)
    } finally {rmSync(fixture.root,{recursive:true,force:true})}
  })
  it('uses a package whitelist without local task resources',()=>{
    const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
    assert.ok(manifest.files.includes('lib'))
    assert.ok(!manifest.files.includes('src'))
    assert.ok(!manifest.files.includes('tasks'))
    assert.ok(!manifest.files.includes('sites'))
    assert.ok(!readFileSync(new URL('../lib/client.js',import.meta.url),'utf8').includes('SYNTHETIC_LOCAL_MARKER'))
  })
})
