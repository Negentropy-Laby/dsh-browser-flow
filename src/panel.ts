import type {PanelUi,PanelElementType} from './panel-ui.ts'
import type {RunScope} from './task-scope.ts'
import {renderPanelView,type TaskForm,type FileForm,type TaskOperation} from './panel-view.ts'
import type {PagePolicy} from './page/input.ts'
interface GuestElement extends HTMLElement {executeJavaScript(source:string,userGesture?:boolean):Promise<unknown>}
interface PanelBinding {task:RunScope;lease:string;partition:string;tabId:string;controlLeaseId:string;epoch:number;documentToken:string;url?:string;expectedSequence:number;element?:GuestElement;pagePolicy?:PagePolicy;origins?:string[];importOwner?:string}
import {decodePanelReply,isTaskSummary,isFilePreview,type TaskSummary,type AgentSummary,type DefinitionOption,type FilePreview,type PanelError,type PanelReply,type PanelCommand} from './client-wire.ts'
export interface ReactLike {
 createElement(type:PanelElementType,props:object|null,...children:unknown[]):unknown
 useState<T>(initial:T|(()=>T)):[T,(next:T|((previous:T)=>T))=>void]
 useRef<T>(initial:T):{current:T}
 useMemo<T>(factory:()=>T,deps?:readonly unknown[]):T
 useCallback<T extends (...args:never[])=>unknown>(callback:T,deps?:readonly unknown[]):T
 useEffect(callback:()=>void|(()=>void),deps?:readonly unknown[]):void
}
export type PagePrograms = {
    identity: string;
    observe: (maxChars: number, maxNodes: number) => string;
    find: (query: object, limit: number) => string;
    act: (input: object) => string;
    wait: (input: object) => string;
    import?: ((input: object) => string) | undefined;
};
export type ClientHelpers = typeof CORE;
export type DiscoveredPage = {
    lease: string;
    partition: string;
    sessionId: string;
    tabId: string;
    url: string;
    title: string;
    documentToken: string;
};

/**
 * The Browser Flow panel component.
 *
 * This is a normal ES module so it can be imported and tested directly. The
 * client build inlines it (with `pagecode.ts` and `clientcore.ts`) into the
 * shipped lazy-CJS bundle, so the code the browser runs and the code the tests
 * exercise are the same text.
 *
 * The panel never grants control by itself: it lists the live pages it can see,
 * asks the Host to authorize the one the user clicks, runs the fixed page
 * programs for commands the Host dispatches, and returns results carrying the
 * Host-assigned generation, epoch and sequence.
 *
 * @module @negentropy/dsh-browser-flow/panel
 */

import {
  WEBVIEW_SELECTOR, capToBudget, classifyResult, classifyThrow, hostSupportsPageControl, identityOf,
  indistinguishableFrom,
  navigationEvent,
  programFor, refuseCommand,
} from './clientcore.ts'
import { actProgram, findProgram, identityProgram, observeProgram, waitProgram } from './pagecode.ts'
import { importProgram } from './import-page.ts'
import { validRunScope, sameRunScope } from './task-scope.ts'
import { isRecord, PROTOCOL_VERSION, validateCommand } from './protocol.ts'

/** Locale namespace owned by this plugin. */
export const NS = 'browserFlow'

/** Host routes, relative to the authenticated application origin. */
export const ROUTES = Object.freeze({
  hello: '/api/browser-flow/hello',
  poll: '/api/browser-flow/poll',
  result: '/api/browser-flow/result',
  invalidate: '/api/browser-flow/invalidate',
  authorize: '/api/browser-flow/authorize',
  revoke: '/api/browser-flow/revoke',
  status: '/api/browser-flow/status',
})

/** Poll interval, in milliseconds. */
export const POLL_INTERVAL_MS = 700





/** Page-program builders, as the panel consumes them. @type {PagePrograms} */
export const PAGE_CODE: PagePrograms = Object.freeze({
  identity: identityProgram(),
  import: input => importProgram(((input) as import('./page/input.ts').ImportInput)),
  observe: (maxChars, maxNodes) => observeProgram(maxChars, maxNodes),
  find: (query, limit) => findProgram(((query) as {
    by: 'text' | 'attr' | 'role';
    value: string;
    name?: string;
}), limit),
  act: input => actProgram(((input) as import('./page/input.ts').PageActionInput)),
  wait: input => waitProgram(((input) as import('./page/input.ts').PageWaitInput)),
})





/** Client helpers, as the panel consumes them. @type {ClientHelpers} */
export const CORE = Object.freeze({
  WEBVIEW_SELECTOR, programFor, identityOf, classifyResult, classifyThrow, hostSupportsPageControl,
})

/**
 * Locale dictionaries for the panel.
 * @type {{ zh: Record<string, string>, en: Record<string, string> }}
 */
