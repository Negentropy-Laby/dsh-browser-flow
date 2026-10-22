/** Explicit asynchronous barriers used by concurrency fixtures. */
/** @returns A promise and its explicitly controlled completion. */
export function deferred<T=void>(){
 let resolve!:(value:T|PromiseLike<T>)=>void
 const promise=new Promise<T>(done=>{resolve=done})
 return {promise,resolve}
}
