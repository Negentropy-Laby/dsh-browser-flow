import assert from 'node:assert/strict'
import {it} from 'node:test'
import {renderPanelView,type PanelViewModel,type PanelViewActions} from '../src/panel-view.ts'
import {COPY,type ReactLike} from '../src/panel.ts'
import {fixturePanelUi} from './helpers/panel-ui.ts'
import {TASK,TASK_VIEW,runScope} from './helpers/task-scope.ts'
import {isRecord} from '../src/protocol.ts'

interface Node {type:unknown;props:Record<string,unknown>;children:unknown[]}
const h:ReactLike['createElement']=(type,props,...children)=>({type,props:props??{},children:children.flat()})
function nodes(value:unknown):Node[]{if(!isRecord(value)||!Array.isArray(value.children)||!isRecord(value.props))return [];const row={type:value.type,props:value.props,children:value.children};return [row,...row.children.flatMap(nodes)]}
function model(patch:Partial<PanelViewModel>={}):PanelViewModel{return {sessionId:'session-1',supported:true,connected:true,liveAgent:true,agent:{id:'session-1',instance:'agent-a'},task:TASK_VIEW,pages:[{lease:'guest-a',partition:'part-a',sessionId:'session-1',tabId:'tab-synthetic-one',url:'https://example.test/sheet',title:'Sheet',documentToken:'doc-a'}],busy:false,taskForm:{goal:'',origins:'',definitionId:'',workflowRef:''},fileForm:{path:'',kind:'add',unitId:'',legalIdentity:'',firstRow:'2',lastRow:'2'},definitions:[],userInput:'',moreOpen:false,detailsOpen:false,pageDetails:[],errors:{},...patch}}
function render(patch:Partial<PanelViewModel>={},calls:string[]=[]){
 const a:PanelViewActions={task:op=>{calls.push(op)},authorize:()=>{calls.push('authorize')},revoke:()=>{calls.push('revoke')},edit(){},cancelEdit(){},reloadDraft(){},toggleMore(){},toggleDetails(){},togglePage(){},changeTask(){},changeFile(){},changeUserInput(){},file(){}}
 return nodes(renderPanelView({h,ui:fixturePanelUi({createElement:h}),t:key=>COPY.en[key]??key,model:model(patch),actions:a}))
}
function action(rows:Node[],key:string){const row=rows.find(row=>row.props['data-browser-flow-action']===key);assert.ok(row,`missing ${key}`);return row}
const has=(rows:Node[],key:string)=>rows.some(row=>row.props[key]!==undefined)

