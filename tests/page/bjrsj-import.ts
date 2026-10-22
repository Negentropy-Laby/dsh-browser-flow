/** Synthetic page behavior compiled before fixture assembly. */
export function installImport(){

const options=new URLSearchParams(location.search);const kind=options.get('kind')||'add';const mode=options.get('mode')||'success';const transport=options.get('transport')||'xhr';
const labels: Record<string,string>={add:'批量增员',modify:'批量修改',reduce:'批量减员'};document.querySelector<HTMLElement>('#business')!.textContent=labels[mode==='wrong-tab'?'modify':kind];
const fixture={inputEvents:0,changeEvents:0,submitClicks:0};
document.querySelector<HTMLElement>('#submit')!.onclick=()=>fixture.submitClicks++;
document.querySelector<HTMLElement>('#unit')!.onclick=()=>fetch('/zhrs/api4/ggfw-server-yltc/unitSearch/queryUnitInfo',{method:'POST',body:'{}'}).then(response=>response.json());
Object.defineProperty(window,'fixture',{value:fixture,writable:true,enumerable:true,configurable:true});
const person={name:'测试甲',certificateNumber:'110101199001010011'};
function table(rejected:boolean,rows:{name:string;certificateNumber:string}[]){return '<div class="el-table"'+(rejected?' style="display:none"':'')+'><div class="el-table__header"><table><tr><th>姓名</th><th>证件号码</th><th>'+(rejected?'失败原因':'电子劳动合同')+'</th></tr></table></div><div class="el-table__body-wrapper"><table><tbody>'+rows.map(p=>'<tr><td>'+p.name+'</td><td>'+p.certificateNumber+'</td><td>'+(rejected?'测试拒绝':'')+'</td></tr>').join('')+'</tbody></table></div>'+(!rows.length?'<div class="el-table__empty-block">暂无数据</div>':'')+'</div>'}
function render(){document.querySelector<HTMLElement>('#tables')!.innerHTML=table(false,mode==='row-failure'?[]:[person])+table(true,mode==='row-failure'?[person]:[])}
render();
if(mode==='old-summary')document.querySelector<HTMLElement>('#message')!.innerHTML='<div class="el-message">导入有1条记录，成功1条，失败0条</div>';
function result(){if(mode!=='stale-tables')render();if(mode!=='old-summary')document.querySelector<HTMLElement>('#message')!.innerHTML='<div class="el-message">导入有1条记录，成功'+(mode==='row-failure'?0:1)+'条，失败'+(mode==='row-failure'?1:0)+'条</div>'}
const file=document.querySelector<HTMLInputElement>('input[type=file]')!;file.addEventListener('input',()=>fixture.inputEvents++);
file.addEventListener('change',async()=>{fixture.changeEvents++;const bytes=await file.files![0].arrayBuffer();const path='/zhrs/api4/ggfw-server-yltc/CommonBusiness/'+(kind==='modify'?'ThreeInOneModifyExcelCheck':'ThreeInOneExcelCheck');
  const send=()=>{if(transport==='fetch')return fetch(path,{method:'POST',body:bytes}).then(response=>response.text()).then(result);const xhr=new XMLHttpRequest();xhr.open('POST',path);xhr.addEventListener('load',result);xhr.send(bytes);};
  send();if(mode==='double-request')send();
});

}
