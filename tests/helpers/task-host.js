import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserFlowService } from '../../src/index.js'
import { resolveConfig } from '../../src/config.js'

export async function taskHost(t) {
  const root=await mkdtemp(join(tmpdir(),'bf-task-host-'))
  const agents=new Map(['a','b'].map(id=>['session-'+id,{id:'session-'+id}]))
  const routes=new Map(),tools=new Map()
  const ctx={profileContext:{name:'test',home:join(root,'home')},agents:{get:id=>agents.get(id)},tools:{register:def=>{tools.set(def.name,def);return()=>tools.delete(def.name)}},connection:{fetch:{register:route=>{routes.set(route.path,route);return()=>routes.delete(route.path)}}},inject(deps,callback){callback(ctx)},logger:{info(){},warn(){},error(){}}}
  const service=new BrowserFlowService(ctx,resolveConfig({localTasksDir:root}))
  service.start()
  const post=async (path,body)=>{
    const response=await routes.get('/api/browser-flow/'+path).fetch(new Request('http://host.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion:3,...body})}))
    return {status:response.status,body:await response.json()}
  }
  const page=id=>({lease:'guest-'+id,partition:'part-'+id,documentToken:'doc-'+id,url:'https://'+id+'.example/task'})
  const hello=async id=>post('hello',{kind:'hello',connectionGeneration:1,sessionId:'session-'+id,panel:{instanceId:'panel-'+id,pages:[page(id)]}})
  const task=async (id,spec={goal:'Private task '+id,origins:['https://'+id+'.example']})=>{
    await hello(id)
    return post('authorize',{instanceId:'panel-'+id,connectionGeneration:1,sessionId:'session-'+id,taskOperation:'create',spec})
  }
  const authorize=(id,scope)=>post('authorize',{instanceId:'panel-'+id,connectionGeneration:1,sessionId:'session-'+id,...page(id),...(scope?{task:scope}:{})})
  const tool=(id,name,args={})=>tools.get(name).execute(args,{agent:agents.get('session-'+id),signal:new AbortController().signal})
  t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true})})
  return {root,ctx,service,post,page,hello,task,authorize,tool,agents}
}
