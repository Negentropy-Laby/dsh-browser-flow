/** Synchronize on actual command admission; no sleep or write retries. */
export async function throughPage(service,start,pump) {
  let admitted
  const ready=new Promise(resolve=>{admitted=resolve})
  const original=service.state.run
  service.state.run=(...args)=>{const pending=original(...args);admitted(true);return pending}
  try {
    const pending=start()
    if(await Promise.race([ready,pending.then(()=>false)]))await pump()
    return await pending
  }finally{service.state.run=original}
}
