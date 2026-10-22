/** Synthetic second-guest behavior compiled before fixture assembly. */
export function installSecondPage(){
  document.getElementById('act')!.addEventListener('click',()=>{document.getElementById('marker')!.textContent='second page acted'})
}