export const COPY: {
    zh: Record<string, string>;
    en: Record<string, string>;
} = Object.freeze({
  zh: {
    "stateActive":"进行中","stateReadOnly":"只读记录","stateBlocked":"写操作已阻断","stateCancelled":"已取消","stateHandedOff":"已交接","stateUnknown":"无法识别的状态","stateUnbound":"未绑定","notAuthorized":"未授权","reauthorize":"重新授权","pagesTitle":"控制页面","authorizationTarget":"授权对象详情","pageAddress":"完整地址","agentUnavailable":"暂无 Agent","taskActions":"任务操作","editTask":"编辑目标与范围","cancelEdit":"取消编辑","reloadDraft":"重新加载当前任务","draftChanged":"任务范围已变化。请重新加载当前任务后编辑。","operationFailed":"操作未完成。请查看下方诊断详情，并核对当前连接和权限。","unknownStateHint":"无法识别任务状态，请配套重载 Host 和 Client。当前仅允许安全读取、撤销和交接。","working":"处理中…","fileReview":"请确认文件摘要","fileSize":"文件大小","fileRows":"解析数据行数","fileDigest":"SHA-256","detailsTitle":"详情与诊断","taskId":"任务标识","taskScope":"范围版本","goalRequired":"请填写任务目标。","originsRequired":"请填写完整的 HTTP(S) 源站，以逗号分隔；不包含路径。","definitionRequired":"此本地定义不可用，请重新选择。","workflowRequired":"请为所选定义选择有效的操作说明。",
    resumeTask:'核对新输入并继续', userInput:'新提供的人工输入', waitingUser:'等待用户', taskReadOnly:'旧任务记录只读；请使用新会话开始新任务。',
    taskTitle:'当前任务', taskGoal:'目标', taskOrigins:'允许的源站（以逗号分隔）', taskDefinition:'本地任务定义', taskGeneric:'通用任务', taskWorkflow:'操作说明', createTask:'创建并绑定任务', openTask:'打开本会话任务', reviseTask:'修订目标与范围', cancelTask:'取消任务并撤销', finishTask:'结束并人工交接', invalidReply: 'Host 响应无效，请配套重载 Host 和 Client',
    taskMissing:'先创建或打开当前会话的任务，再授权页面。', taskBlocked:'此任务的写结果未知或日志不可用：仅允许读取、撤销及人工交接。',
    title: '浏览器控制', connected:'已连接',
    empty: '没有可授权的 Browser 页面。先在右侧打开一个网页。',
    authorize: '授权控制',
    revoke: '撤销控制',
    authorized: '已授权',
    noAgent: '该会话当前没有运行的 Agent；先让该会话的 Agent 运行一次。',
    disconnected: '未连接宿主。',
    error: '失败',
    privacy: '页面文本会送入当前 Agent 会话；已识别的敏感字段不会回显。',
    limit: '仅支持主文档 DOM；不支持截图、跨域 iframe、canvas 表格与隐藏页面输入。',
    unsupportedHost: '该宿主不支持同页控制：Web 端的 Browser 是跨域 iframe，无法执行页面程序。',
    revokeHint: '撤销只解除控制，页面与登录状态保留。',
    guideDescription: '授权并控制右侧 Browser 中已打开的页面',
    importTitle: '北京社保授权导入',
    importHint: '指定本地文件后核对摘要；确认只允许一次选文件及站点校验，最终提交仍由你完成。',
    file_path: '本地 XLSX 完整路径', file_unitId: '预期单位编号', file_legalIdentity: '统一社会信用代码', file_firstRow: '数据起始行', file_lastRow: '数据结束行', file_kind: '业务类型',
    file_add: '批量增员', file_modify: '批量修改', file_reduce: '批量减员',
    prepareFile: '读取并核对文件', confirmFile: '确认这一次文件授权', fileConfirmed: '文件已确认', rows: '行', bytes: '字节',
    stopBoundary: '停止于 import_confirmed；不保存待办、不最终提交。',
    cleanupFailed: '页面观察器清理尚未确认；本次运行不能记为完整通过。',
    pageAlias: '页面标识',
    session: '会话',
    agentInstance: 'Agent 实例',
  },
  en: {
    "stateActive":"In progress","stateReadOnly":"Read-only history","stateBlocked":"Writes blocked","stateCancelled":"Cancelled","stateHandedOff":"Handed off","stateUnknown":"Unrecognized state","stateUnbound":"Not bound","notAuthorized":"Not authorized","reauthorize":"Authorize again","pagesTitle":"Controlled pages","authorizationTarget":"Authorization target details","pageAddress":"Full address","agentUnavailable":"No Agent","taskActions":"Task actions","editTask":"Edit goal and scope","cancelEdit":"Cancel editing","reloadDraft":"Reload current task","draftChanged":"The task scope changed. Reload the current task before editing.","operationFailed":"The operation did not complete. Review the diagnostics below and check the connection and permissions.","unknownStateHint":"Unrecognized task state. Reload the paired Host and Client. Only safe reads, revocation and handoff remain available.","working":"Working\u2026","fileReview":"Confirm the file summary","fileSize":"File size","fileRows":"Parsed data rows","fileDigest":"SHA-256","detailsTitle":"Details and diagnostics","taskId":"Task ID","taskScope":"Scope revision","goalRequired":"Enter a task goal.","originsRequired":"Enter full HTTP(S) origins separated by commas, without paths.","definitionRequired":"This local definition is unavailable. Select it again.","workflowRequired":"Select valid instructions for this definition.",
    resumeTask:'Check new input and resume', userInput:'New user input', waitingUser:'Awaiting user', taskReadOnly:'Legacy history is read-only; start new work in a new Session.',
    taskTitle:'Current task', taskGoal:'Goal', taskOrigins:'Allowed origins (comma separated)', taskDefinition:'Local definition', taskGeneric:'Generic task', taskWorkflow:'Instructions', createTask:'Create and bind task', openTask:'Open this session’s task', reviseTask:'Revise goal and scope', cancelTask:'Cancel task and revoke', finishTask:'End and hand off', invalidReply:'Host response is invalid; reload the paired Host and Client', taskMissing:'Create or open this session’s task before authorizing a page.', taskBlocked:'Unknown write or unavailable log: only read, revoke and hand off.',
    title: 'Browser Flow', connected:'Connected',
    empty: 'No Browser page to authorize. Open a page in the right sidebar first.',
    authorize: 'Authorize control',
    revoke: 'Revoke control',
    authorized: 'Authorized',
    noAgent: 'This session has no running Agent; let the session\'s Agent run once.',
    disconnected: 'Not connected to the Host.',
    error: 'Failure',
    privacy: 'Page text is sent to the current Agent session; recognized sensitive fields are never echoed.',
    limit: 'Main-document DOM only; no screenshots, cross-origin frames, canvas tables or hidden-page input.',
    unsupportedHost: 'This host cannot control the same page: the Web Browser is a cross-origin iframe, so page programs cannot run.',
    revokeHint: 'Revoking only detaches control; the page and its login state are kept.',
    guideDescription: 'Authorize and control a page open in the right-side Browser',
    pageAlias: 'Page id',
    session: 'Session',
    agentInstance: 'Agent instance',
    importTitle: 'Beijing authorized import',
    importHint: 'Review the local file summary. Confirmation permits one file selection and site validation; final submission remains yours.',
    file_path: 'Full local XLSX path', file_unitId: 'Expected unit number', file_legalIdentity: 'Unified social credit code', file_firstRow: 'First data row', file_lastRow: 'Last data row', file_kind: 'Business type',
    file_add: 'Batch add', file_modify: 'Batch modify', file_reduce: 'Batch reduce',
    prepareFile: 'Read and review file', confirmFile: 'Confirm this one file grant', fileConfirmed: 'File confirmed', rows: 'rows', bytes: 'bytes',
    stopBoundary: 'Stop at import_confirmed; do not save pending records or submit.',
    cleanupFailed: 'Page observer cleanup is unconfirmed; this run cannot qualify as complete.',
  },
})

