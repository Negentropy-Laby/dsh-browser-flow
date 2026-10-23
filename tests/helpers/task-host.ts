import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserFlowService } from '../../src/index.ts'
import { GraphWorkers } from '../../src/graph/worker.ts'
import { graphRuntime, graphBinary } from './graph-process.ts'
import { resolveConfig } from '../../src/config.ts'

export async function taskHost(t:import('node:test').TestContext) {
  const root=await mkdtemp(join(tmpdir(),'bf-task-host-'))
  const agents=new Map(['a','b'].map(id=>['session-'+id,{id:'session-'+id}]))
  const routes=new Map<string,import('../../src/index.ts').FetchRoute>(),tools=new Map<string,import('../../src/tools.ts').ToolDefinition>()
  const ctx:import('../../src/index.ts').HostContext={profileContext:{name:'test',home:join(root,'home')},agents:{get:id=>agents.get(id)},tools:{register:def=>{tools.set((def as import('../../src/tools.ts').ToolDefinition).name,def as import('../../src/tools.ts').ToolDefinition);return()=>tools.delete((def as import('../../src/tools.ts').ToolDefinition).name)}},connection:{fetch:{register:route=>{routes.set(route.path,route);return()=>routes.delete(route.path)}}},inject(deps,callback){callback(ctx)},logger:{info(){},warn(){},error(){}}}
  ctx.subprocess=graphRuntime()
  const config=resolveConfig({localTasksDir:root})
  const service=new BrowserFlowService(ctx,config,new GraphWorkers(config,graphBinary))
  service.start()
  const post=async (path:string,body:object)=>{
    const response=await routes.get('/api/browser-flow/'+path)!.fetch(new Request('http://host.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion:4,...body})}))
    return {status:response.status,body:await response.json()}
  }
  const page=(id:string)=>({lease:'guest-'+id,partition:'part-'+id,documentToken:'doc-'+id,url:'https://'+id+'.example/task'})
  const hello=async (id:string)=>post('hello',{kind:'hello',connectionGeneration:1,sessionId:'session-'+id,panel:{instanceId:'panel-'+id,pages:[page(id)]}})
  const task=async (id:string,spec:Record<string,unknown>={workflowRef:'generic',goal:'Private task '+id,origins:['https://'+id+'.example']})=>{
    await hello(id)
    return post('authorize',{instanceId:'panel-'+id,connectionGeneration:1,sessionId:'session-'+id,taskOperation:'create',spec})
  }
  const authorize=(id:string,scope?:import('../../src/task-scope.ts').RunScope)=>post('authorize',{instanceId:'panel-'+id,connectionGeneration:1,sessionId:'session-'+id,...page(id),...(scope?{task:scope}:{})})
  const tool=(id:string,name:string,args={})=>tools.get(name)!.execute(args,{agent:agents.get('session-'+id),signal:new AbortController().signal})
  t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true})})
  return {root,ctx,routes,service,post,page,hello,task,authorize,tool,agents}
}
