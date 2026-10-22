/** Read-only probes compiled in the DOM-only fixture program. */
export function fixtureState(){return {fixture:Reflect.get(window,'fixture'),url:location.origin,nativeFetch:Function.prototype.toString.call(fetch).includes('[native code]')}}
export function fixtureResponse(){
 const root:unknown=Reflect.get(window,'__dshBrowserFlow')
 if(root===null||typeof root!=='object'||!('importState' in root))return null
 const state=root.importState
 if(state===null||typeof state!=='object'||!('cache' in state))return null
 const cache=state.cache
 if(cache===null||typeof cache!=='object'||!('response' in cache))return null
 const response=cache.response
 if(response===null||typeof response!=='object'||!('url' in response)||!('status' in response))return null
 return {url:response.url,status:response.status}
}
export function fixtureRestored(){return Function.prototype.toString.call(fetch).includes('[native code]')&&Function.prototype.toString.call(XMLHttpRequest.prototype.send).includes('[native code]')}
