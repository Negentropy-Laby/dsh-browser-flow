/** Task-scoped panel presentation. Rendering never acquires control or dispatches commands. */
import type {ReactLike,DiscoveredPage} from './panel.ts'
import type {PanelUi,PanelTone} from './panel-ui.ts'
import type {TaskSummary,DefinitionOption,AgentSummary,FilePreview,PanelError} from './client-wire.ts'
import type {RunScope} from './task-scope.ts'
import {sameRunScope} from './task-scope.ts'

export interface TaskForm {goal:string;origins:string;definitionId:string;workflowRef:string}
export interface FileForm {path:string;kind:string;unitId:string;legalIdentity:string;firstRow:string;lastRow:string}
export type TaskOperation='create'|'open'|'revise'|'cancel'|'finish'|'resume'
export interface PanelViewModel {
 sessionId:string;supported:boolean;connected:boolean;liveAgent:boolean;agent?:AgentSummary;error?:PanelError
 task?:TaskSummary;pages:DiscoveredPage[];authorized?:string;busy:boolean;pending?:string
 taskForm:TaskForm;fileForm:FileForm;filePreview?:FilePreview;definitions:DefinitionOption[];userInput:string
 editing?:RunScope;moreOpen:boolean;detailsOpen:boolean;pageDetails:string[];errors:Record<string,string>
}
export interface PanelViewActions {
 task(operation:TaskOperation):void;authorize(page:DiscoveredPage):void;revoke():void
 edit():void;cancelEdit():void;reloadDraft():void;toggleMore():void;toggleDetails():void;togglePage(lease:string):void
 changeTask(key:keyof TaskForm,value:string):void;changeFile(key:keyof FileForm,value:string):void;changeUserInput(value:string):void
 file(operation:'prepare'|'confirm'):void
}
const states:Record<string,{key:string;tone:PanelTone}>={active:{key:'stateActive',tone:'info'},awaiting_user:{key:'waitingUser',tone:'warning'},read_only:{key:'stateReadOnly',tone:'neutral'},write_blocked:{key:'stateBlocked',tone:'danger'},cancelled:{key:'stateCancelled',tone:'neutral'},completed:{key:'stateCompleted',tone:'neutral'},handed_off:{key:'stateHandedOff',tone:'neutral'}}
/** @param state - Host lifecycle label, distinct from a business verdict. @returns Whether writes may depend on this known active lifecycle. */
export function activeTaskState(state:string):boolean{return state==='active'}
/** @param input - current task-scoped values and explicit user callbacks. @returns A compact single-column presentation with no effects or business authority. */
export function renderPanelView({h,ui,t,model:m,actions:a}:{h:ReactLike['createElement'];ui:PanelUi;t:(key:string)=>string;model:PanelViewModel;actions:PanelViewActions}):unknown {
 const button=ui.button,task=m.task,known=task?states[task.state]:undefined,waiting=task?.active_context?.waiting
 const canProvide=!!task&&['active','awaiting_user'].includes(task.state)&&!task.writeBlocked
 const editable=!!task&&activeTaskState(task.state)&&!task.writeBlocked,stale=!!task&&!!m.editing&&!sameRunScope(m.editing,task.task)
 const actionLabels:Record<string,string>={'task-create':'createTask','task-open':'openTask','task-revise':'reviseTask','task-cancel':'cancelTask','task-finish':'finishTask','task-resume':'resumeTask','prepare-file':'prepareFile'}
 const label=(key:string)=>m.pending===key?h('span',{className:'bf-status'},ui.dot('ongoing'),t('working')):t(actionLabels[key]??key)
 const action=(key:string,click:()=>void,disabled=false,primary=false)=>button({'data-browser-flow-action':key,onClick:click,disabled,'aria-busy':m.pending===key,variant:primary?'primary':'outline'},label(key))
 const field=(name:string,title:string,control:unknown)=>h('label',null,h('span',null,title),control,m.errors[name]?h('span',{className:'bf-field-error',role:'alert'},m.errors[name]):null)
 const selected=m.definitions.find(d=>d.id===m.taskForm.definitionId)
 const taskForm=h('div',{className:'bf-form','data-browser-flow-task-form':'',onKeyDown:(event:{key:string;currentTarget:HTMLElement;preventDefault:()=>void})=>{
  if(event.key==='Escape'&&m.editing){event.preventDefault();a.cancelEdit();event.currentTarget.closest('[data-browser-flow-task]')?.querySelector<HTMLButtonElement>('[data-browser-flow-action="editTask"]')?.focus()}
 }},
  !task?field('definitionId',t('taskDefinition'),h('select',{'data-browser-flow-input':'task-definition',value:m.taskForm.definitionId,disabled:m.busy,onChange:(e:{target:HTMLSelectElement})=>a.changeTask('definitionId',e.target.value)},h('option',{value:''},t('taskGeneric')),...m.definitions.map(d=>h('option',{key:d.id,value:d.id},d.id)))):null,
  field('goal',t('taskGoal'),h('textarea',{'data-browser-flow-input':'task-goal',value:m.taskForm.goal,disabled:m.busy||stale,maxLength:2000,'aria-invalid':!!m.errors.goal,onChange:(e:{target:HTMLTextAreaElement})=>a.changeTask('goal',e.target.value)})),
  (task?.adapter==='generic'||!task&&!selected)?field('origins',t('taskOrigins'),ui.input({'data-browser-flow-input':'task-origins',value:m.taskForm.origins,disabled:m.busy||stale,'aria-invalid':!!m.errors.origins,onChange:e=>a.changeTask('origins',e.target.value)})):null,
  !task&&selected?field('workflowRef',t('taskWorkflow'),h('select',{'data-browser-flow-input':'task-workflow',value:m.taskForm.workflowRef,disabled:m.busy,onChange:(e:{target:HTMLSelectElement})=>a.changeTask('workflowRef',e.target.value)},...selected.workflows.map(w=>h('option',{key:w.id,value:w.id},w.description)))):null,
  stale?h('div',{className:'bf-notice',role:'alert'},h('p',null,t('draftChanged')),action('reloadDraft',a.reloadDraft,m.busy)):null,
  h('div',{className:'bf-actions'},task?action('task-revise',()=>a.task('revise'),m.busy||stale||!editable||!m.connected,true):action('task-create',()=>a.task('create'),m.busy||!m.connected,true),task?action('cancelEdit',a.cancelEdit,m.busy):action('task-open',()=>a.task('open'),m.busy||!m.connected)))
 const taskPanel=h('section',{'data-browser-flow-task':'',className:'bf-section'},
  h('div',{className:'bf-section-heading'},h('h4',null,t('taskTitle')),task?ui.tag(known?.tone??'warning',t(known?.key??'stateUnknown')):ui.tag('neutral',t('stateUnbound'))),
  task?h('div',{'data-browser-flow-task-identity':'',className:'bf-task-goal'},task.goal):h('p',{className:'bf-secondary'},t('taskMissing')),
  !task||m.editing?taskForm:null,
  task?h('div',{className:'bf-actions'},action('editTask',m.editing?a.cancelEdit:a.edit,m.busy||!editable||!m.connected),h('div',{'data-browser-flow-disclosure':'task'},ui.disclosure({title:t('taskActions'),open:m.moreOpen,onToggle:a.toggleMore,children:h('div',{className:'bf-actions'},action('task-cancel',()=>a.task('cancel'),!m.connected||['cancelled','handed_off','completed'].includes(task.state)),action('task-finish',()=>a.task('finish'),!m.connected||['cancelled','handed_off','completed'].includes(task.state)))}))):null)
 const notices=h('div',{className:'bf-notices'},
  !m.supported?h('div',{role:'status',className:'bf-notice'},t('unsupportedHost')):null,
  m.supported&&!m.connected?h('div',{role:'status',className:'bf-notice'},t('disconnected')):null,
  m.connected&&!m.liveAgent?h('div',{role:'status',className:'bf-notice'},t('noAgent')):null,
  task&&!known?h('div',{role:'alert',className:'bf-notice'},t('unknownStateHint')):null,
  task?.writeBlocked?h('div',{role:'alert',className:'bf-notice bf-critical'},t(task.state==='read_only'?'taskReadOnly':'taskBlocked')):null,
  m.error?h('div',{role:'alert',className:'bf-notice bf-critical'},t('operationFailed')):null,
  waiting?h('section',{'data-browser-flow-user-wait':'',className:'bf-notice'},h('h4',null,t('waitingUser')),h('p',null,waiting.reason),h('p',{className:'bf-secondary'},waiting.resumeCondition),field('userInput',t('userInput'),ui.input({'data-browser-flow-input':'user-input',value:m.userInput,onChange:e=>a.changeUserInput(e.target.value),disabled:m.busy})),action('task-resume',()=>a.task('resume'),m.busy||!!task?.writeBlocked||!m.connected,true)):null)
 const pageRows=m.pages.map(page=>{
  const isAuthorized=m.authorized===page.lease,open=m.pageDetails.includes(page.lease)
  let origin=page.url;try{origin=new URL(page.url).origin;if(origin==='null')origin=page.url}catch{/* The page probe may return a non-HTTP document; Host policy still owns admission. */}
  return h('li',{key:page.lease,'data-browser-flow-page':page.lease,className:'bf-page'},h('div',{className:'bf-section-heading'},h('div',{className:'bf-page-title'},page.title||page.url),ui.tag(isAuthorized?'success':'neutral',t(isAuthorized?'authorized':'notAuthorized'))),h('p',{className:'bf-page-url'},origin),h('p',{className:'bf-page-alias'},t('pageAlias')+': '+page.tabId.slice(-12)),
   h('div',{'data-browser-flow-disclosure':page.lease},ui.disclosure({title:t('authorizationTarget'),open,onToggle:()=>a.togglePage(page.lease),children:h('dl',{className:'bf-identities'},h('dt',null,t('pageAddress')),h('dd',null,page.url),h('dt',null,t('pageAlias')),h('dd',null,page.tabId),h('dt',null,t('session')),h('dd',null,m.sessionId),h('dt',null,t('agentInstance')),h('dd',null,m.agent?.instance??t('agentUnavailable')))})),
   button({variant:isAuthorized?'outline':'primary','data-browser-flow-action':'authorize',disabled:m.busy||!m.supported||!m.connected||!m.liveAgent||!canProvide,onClick:()=>a.authorize(page),'aria-busy':m.pending==='authorize'},m.pending==='authorize'?label('authorize'):t(isAuthorized?'reauthorize':'authorize')))
 })
 const pagePanel=h('section',{className:'bf-section'},h('div',{className:'bf-section-heading'},h('h4',null,t('pagesTitle')),h('span',{className:'bf-secondary'},String(m.pages.length))),m.supported?(pageRows.length?h('ul',{className:'bf-pages'},...pageRows):h('div',{className:'bf-empty'},t('empty'))):null)
 const genericFile=task?.adapter==='generic'&&task.task.workflowRef==='exploration'
 const canFile=m.authorized&&((task?.adapter==='bjrsj'&&task.task.workflowRef==='import')||genericFile)&&canProvide
 const filePanel=canFile?h('section',{'data-browser-flow-import':'',className:'bf-section'},h('h4',null,t(genericFile?'genericFileTitle':'importTitle')),h('p',{className:'bf-secondary'},t(genericFile?'genericFileHint':'importHint')),
  field('path',t(genericFile?'genericFilePath':'file_path'),ui.input({'data-browser-flow-input':'path',value:m.fileForm.path,disabled:m.busy,onChange:e=>a.changeFile('path',e.target.value),autoComplete:'off'})),
  ...(!genericFile?[field('kind',t('file_kind'),h('select',{'data-browser-flow-input':'kind',value:m.fileForm.kind,disabled:m.busy,onChange:(e:{target:HTMLSelectElement})=>a.changeFile('kind',e.target.value)},...['add','modify','reduce'].map(kind=>h('option',{key:kind,value:kind},t('file_'+kind))))),
  ...(['unitId','legalIdentity'] as const).map(key=>field(key,t('file_'+key),ui.input({'data-browser-flow-input':key,value:m.fileForm[key],disabled:m.busy,onChange:e=>a.changeFile(key,e.target.value),autoComplete:'off'}))),
  h('div',{className:'bf-row'},...(['firstRow','lastRow'] as const).map(key=>field(key,t('file_'+key),ui.input({'data-browser-flow-input':key,type:'text',value:m.fileForm[key],disabled:m.busy,onChange:e=>a.changeFile(key,e.target.value)})))),
  ]:[]),
  action('prepare-file',()=>a.file('prepare'),m.busy,true),
  m.filePreview?h('div',{'data-browser-flow-file-preview':''},h('h4',null,t('fileReview')),h('p',{className:'bf-selectable'},m.filePreview.path),h('dl',{className:'bf-identities'},...(!genericFile?[h('dt',null,t('file_kind')),h('dd',null,t('file_'+m.filePreview.kind))]:[]),h('dt',null,t('fileSize')),h('dd',null,String(m.filePreview.bytes)+' '+t('bytes')),h('dt',null,t('fileRows')),h('dd',null,String(m.filePreview.rows)),h('dt',null,t('fileDigest')),h('dd',null,m.filePreview.sha256)),h('p',null,t(genericFile?'genericFileBoundary':'stopBoundary')),button({variant:'primary','data-browser-flow-action':'confirm-file',disabled:m.busy||m.filePreview.confirmed,onClick:()=>a.file('confirm'),'aria-busy':m.pending==='confirm-file'},t(m.filePreview.confirmed?'fileConfirmed':m.pending==='confirm-file'?'working':'confirmFile'))):null):null
 const details=h('section',{className:'bf-section bf-details','data-browser-flow-disclosure':'details'},ui.disclosure({title:t('detailsTitle'),open:m.detailsOpen,onToggle:a.toggleDetails,children:h('div',null,
  h('dl',{className:'bf-identities','data-browser-flow-target':''},h('dt',null,t('session')),h('dd',null,m.sessionId),h('dt',null,t('agentInstance')),h('dd',null,m.agent?.instance??t('agentUnavailable')),task?h('dt',null,t('taskId')):null,task?h('dd',null,task.task.taskId):null,task?h('dt',null,t('taskScope')):null,task?h('dd',null,String(task.task.scopeRevision)):null,task?h('dt',null,t('taskOrigins')):null,task?h('dd',null,task.origins.join(', ')):null),
  m.error?h('div',{'data-browser-flow-error-details':'',className:'bf-selectable'},h('p',null,m.error.code),h('p',null,m.error.message)):null,
  h('p',{className:'bf-note'},t('privacy')),h('p',{className:'bf-note'},t('limit')),h('p',{className:'bf-note'},t('revokeHint')))}))
 return h('section',{'data-browser-flow-panel':'','aria-label':t('title'),onKeyDown:(event:{key:string;target:HTMLElement;preventDefault:()=>void})=>{if(event.key!=='Escape')return;const row=event.target.closest<HTMLElement>('[data-browser-flow-disclosure]');if(!row)return;const key=row.dataset.browserFlowDisclosure;if(key==='details'&&m.detailsOpen)a.toggleDetails();else if(key==='task'&&m.moreOpen)a.toggleMore();else if(key&&m.pageDetails.includes(key))a.togglePage(key);else return;event.preventDefault();row.querySelector<HTMLElement>('[role="button"],button')?.focus()}},
  h('header',{className:'bf-header'},h('h3',null,t('title')),button({'data-browser-flow-action':'revoke',onClick:a.revoke,disabled:!m.supported,variant:'outline','aria-busy':m.pending==='revoke'},t(m.pending==='revoke'?'working':'revoke')),h('div',{className:'bf-header-status'},h('span',{className:'bf-status',role:'status'},ui.dot(m.connected?'done':'idle'),t(m.connected?'connected':'disconnected')),ui.tag(m.authorized?'success':'neutral',t(m.authorized?'authorized':'notAuthorized')))),
  h('div',{className:'bf-content'},taskPanel,notices,pagePanel,filePanel,details))
}
