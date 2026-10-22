import { after } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskStore } from '../../src/task-store.ts'
import { syntheticDefinition } from './task-definition.ts'

/** Explicitly prepare a synthetic task for tests of an already-authorized page. */
export async function bindTestTask(service:import('../../src/index.ts').BrowserFlowService,sessionId='session-1',origins=['https://example.test'],adapter='generic') {
  if(!service.tasks.profileId){
    const root=await mkdtemp(join(tmpdir(),'bf-test-binding-'))
    const controlDocument=service.tasks.controlDocument
    service.tasks=new TaskStore(root,{name:'test',home:join(root,'home')},1000,service.graph,service.config)
    service.tasks.controlDocument=controlDocument
    after(async()=>{await service.close();await rm(root,{recursive:true,force:true})})
  }
  const existing=service.tasks.current(sessionId)
  if(existing)return existing
  if(adapter==='bjrsj'){
    const fixture=syntheticDefinition({root:service.tasks.root})
    const {writeFile}=await import('node:fs/promises')
    await writeFile(join(fixture.dir,'definition.json'),JSON.stringify({...fixture.definition,adapter:'bjrsj',origins,workflows:fixture.definition.workflows.map(row=>({...row,id:'import',stopBoundary:'import_confirmed'}))}))
    return service.tasks.create(sessionId,{definitionId:fixture.definition.id,workflowRef:'import',goal:'Synthetic verifier task'})
  }
  return service.tasks.create(sessionId,{goal:'Synthetic task',origins})
}
