/** Synchronize on actual command admission; no sleep or write retries. */
export async function throughPage<T>(service:import('../../src/index.ts').BrowserFlowService,start:()=>Promise<T>,pump:()=>unknown) {
  let admitted!:(value:boolean)=>void
  const ready=new Promise<boolean>(resolve=>{admitted=resolve})
  const original=service.state.run
  service.state.run=(...args)=>{const pending=original(...args);admitted(true);return pending}
  try {
    const pending=start()
    if(await Promise.race([ready,pending.then(()=>false)]))await pump()
    return await pending
  }finally{service.state.run=original}
}
