/** Self-contained DOM behavior for tool-layer synthetic forms. */
export function installActionForm(){
 const status=document.getElementById('status')!
 const mode=document.querySelector<HTMLSelectElement>('#mode')!
 const notify=document.querySelector<HTMLInputElement>('#notify')!
 mode.addEventListener('change',()=>{status.textContent='mode:'+mode.value})
 notify.addEventListener('change',()=>{status.textContent='notify:'+String(notify.checked)})
 document.addEventListener('browser-flow-fixture-ready',()=>{status.textContent='ready'},{once:true})
}
/** Save behavior is owned by the synthetic page, independently of Browser Flow. */
export function installTableLoop(){
 document.getElementById('save')!.addEventListener('click',()=>{
  const values=Array.from(document.querySelectorAll<HTMLInputElement>('#inv input'),input=>input.value)
  document.getElementById('status')!.textContent='saved:'+values.join(',')
 })
}
