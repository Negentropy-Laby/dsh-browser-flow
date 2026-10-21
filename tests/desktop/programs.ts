/** Node-side fixed Electron fixture programs; compiled before serialization. */
interface FixtureWindow {id:number;webContents:{executeJavaScript(source:string,userGesture:boolean):Promise<unknown>};loadURL(url:string):Promise<void>;destroy():void}
interface ElectronPort {
 app:{getAppPath():string;getVersion():string}
 BrowserWindow:{new(options:object):FixtureWindow;fromId(id:number):FixtureWindow|null}
 session:{fromPartition(partition:string):{protocol:{handle(scheme:string,handler:(request:Request)=>Promise<Response>):Promise<void>}}}
}
interface FixtureInput {token:string;requestKey:string;mode:string;html:string;people:{name:string;certificateNumber:string}[];kind:string;transport:string}
export function desktopIdentity(e:ElectronPort){return {pid:process.pid,versions:process.versions,appPath:e.app.getAppPath(),appVersion:e.app.getVersion()}}
export async function createImportFixture(e:ElectronPort,input:FixtureInput){
 const {token,requestKey,mode,html,people,kind,transport}=input
 const s=e.session.fromPartition('bf-import-fixture-'+token),calls:Record<string,unknown>[]=[]
 await s.protocol.handle('https',async request=>{
  const u=new URL(request.url)
  if(u.origin==='https://redirect-fixture.invalid')return Response.json({appcode:'0',map:{data:people.map(p=>({...p,validateStatus:'1',errorMessage:''}))}},{headers:{'access-control-allow-origin':'https://fuwu.rsj.beijing.gov.cn'}})
  if(u.origin!=='https://fuwu.rsj.beijing.gov.cn')return new Response('blocked',{status:403})
  if(u.pathname==='/fixture')return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}})
  if(u.pathname.toLowerCase().endsWith('/unitsearch/queryunitinfo')){calls.push({type:'unit'});return Response.json({map:{data:[{unitDTO:{unitId:'UNIT1',socialCreditCode:'123456789012345678'}}]}})}
  if(u.pathname.includes('ExcelCheck')){
   const body=Buffer.from(await request.arrayBuffer()),hash=process.getBuiltinModule('crypto').createHash('sha256').update(body).digest('hex')
   calls.push({type:'check',method:request.method,path:u.pathname,bytes:body.length,sha256:hash})
   if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://redirect-fixture.invalid/result'}})
   const envelope={appcode:'0',map:{data:people.map(p=>({...p,validateStatus:mode==='row-failure'?'0':'1',errorMessage:mode==='row-failure'?'测试拒绝':''}))}}
   return new Response(JSON.stringify(envelope)+(mode==='oversized'?' '.repeat(200000):''),{headers:{'content-type':'application/json'}})
  }
  return new Response('missing',{status:404})
 })
 const w=new e.BrowserWindow({show:false,width:1000,height:800,webPreferences:{partition:'bf-import-fixture-'+token,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
 Object.defineProperty(w,requestKey,{value:calls})
 await w.loadURL('https://fuwu.rsj.beijing.gov.cn/fixture?kind='+kind+'&transport='+transport+'&mode='+mode)
 return w.id
}
export function executeFixturePage(e:ElectronPort,id:number,source:string){const w=e.BrowserWindow.fromId(id);if(!w)throw new Error('fixture missing');return w.webContents.executeJavaScript(source,true)}
export function fixtureRequests(e:ElectronPort,id:number,key:string) {const w=e.BrowserWindow.fromId(id);if(!w)throw new Error('fixture missing');return Reflect.get(w,key)}
export function destroyFixture(e:ElectronPort,id:number){e.BrowserWindow.fromId(id)?.destroy();return true}
/** Installation probe runs under plain Node from a generated file in the isolated install. */
export async function qualifyInstalledPackage(){
 const assert:typeof import('node:assert/strict')=process.getBuiltinModule('assert/strict')
 const name:string='@negentropy/dsh-browser-flow',plugin=await import(name)
 interface Tool {name:string;execute(args:object,exec:{agent:{id:string};signal:AbortSignal}):Promise<unknown>}
 interface Route {path:string}
 const tools=new Map<string,Tool>(),routes=new Map<string,Route>(),effects:(void|(()=>void|Promise<void>))[]=[]
 const agent={id:'synthetic-session'}
 const ctx={profileContext:{name:'synthetic',home:process.cwd()},agents:{get:()=>agent},
  tools:{register(d:Tool){tools.set(d.name,d);return()=>tools.delete(d.name)}},
  connection:{fetch:{register(r:Route){routes.set(r.path,r);return()=>routes.delete(r.path)}}},
  effect(f:()=>void|(()=>void|Promise<void>)){effects.push(f())},inject(_deps:string[],f:(scope:object)=>void){f(ctx)}}
 await plugin.apply(ctx,{})
 assert.equal(tools.size,6);assert.equal(routes.size,7)
 const value=await tools.get('browser_observe')!.execute({view:'task'},{agent,signal:new AbortController().signal})
 assert.ok(value&&typeof value==='object'&&'error' in value)
 const error=value.error;assert.ok(error&&typeof error==='object'&&'code' in error);assert.equal(error.code,'task_not_bound')
 for(const dispose of effects.reverse())if(dispose)await dispose()
 assert.equal(tools.size,0);assert.equal(routes.size,0)
 process.stdout.write(JSON.stringify({tools:6,routes:7,plainNode:true,noTasks:true}))
}