/**
 * Build the panel component for one locale binding and React instance.
 * @param {object} input - component inputs.
 * @param {ReactLike} input.React - platform React.
 * @param {(key: string) => string} input.t - locale lookup.
 * @param {PanelUi} input.ui - typed Host controls; owns presentation only.
 * @param {ClientHelpers} [input.core] - client helpers; defaults to {@link CORE}.
 * @param {PagePrograms} [input.pageCode] - page programs; defaults to {@link PAGE_CODE}.
 * @returns {Function} React component.
 */
export function createPanel({ React, t, ui, core = CORE, pageCode = PAGE_CODE }: {React:ReactLike;t:(key:string)=>string;ui:PanelUi;core?:ClientHelpers;pageCode?:PagePrograms}) {
  const h = React.createElement

  /**
   * One panel instance: page discovery, authorization and the command loop.
   * @param {{ sessionId: string, useTabInfo?: () => { tab: { kind: string } } }} props - slot props.
   * @returns {unknown} element tree.
   */
  return function Panel(props: {
    sessionId: string;
    useTabInfo?: () => {
        tab: {
            kind: string;
        };
    };
}) {
    const sessionId = props.sessionId
    if(typeof props.useTabInfo==='function')props.useTabInfo()

    const [pages, setPages] = React.useState((([]) as DiscoveredPage[]))
    const [connected, setConnected] = React.useState(false)
    const [liveAgent, setLiveAgent] = React.useState(false)

    const [agentSummary, setAgentSummary] = React.useState<AgentSummary|undefined>(undefined)
    const [error, setError] = React.useState<PanelError|undefined>(undefined)
    const [authorized, setAuthorized] = React.useState<string|undefined>(undefined)
    const [busy, setBusy] = React.useState(false)
    const [fileForm,setFileForm] = React.useState<FileForm>({path:'',kind:'add',unitId:'',legalIdentity:'',firstRow:'2',lastRow:'2'})
    const [filePreview,setFilePreview] = React.useState<FilePreview|undefined>(undefined)
    const [supported] = React.useState(() => core.hostSupportsPageControl(((((globalThis) as Record<string, unknown>).dshDesktop) as object)))

    const [taskSummary,setTaskSummary]=React.useState<TaskSummary|undefined>(undefined)
    const [definitions,setDefinitions]=React.useState<DefinitionOption[]>([])
    const [userInput,setUserInput]=React.useState('')
    const [taskForm,setTaskForm]=React.useState<TaskForm>({goal:'',origins:'',definitionId:'',workflowRef:''})
    const [editing,setEditing]=React.useState<RunScope|undefined>(undefined)
    const [moreOpen,setMoreOpen]=React.useState(false)
    const [detailsOpen,setDetailsOpen]=React.useState(false)
    const [pageDetails,setPageDetails]=React.useState<string[]>([])
    const [fieldErrors,setFieldErrors]=React.useState<Record<string,string>>({})
    const [operationError,setOperationError]=React.useState<PanelError|undefined>(undefined)
    const [pendingAction,setPendingAction]=React.useState<string|undefined>(undefined)
    const [uiOwner,setUiOwner]=React.useState(sessionId)
    const uiSession=React.useRef(sessionId)
    const uiGeneration=React.useRef(0)
    if(uiSession.current!==sessionId){uiSession.current=sessionId;uiGeneration.current+=1}
    const currentTask=React.useRef(taskSummary)
    currentTask.current=taskSummary?.task.ownerSessionId===sessionId?taskSummary:undefined
    const operationVersion=React.useRef(0)
    const startOperation=(key:string)=>{const token=++operationVersion.current;setBusy(true);setPendingAction(key);setOperationError(undefined);return token}
    const finishOperation=(token:number,owner:number)=>{if(alive.current&&uiGeneration.current===owner&&operationVersion.current===token){setBusy(false);setPendingAction(undefined)}}
    React.useEffect(()=>{
      setUiOwner(sessionId);setTaskForm({goal:'',origins:'',definitionId:'',workflowRef:''});setFileForm({path:'',kind:'add',unitId:'',legalIdentity:'',firstRow:'2',lastRow:'2'})
      setEditing(undefined);setMoreOpen(false);setDetailsOpen(false);setPageDetails([]);setFieldErrors({});setOperationError(undefined);setPendingAction(undefined);setBusy(false);setFilePreview(undefined);setUserInput('')
      setTaskSummary(undefined);setDefinitions([]);setAgentSummary(undefined);setConnected(false);setLiveAgent(false);setError(undefined);setPages([])
    },[sessionId])

    const instanceId = React.useMemo(() => {
      const bytes = new Uint8Array(16)
      if (globalThis.crypto?.getRandomValues !== undefined) globalThis.crypto.getRandomValues(bytes)
      else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256)
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    }, [])
    const generation = React.useRef(1)
    // Set when a poll or a command fails, so the next successful poll opens a new
    // connection generation instead of silently resuming the old one.
    const lostConnection = React.useRef(false)
    const bound = React.useRef<PanelBinding|undefined>(undefined)
    const disposeImport = React.useCallback((binding: PanelBinding | undefined) => {
      if(!binding?.importOwner || !pageCode.import || !binding.element?.isConnected)return
      const program=pageCode.import({mode:'dispose',owner:binding.importOwner})
      void binding.element.executeJavaScript(program,true).then((value: unknown)=>{
        if(alive.current && isRecord(value) && isRecord(value.value) && value.value.cleanupFailed)setError({code:'internal',message:t('cleanupFailed')})
      },()=>{if(alive.current)setError({code:'internal',message:t('cleanupFailed')})})
    },[pageCode,t])
    const authorizationVersion = React.useRef(0)
    const suspendControl = React.useCallback(() => {
      authorizationVersion.current += 1
      disposeImport(bound.current)
      bound.current = undefined
      setAuthorized(undefined)
      setFilePreview(undefined)
    }, [disposeImport])
    const alive = React.useRef(true)
    const busyRef = React.useRef(false)

    const abandoned = React.useRef(new Set<string>())

    const post = React.useCallback(async (route: string, body: object):Promise<PanelReply> => {
      const response = await fetch(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({protocolVersion:PROTOCOL_VERSION,...body}),
        credentials: 'same-origin',
      })
      try {
        return decodePanelReply(await response.json())
      } catch {
        return { ok: false, error: { code: 'internal', message: `Host answered ${String(response.status)} without JSON` } }
      }
    }, [])

    const elements = React.useCallback(() => [...document.querySelectorAll<GuestElement>(core.WEBVIEW_SELECTOR)], [core])
    const elementOf = React.useCallback((lease: string) => elements().find((element: GuestElement) => element.getAttribute('name') === lease), [elements])

    /**
     * Refuse a command that does not address the authorization this panel holds.
     *
     * The Host decides what to dispatch; this decides whether *this* panel may
     * execute it. Without it a command minted for one authorization would run
     * against whatever page the panel is bound to now.
     * @param {PanelBinding} command - command envelope taken from the Host.
     * @param {PanelBinding} binding - the authorization this panel holds.
     * @param {number} generation - this panel's connection generation.
     * @returns {object | undefined} a refusal outcome, or undefined to proceed.
     */
    /**
     * Report that the authorized document changed, and follow the Host's verdict.
     *
     * Not every change ends control. A same-origin reload keeps the guest and the
     * element, so the Host retains the grant and only retires observations; a
     * cross-origin navigation, a replaced element or a destroyed guest ends it.
     * The local binding therefore follows what the Host answered instead of
     * assuming the worst and dropping a grant the user still holds.
     * @param {PanelBinding} binding - the authorization that changed.
     * @param {{ url?: string, documentToken?: string } | undefined} live - the document now in the guest.
     * @param {'same_origin_navigation' | 'cross_origin_navigation' | 'page_replaced' | 'page_destroyed'} [override] - event to report instead of deriving one.
     * @returns {Promise<void>} resolves once the Host has been told.
     */
    const reportNavigation = async (binding: PanelBinding, live: {
    url?: string;
    documentToken?: string;
} | undefined, override?: 'same_origin_navigation' | 'cross_origin_navigation' | 'page_replaced' | 'page_destroyed') : Promise<void> => {
      disposeImport(binding)
      setFilePreview(undefined)
      const event = override ?? navigationEvent(binding.url, live?.url)
      try {
        const answer = await post(ROUTES.invalidate, {
          instanceId,
          connectionGeneration: generation.current,
          lease: binding.lease,
          event,
          ...(live?.documentToken === undefined ? {} : { documentToken: live.documentToken }),
        })
        if (!alive.current || bound.current !== binding) return
        const affected = answer?.ok === true
          ? (answer.value.affected ?? []).find((entry: {controlLeaseId:string;state:string;epoch:number}) => entry.controlLeaseId === binding.controlLeaseId)
          : undefined
        if (affected !== undefined && affected.state === 'active' && bound.current === binding) {
          // Control survives. Adopt the Host's new epoch and the document now on
          // screen, and make the caller observe again before acting.
          binding.epoch = affected.epoch
          binding.documentToken = live?.documentToken ?? binding.documentToken
          binding.url = live?.url ?? binding.url
          setError({ code: 'stale_observation', message: 'the page changed; observe it again' })
          return
        }
      } catch {
        // The panel cannot prove control survived, so it must not keep using it.
      }
      if (bound.current === binding) {
        bound.current = undefined
        setAuthorized(undefined)
      }
      setError({ code: event, message: 'the page navigated; authorize it again' })
    }


    const scan = React.useCallback(async () => {
      const found: DiscoveredPage[] = []
      for (const element of elements()) {
        const identity = core.identityOf(element)
        if (identity.lease === '') continue
        if (identity.sessionId !== '' && identity.sessionId !== sessionId) continue
        let probe: unknown
        try {
          probe = await element.executeJavaScript(pageCode.identity, true)
        } catch {
          continue
        }
        if (!isRecord(probe)||probe.ok!==true||!isRecord(probe.value)||typeof probe.value.url!=='string'||typeof probe.value.title!=='string'||typeof probe.value.documentToken!=='string') continue
        found.push({
          lease: identity.lease,
          partition: identity.partition,
          sessionId: identity.sessionId === '' ? sessionId : identity.sessionId,
          tabId: identity.tabId,
          url: probe.value.url,
          title: probe.value.title,
          documentToken: probe.value.documentToken,
        })
      }
      return found
    }, [core, elements, pageCode, sessionId])

    const execute = React.useCallback(async (command:PanelCommand,batchReceivedAt:number) => {
      const binding = bound.current
      if (binding === undefined) {
        return { outcome: 'failed', error: { code: 'not_authorized', message: 'no page is authorized in this panel' } }
      }
      // Gate on the authorization this panel itself holds. Echoing a command's
      // fields back in the result proves nothing; comparing them here — before
      // the page is touched — is what keeps a command aimed at one authorization
      // from executing against another after the user authorizes a different
      // page.
      const rejected = refuseCommand(command, binding, generation.current)
      if (rejected !== undefined) return rejected
      // The Host advances its sequence when it dispatches, not when a command
      // succeeds. This panel must therefore consume the sequence as soon as it
      // accepts the command: advancing only on success would leave the two
      // counters permanently apart after any failed command, and every later
      // command would be refused as out of sequence.
      binding.expectedSequence += 1
      const parsed=validateCommand({...command,kind:'command'})
      if(!parsed.ok)return {outcome:'failed',error:{code:'protocol_violation',message:parsed.reason}}
      // The element must still be the very instance the user authorized. A name
      // can be reused by a replacement guest, so identity is compared, not the
      // attribute.
      const mounted = elementOf(binding.lease)
      if (mounted !== binding.element) {
        await reportNavigation(binding, undefined, 'page_replaced')
        return { outcome: 'failed', error: { code: 'page_replaced', message: 'the authorized page was replaced; authorize again' } }
      }
      const element = binding.element
      if (element === undefined || !element.isConnected) {
        return { outcome: 'failed', error: { code: 'page_unavailable', message: 'the authorized page is gone; authorize again' } }
      }
      // The budget is consumed by waiting, so it is charged from the moment the
      // batch arrived rather than from the moment this command is reached.
      const spent = performance.now() - batchReceivedAt
      if (typeof command.budgetMs === 'number' && spent >= command.budgetMs) {
        return { outcome: 'dropped', error: { code: 'deadline_exceeded', message: 'the command expired before execution' } }
      }
      // The document the user authorized must still be the document in the
      // guest. A navigation — especially a cross-origin one — leaves the same
      // webview element showing a different document, so the element staying
      // connected is not enough.
      let live
      try {
        live = await element.executeJavaScript(pageCode.identity, true)
      } catch (failure) {
        return core.classifyThrow(failure)
      }
      if (!alive.current || bound.current !== binding
        || command.connectionGeneration !== generation.current || command.epoch !== binding.epoch) {
        return { outcome: 'failed', error: { code: 'revoked', message: 'control changed before page execution' } }
      }
      if (elementOf(binding.lease) !== element || !element.isConnected) {
        await reportNavigation(binding, undefined, 'page_replaced')
        return { outcome: 'failed', error: { code: 'page_replaced', message: 'the authorized page was replaced; authorize again' } }
      }
      if (!isRecord(live)||live.ok !== true||!isRecord(live.value)||typeof live.value.url!=='string'||typeof live.value.documentToken!=='string') {
        return { outcome: 'failed', error: { code: 'page_unavailable', message: 'the authorized document could not be read; authorize again' } }
      }
      let allowedOrigin=false
      try{allowedOrigin=Array.isArray(binding.origins)&&binding.origins.includes(new URL(live.value.url).origin)}catch{allowedOrigin=false}
      if(!allowedOrigin){await reportNavigation(binding,live.value,'cross_origin_navigation');return {outcome:'failed',error:{code:'task_scope_mismatch',message:'the live page is outside the task allowed origins'}}}
      if (live.value.documentToken !== binding.documentToken) {
        await reportNavigation(binding, live.value)
        return { outcome: 'failed', error: { code: 'stale_observation', message: 'the page navigated to another document; authorize it again' } }
      }
      // Identity checks share the execution budget with the page operation.
      const remaining = typeof command.budgetMs === 'number'
        ? command.budgetMs - (performance.now() - batchReceivedAt)
        : undefined
      if (remaining !== undefined && remaining <= 0) {
        return { outcome: 'dropped', error: { code: 'deadline_exceeded', message: 'the command expired before execution' } }
      }
      const op = remaining === undefined ? command.op : capToBudget(command.op, remaining)
      // The wire validator checked the file fields; no raw model path reaches this branch.
      const file=op.file
      if(file){
        try{
          const binary=atob(file.base64);const bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0))
          const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('')
          if(hash!==file.sha256)return {outcome:'failed',error:{code:'invalid_request',message:'file transfer hash mismatch'}}
        }catch{return {outcome:'failed',error:{code:'invalid_request',message:'file transfer verification failed'}}}
        if(!alive.current||bound.current!==binding||command.connectionGeneration!==generation.current||command.epoch!==binding.epoch)return {outcome:'failed',error:{code:'revoked',message:'control changed while verifying the file'}}
        if(typeof command.budgetMs==='number'&&performance.now()-batchReceivedAt>=command.budgetMs)return {outcome:'dropped',error:{code:'deadline_exceeded',message:'the file command expired before page execution'}}
      }
      if(op.importOwner)binding.importOwner=op.importOwner
      let source
      try {
        source = core.programFor(pageCode, op)
      } catch (failure) {
        return { outcome: 'failed', error: { code: 'unsupported', message: String(((failure) as {
    message?: unknown;
})?.message ?? failure) } }
      }
      let result
      try {
        result = await element.executeJavaScript(source, true)
      } catch (failure) {
        // The page may have acted before the error surfaced: never claim it did not.
        return core.classifyThrow(failure)
      }
      return core.classifyResult(result)
    }, [bound, core, elementOf, pageCode])

    React.useEffect(() => {
      alive.current = true
      let cancelled = false
      const tick = async () => {
        if (cancelled || !alive.current || busyRef.current) return
        try {
          const found = supported ? await scan() : []
          if (cancelled) return
          setPages(found)
          // The scan already reads each guest's live document identity, so a
          // navigation shows up here without any extra webview listener: the
          // authorized guest either moved to another document or is gone.
          const binding = bound.current
          if (binding !== undefined) {
            const scanned = found.find((entry: DiscoveredPage) => entry.lease === binding.lease)
            if (scanned === undefined) {
              await reportNavigation(binding, undefined)
            } else if (elementOf(binding.lease) !== binding.element) {
              // The guest carrying this name is a different element now: the
              // physical page the user authorized was replaced.
              await reportNavigation(binding, scanned, 'page_replaced')
            } else if (scanned.documentToken !== binding.documentToken) {
              await reportNavigation(binding, scanned)
            }
            if (bound.current === undefined) return
          }
          if (lostConnection.current) {
            lostConnection.current = false
            generation.current += 1
            // A new generation supersedes the old connection, which retires the
            // leases bound to it. Control therefore has to be granted again.
            if (bound.current !== undefined) {
              suspendControl()
              setError({ code: 'connection_lost', message: 'the panel reconnected; authorize the page again' })
            }
          }
          const polled = await post(ROUTES.poll, {
            protocolVersion:PROTOCOL_VERSION,
            instanceId,
            connectionGeneration: generation.current,
            sessionId,
            pages: found,
          })
          if (cancelled) return
          if (polled?.ok !== true || polled.value.protocolVersion!==PROTOCOL_VERSION) {
            // The channel is gone. Control is suspended until the user allows it
            // again, so the next poll must not resume the previous generation.
            lostConnection.current = true
            suspendControl()
            setConnected(false)
            setLiveAgent(false)
            setError(polled?.error)
            return
          }
          const polledTask=isTaskSummary(polled.value.task)?polled.value.task:undefined
          setTaskSummary(polledTask)
          setDefinitions(polled.value.definitions ?? [])
          if(bound.current && polledTask && !sameRunScope(bound.current.task,polledTask.task))suspendControl()
          setConnected(true)
          setLiveAgent(polled.value.agent?.id===sessionId)
          setAgentSummary(polled.value.agent ?? undefined)
          setError(undefined)
          if(bound.current && Array.isArray(polled.value.controls) && !polled.value.controls.includes(bound.current.controlLeaseId))suspendControl()
          // The Host names the commands it has stopped waiting for. Recording
          // them lets the panel skip a result the Host would only discard, and
          // stop work it can no longer report on.
          for (const id of polled.value.dropped ?? []) abandoned.current.add(id)
          const batchReceivedAt = performance.now()
          for (const command of polled.value.commands ?? []) {
            busyRef.current = true
            const outcome = await execute(command, batchReceivedAt)
            busyRef.current = false
            // A command the Host abandoned while it ran is not reported: the
            // Host already settled it, and a second answer would be discarded.
            if (abandoned.current.has(command.id)) {
              abandoned.current.delete(command.id)
              continue
            }
            await post(ROUTES.result, {
              kind: 'result',
              protocolVersion:PROTOCOL_VERSION,
              task:command.task,
              id: command.id,
              leaseId: command.leaseId,
              instanceId,
              connectionGeneration: command.connectionGeneration,
              epoch: command.epoch,
              sequence: command.sequence,
              ...outcome,
            })
          }
        } catch (failure) {
          if (!cancelled) {
            lostConnection.current = true
            suspendControl()
            setConnected(false)
            setError({ code: 'internal', message: String(((failure) as {
    message?: unknown;
})?.message ?? failure) })
          }
        }
      }
      void tick()
      const timer = setInterval(() => { void tick() }, POLL_INTERVAL_MS)
      return () => {
        cancelled = true
        alive.current = false
        authorizationVersion.current += 1
        disposeImport(bound.current)
        bound.current = undefined
        clearInterval(timer)
      }
    }, [execute, instanceId, post, scan, sessionId, supported, suspendControl])

    const authorize = React.useCallback(async (page: {
    lease: string;
    partition: string;
    documentToken: string;
    tabId: string;
    url?: string;
    title?: string;
}) => {
      // The user must be able to tell which physical page they are granting.
      const twins = indistinguishableFrom(pages, page)
      if (twins.length > 0) {
        setOperationError({ code: 'page_ambiguous', message: `${String(twins.length + 1)} pages look identical; close one and authorize again` })
        return
      }
      const version = ++authorizationVersion.current
      const authorizedGeneration = generation.current
      const authorizedElement = elementOf(page.lease)
      const owner=uiGeneration.current,operation=startOperation('authorize')
      try {
        const answer = await post(ROUTES.authorize, {
          instanceId,
          connectionGeneration: generation.current,
          sessionId,
          lease: page.lease,
          partition: page.partition,
          documentToken: page.documentToken,
          tabId: page.tabId,
          task:taskSummary?.task,
        })
        if (!alive.current || uiGeneration.current!==owner || version !== authorizationVersion.current
          || authorizedGeneration !== generation.current) return
        if (answer?.ok === true) {
          if(!validRunScope(answer.value.task)||typeof answer.value.controlLeaseId!=='string'||typeof answer.value.epoch!=='number'||typeof answer.value.documentToken!=='string'){setOperationError({code:'protocol_violation',message:t('taskMissing')});return}
          if (elementOf(page.lease) !== authorizedElement) {
            bound.current = undefined
            setAuthorized(undefined)
            setOperationError({ code: 'page_replaced', message: t('disconnected') })
            return
          }
          disposeImport(bound.current)
          setFilePreview(undefined)
          bound.current = {
            lease: page.lease,
            partition: page.partition,
            tabId: page.tabId,
            task:answer.value.task,
            pagePolicy:answer.value.pagePolicy,
            origins:answer.value.origins,
            controlLeaseId: answer.value.controlLeaseId,
            epoch: answer.value.epoch,
            documentToken: answer.value.documentToken,
            url: page.url,
            expectedSequence: answer.value.nextSequence ?? 0,
            // The plan requires the Client to bind the exact webview element
            // instance, not a name that a replacement could reuse.
            element: authorizedElement,
          }
          setAuthorized(page.lease)
          setOperationError(undefined)
        } else {
          setOperationError(answer?.error)
        }
      } catch {
        if(alive.current&&uiGeneration.current===owner)setOperationError({code:'connection_lost',message:t('disconnected')})
      } finally {
        finishOperation(operation,owner)
      }
    }, [elementOf, instanceId, pages, post, sessionId, taskSummary])

    const fileOperation = async (operation: 'prepare' | 'confirm') => {
      const binding=bound.current,version=authorizationVersion.current,owner=uiGeneration.current
      if(!binding)return
      const token=startOperation(operation==='prepare'?'prepare-file':'confirm-file')
      try {
        const answer=await post(ROUTES.authorize,{
          instanceId,connectionGeneration:generation.current,sessionId,task:binding.task,lease:binding.lease,partition:binding.partition,tabId:binding.tabId,documentToken:binding.documentToken,
          fileOperation:operation,
          ...(operation==='prepare'?{path:fileForm.path,scope:{kind:fileForm.kind,unitId:fileForm.unitId,legalIdentity:fileForm.legalIdentity,firstRow:Number(fileForm.firstRow),lastRow:Number(fileForm.lastRow)}}:{fileGrantId:filePreview?.fileGrantId}),
        })
        if(!alive.current||uiGeneration.current!==owner||bound.current!==binding||version!==authorizationVersion.current)return
        if(answer?.ok!==true){setOperationError(answer?.error);return}
        if(operation==='prepare'){if(isFilePreview(answer.value))setFilePreview(answer.value);else setOperationError({code:'protocol_violation',message:t('invalidReply')})}else if(filePreview)setFilePreview({...filePreview,confirmed:true})
      }catch{if(alive.current&&uiGeneration.current===owner)setOperationError({code:'connection_lost',message:t('disconnected')})}
      finally{finishOperation(token,owner)}
    }

    const revoke = async () => {
      suspendControl()
      const owner=uiGeneration.current,token=startOperation('revoke')
      try {
        const answer = await post(ROUTES.revoke, {instanceId,connectionGeneration:generation.current,sessionId})
        if(alive.current&&uiGeneration.current===owner&&answer?.ok!==true)setOperationError(answer?.error)
      } catch {
        if(alive.current&&uiGeneration.current===owner)setOperationError({code:'connection_lost',message:t('disconnected')})
      } finally {finishOperation(token,owner)}
    }

    const edit=()=>{
      const task=currentTask.current;if(!task)return
      setEditing(task.task);setTaskForm({goal:task.goal,origins:task.origins.join(', '),definitionId:'',workflowRef:task.task.workflowRef});setFieldErrors({})
    }
    const cancelEdit=()=>{setEditing(undefined);setFieldErrors({})}
    const taskOperation=async (operation:TaskOperation)=>{
      const target=currentTask.current
      if(operation==='revise'&&(!editing||!target||!sameRunScope(editing,target.task))){setFieldErrors({goal:t('draftChanged')});return}
      const origins=taskForm.origins.split(',').map(part=>part.trim()).filter(Boolean)
      if(operation==='create'||operation==='revise'){
        const errors:Record<string,string>={}
        if(!taskForm.goal.trim())errors.goal=t('goalRequired')
        if(operation==='create'&&taskForm.definitionId){
          const definition=definitions.find(item=>item.id===taskForm.definitionId)
          if(!definition)errors.definitionId=t('definitionRequired')
          else if(!definition.workflows.some(item=>item.id===taskForm.workflowRef))errors.workflowRef=t('workflowRequired')
        }else if(target?.adapter==='generic'||operation==='create'){
          if(!origins.length||origins.some(origin=>{try{const url=new URL(origin);return !['https:','http:'].includes(url.protocol)||url.origin!==origin}catch{return true}}))errors.origins=t('originsRequired')
        }
        setFieldErrors(errors);if(Object.keys(errors).length)return
      }
      if(['revise','cancel','finish'].includes(operation))suspendControl()
      const owner=uiGeneration.current,token=startOperation('task-'+operation)
      try{
        const answer=await post(ROUTES.authorize,{instanceId,connectionGeneration:generation.current,sessionId,taskOperation:operation,
          ...(operation==='create'?{spec:{goal:taskForm.goal,...(taskForm.definitionId?{definitionId:taskForm.definitionId,workflowRef:taskForm.workflowRef}:{origins})}}:{}),
          ...(operation==='revise'?{task:editing,spec:{goal:taskForm.goal,...(target?.adapter==='generic'?{origins}:{})}}:{}),
          ...(operation==='resume'?{task:target?.task,waitId:target?.active_context?.waiting?.id,userInput}:{}),
          ...(['cancel','finish'].includes(operation)?{task:target?.task}:{})})
        if(!alive.current||uiGeneration.current!==owner)return
        if(answer?.ok&&isTaskSummary(answer.value)&&answer.value.task.ownerSessionId===sessionId){setTaskSummary(answer.value);if(operation==='resume')setUserInput('');if(operation==='revise')cancelEdit();setOperationError(undefined)}else setOperationError(answer?.error??{code:'protocol_violation',message:t('invalidReply')})
      }catch{if(alive.current&&uiGeneration.current===owner)setOperationError({code:'connection_lost',message:t('disconnected')})}
      finally{finishOperation(token,owner)}
    }
    const owned=uiOwner===sessionId,task=owned?currentTask.current:undefined
    return renderPanelView({h,ui,t,model:{
      sessionId,supported,connected:owned&&connected,liveAgent:owned&&liveAgent,agent:owned&&agentSummary?.id===sessionId?agentSummary:undefined,error:owned?operationError??error:undefined,
      task,pages:owned?pages.filter(page=>page.sessionId===sessionId):[],authorized:owned?authorized:undefined,busy:owned&&busy,pending:owned?pendingAction:undefined,
      taskForm:owned?taskForm:{goal:'',origins:'',definitionId:'',workflowRef:''},fileForm:owned?fileForm:{path:'',kind:'add',unitId:'',legalIdentity:'',firstRow:'2',lastRow:'2'},filePreview:owned?filePreview:undefined,definitions:owned?definitions:[],userInput:owned?userInput:'',
      editing:owned?editing:undefined,moreOpen:owned&&moreOpen,detailsOpen:owned&&detailsOpen,pageDetails:owned?pageDetails:[],errors:owned?fieldErrors:{},
    },actions:{
      task:operation=>{void taskOperation(operation)},authorize:page=>{void authorize(page)},revoke:()=>{void revoke()},edit,cancelEdit,reloadDraft:edit,
      toggleMore:()=>setMoreOpen(value=>!value),toggleDetails:()=>setDetailsOpen(value=>!value),togglePage:lease=>setPageDetails(value=>value.includes(lease)?value.filter(item=>item!==lease):[...value,lease]),
      changeTask:(key,value)=>{setFieldErrors(errors=>({...errors,[key]:''}));setTaskForm(form=>({...form,[key]:value,...(key==='definitionId'?{workflowRef:definitions.find(item=>item.id===value)?.workflows[0]?.id??''}:{})}))},
      changeFile:(key,value)=>{setFilePreview(undefined);setFileForm(form=>({...form,[key]:value}))},changeUserInput:setUserInput,file:operation=>{void fileOperation(operation)},
    }})
  }
}