it('shows a multiline creation form and a separate open operation only while unbound',()=>{
 const rows=render({task:undefined})
 assert.equal(rows.find(row=>row.props['data-browser-flow-input']==='task-goal')?.type,'textarea')
 action(rows,'task-create');action(rows,'task-open')
 assert.equal(has(render(),'data-browser-flow-task-form'),false)
 assert.equal(has(render({editing:TASK}),'data-browser-flow-task-form'),true)
})
it('orders fixed withdrawal before task, notices, pages and collapsible diagnostics',()=>{
 const calls:string[]=[],rows=render({busy:true,task:{...TASK_VIEW,writeBlocked:true}},calls)
 assert.ok(rows.findIndex(row=>row.props['data-browser-flow-action']==='revoke')<rows.findIndex(row=>row.props['data-browser-flow-task']!==undefined))
 assert.equal(action(rows,'revoke').props.disabled,false)
 ;(action(rows,'revoke').props.onClick as ()=>void)();assert.deepEqual(calls,['revoke'])
 assert.equal(has(rows,'data-browser-flow-target'),false)
 assert.equal(has(render({detailsOpen:true}),'data-browser-flow-target'),true)
})
for(const state of ['read_only','write_blocked','cancelled','handed_off','future_state'])it(`does not offer dependent writes for ${state}`,()=>{
 const rows=render({task:{...TASK_VIEW,state}})
 assert.equal(action(rows,'authorize').props.disabled,true)
 assert.equal(action(rows,'editTask').props.disabled,true)
 assert.equal(has(rows,'data-browser-flow-import'),false)
})
it('shows user wait reason, full resume condition and input without implying authorization',()=>{
 const rows=render({task:{...TASK_VIEW,state:'awaiting_user',active_context:{waiting:{id:'wait-a',reason:'Human input needed',resumeCondition:'Supply the missing synthetic input'}}}})
 assert.ok(rows.some(row=>row.children.includes('Human input needed')))
 assert.ok(rows.some(row=>row.children.includes('Supply the missing synthetic input')))
 action(rows,'task-resume');assert.ok(rows.some(row=>row.props['data-browser-flow-input']==='user-input'))
 assert.equal(action(rows,'authorize').props.disabled,false,'user must be able to supply requested page authorization')
})
it('requires a recognized import workflow and shows every file confirmation field',()=>{
 const filePreview={fileGrantId:'file-a',path:'<local-file>.xlsx',kind:'modify',bytes:8192,rows:7,sha256:'a'.repeat(64)}
 assert.equal(has(render({authorized:'guest-a',filePreview}),'data-browser-flow-import'),false)
 const task={...TASK_VIEW,task:runScope({...TASK,workflowRef:'import'})},rows=render({task,authorized:'guest-a',filePreview})
 assert.equal(has(rows,'data-browser-flow-import'),true)
 for(const text of [filePreview.path,filePreview.sha256,'7','8192 bytes',COPY.en.stopBoundary])assert.ok(rows.some(row=>row.children.includes(text)),text)
 action(rows,'confirm-file')
 assert.equal(has(render({task:{...task,state:'awaiting_user'},authorized:'guest-a'}),'data-browser-flow-import'),true,'waiting must permit human file preparation')
 assert.equal(has(render({task:{...task,writeBlocked:true},authorized:'guest-a',filePreview}),'data-browser-flow-import'),false)
})
it('refuses an old revision draft while leaving explicit reload and cancel available',()=>{
 const rows=render({editing:runScope({...TASK,scopeRevision:2})})
 assert.equal(action(rows,'task-revise').props.disabled,true)
 assert.equal(action(rows,'reloadDraft').props.disabled,false)
 assert.equal(action(rows,'cancelEdit').props.disabled,false)
})
it('keeps raw failure codes in expanded diagnostics and exposes safe connection states',()=>{
 const error={code:'synthetic_internal_code',message:'Private technical details'}
 assert.equal(render({error}).some(row=>row.children.includes(error.code)),false)
 assert.equal(render({error,detailsOpen:true}).some(row=>row.children.includes(error.code)),true)
 for(const patch of [{connected:false},{liveAgent:false}])assert.equal(action(render(patch),'authorize').props.disabled,true)
 assert.equal(render({supported:false}).some(row=>row.props['data-browser-flow-action']==='authorize'),false)
 assert.ok(render({pages:[]}).some(row=>row.children.includes(COPY.en.empty)))
})
it('distinguishes identical-address pages by full selectable identities on demand',()=>{
 const first=model().pages[0],second={...first,lease:'guest-b',tabId:'tab-synthetic-two'}
 const rows=render({pages:[first,second],pageDetails:['guest-a','guest-b']})
 for(const text of [first.tabId,second.tabId,first.url,'session-1','agent-a'])assert.ok(rows.some(row=>row.children.includes(text)),text)
 assert.equal(rows.filter(row=>row.props['data-browser-flow-action']==='authorize').length,2)
})
it('has translated labels for every rendered state and operation in both locales',()=>{
 const rows=render({task:undefined,detailsOpen:true})
 for(const row of rows)for(const child of row.children)if(typeof child==='string')assert.equal(/^(state[A-Z]|task-|prepare-file|detailsTitle)/.test(child),false,child)
 assert.deepEqual(Object.keys(COPY.en).sort(),Object.keys(COPY.zh).sort())
})
