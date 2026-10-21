/**
 * The Browser Flow panel component.
 *
 * This is a normal ES module so it can be imported and tested directly. The
 * client build inlines it (with `pagecode.js` and `clientcore.js`) into the
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
} from './clientcore.js'
import { actProgram, findProgram, identityProgram, observeProgram, waitProgram } from './pagecode.ts'
import { importProgram } from './import-page.ts'
import { validRunScope, sameRunScope } from './task-scope.ts'
import { PROTOCOL_VERSION, validateCommand } from './protocol.ts'

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

/**
 * The React surface the panel uses.
 *
 * Declared structurally so the bundle inlines no React types and the tests can
 * supply a minimal stand-in.
 * @typedef {object} ReactLike
 * @property {(type: string | Function, props: object | null, ...children: any[]) => any} createElement - element factory.
 * @property {(initial: unknown) => [any, (next: unknown) => void]} useState - state hook.
 * @property {(initial: unknown) => { current: any }} useRef - ref hook.
 * @property {(factory: () => any, deps?: unknown[]) => any} useMemo - memo hook.
 * @property {(callback: Function, deps?: unknown[]) => Function} useCallback - callback hook.
 * @property {(callback: () => (() => void) | void, deps?: unknown[]) => void} useEffect - effect hook.
 */

/**
 * Page-program builders, as the panel consumes them.
 * @typedef {object} PagePrograms
 * @property {string} identity - identity program source.
 * @property {(maxChars: number, maxNodes: number) => string} observe - observation program.
 * @property {(query: object, limit: number) => string} find - find program.
 * @property {(input: object) => string} act - action program.
 * @property {(input: object) => string} wait - wait program.
 * @property {(input: object) => string} [import] - scoped Beijing verifier.
 */

/** Page-program builders, as the panel consumes them. @type {PagePrograms} */
export const PAGE_CODE = Object.freeze({
  identity: identityProgram(),
  import: input => importProgram(/** @type {import('./page/types.ts').ImportInput} */ (input)),
  observe: (maxChars, maxNodes) => observeProgram(maxChars, maxNodes),
  find: (query, limit) => findProgram(/** @type {{ by: 'text' | 'attr' | 'role', value: string, name?: string }} */ (query), limit),
  act: input => actProgram(/** @type {import('./page/types.ts').PageActionInput} */ (input)),
  wait: input => waitProgram(/** @type {import('./page/types.ts').PageWaitInput} */ (input)),
})

/**
 * The client helpers the panel consumes.
 *
 * These are the functions `clientcore.js` exports; the panel receives them as
 * one object so the bundle inlines a single dependency.
 * @typedef {object} ClientHelpers
 * @property {string} WEBVIEW_SELECTOR - guest selector.
 * @property {(pageCode: PagePrograms, op: any) => string} programFor - program selection.
 * @property {(element: Element) => { lease: string, partition: string, sessionId: string, tabId: string }} identityOf - element identity.
 * @property {(result: unknown) => object} classifyResult - execution outcome.
 * @property {(failure: unknown) => object} classifyThrow - thrown outcome.
 * @property {(carrier: object) => boolean} hostSupportsPageControl - host capability.
 */

/**
 * One page the panel found in the Sidebar Browser.
 * @typedef {object} DiscoveredPage
 * @property {string} lease - guest lease.
 * @property {string} partition - guest partition.
 * @property {string} sessionId - owning Session.
 * @property {string} tabId - plugin tab alias.
 * @property {string} url - redacted address.
 * @property {string} title - page title.
 * @property {string} documentToken - page-minted document identity.
 */

/** Client helpers, as the panel consumes them. @type {ClientHelpers} */
export const CORE = Object.freeze({
  WEBVIEW_SELECTOR, programFor, identityOf, classifyResult, classifyThrow, hostSupportsPageControl,
})

/**
 * Locale dictionaries for the panel.
 * @type {{ zh: Record<string, string>, en: Record<string, string> }}
 */
export const COPY = Object.freeze({
  zh: {
    resumeTask:'核对新输入并继续', userInput:'新提供的人工输入', waitingUser:'等待用户', taskReadOnly:'旧任务记录只读；请使用新会话开始新任务。',
    taskTitle:'当前任务', taskGoal:'目标', taskOrigins:'允许的源站（以逗号分隔）', taskDefinition:'本地任务定义', taskGeneric:'通用任务', taskWorkflow:'操作说明', createTask:'创建并绑定任务', openTask:'打开本会话任务', reviseTask:'修订目标与范围', cancelTask:'取消任务并撤销', finishTask:'结束并人工交接', taskMissing:'先创建或打开当前会话的任务，再授权页面。', taskBlocked:'此任务的写结果未知或日志不可用：仅允许读取、撤销及人工交接。',
    title: '浏览器控制',
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
    resumeTask:'Check new input and resume', userInput:'New user input', waitingUser:'Awaiting user', taskReadOnly:'Legacy history is read-only; start new work in a new Session.',
    taskTitle:'Current task', taskGoal:'Goal', taskOrigins:'Allowed origins (comma separated)', taskDefinition:'Local definition', taskGeneric:'Generic task', taskWorkflow:'Instructions', createTask:'Create and bind task', openTask:'Open this session’s task', reviseTask:'Revise goal and scope', cancelTask:'Cancel task and revoke', finishTask:'End and hand off', taskMissing:'Create or open this session’s task before authorizing a page.', taskBlocked:'Unknown write or unavailable log: only read, revoke and hand off.',
    title: 'Browser Flow',
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
 * @param {ClientHelpers} [input.core] - client helpers; defaults to {@link CORE}.
 * @param {PagePrograms} [input.pageCode] - page programs; defaults to {@link PAGE_CODE}.
 * @returns {Function} React component.
 */
export function createPanel({ React, t, core = CORE, pageCode = PAGE_CODE }) {
  const h = React.createElement

  /**
   * One panel instance: page discovery, authorization and the command loop.
   * @param {{ sessionId: string, useTabInfo?: () => { tab: { kind: string } } }} props - slot props.
   * @returns {any} element tree.
   */
  return function Panel(props) {
    const sessionId = props.sessionId
    const tabInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
    /** @type {[DiscoveredPage[], (next: DiscoveredPage[]) => void]} */
    const [pages, setPages] = React.useState(/** @type {DiscoveredPage[]} */ ([]))
    const [connected, setConnected] = React.useState(false)
    const [liveAgent, setLiveAgent] = React.useState(false)
    /** @type {[any, (next: any) => void]} */
    const [agentSummary, setAgentSummary] = React.useState(undefined)
    const [error, setError] = React.useState(undefined)
    const [authorized, setAuthorized] = React.useState(undefined)
    const [busy, setBusy] = React.useState(false)
    const [fileForm,setFileForm] = React.useState({path:'',kind:'add',unitId:'',legalIdentity:'',firstRow:'2',lastRow:'2'})
    const [filePreview,setFilePreview] = React.useState(undefined)
    const [supported] = React.useState(() => core.hostSupportsPageControl(/** @type {object} */ (/** @type {Record<string, unknown>} */ (globalThis).dshDesktop)))

    const [taskSummary,setTaskSummary]=React.useState(undefined)
    const [definitions,setDefinitions]=React.useState([])
    const [userInput,setUserInput]=React.useState('')
    const [taskForm,setTaskForm]=React.useState({goal:'',origins:'',definitionId:'',workflowRef:''})

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
    const bound = React.useRef(undefined)
    const disposeImport = React.useCallback((/** @type {any} */ binding) => {
      if(!binding?.importOwner || !pageCode.import || !binding.element?.isConnected)return
      const program=pageCode.import({mode:'dispose',owner:binding.importOwner})
      void binding.element.executeJavaScript(program,true).then((/** @type {any} */ value)=>{
        if(alive.current && value?.value?.cleanupFailed)setError({code:'internal',message:t('cleanupFailed')})
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
    /** @type {any} */
    const abandoned = React.useRef(new Set())

    const post = React.useCallback(async (/** @type {string} */ route, /** @type {object} */ body) => {
      const response = await fetch(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({protocolVersion:PROTOCOL_VERSION,...body}),
        credentials: 'same-origin',
      })
      try {
        return await response.json()
      } catch {
        return { ok: false, error: { code: 'internal', message: `Host answered ${String(response.status)} without JSON` } }
      }
    }, [])

    const elements = React.useCallback(() => [...document.querySelectorAll(core.WEBVIEW_SELECTOR)], [core])
    const elementOf = React.useCallback((/** @type {string} */ lease) => elements().find((/** @type {Element} */ element) => element.getAttribute('name') === lease), [elements])

    /**
     * Refuse a command that does not address the authorization this panel holds.
     *
     * The Host decides what to dispatch; this decides whether *this* panel may
     * execute it. Without it a command minted for one authorization would run
     * against whatever page the panel is bound to now.
     * @param {any} command - command envelope taken from the Host.
     * @param {any} binding - the authorization this panel holds.
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
     * @param {any} binding - the authorization that changed.
     * @param {{ url?: string, documentToken?: string } | undefined} live - the document now in the guest.
     * @param {'same_origin_navigation' | 'cross_origin_navigation' | 'page_replaced' | 'page_destroyed'} [override] - event to report instead of deriving one.
     * @returns {Promise<void>} resolves once the Host has been told.
     */
    const reportNavigation = async (binding, live, override) => {
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
          ? (answer.value.affected ?? []).find((/** @type {any} */ entry) => entry.controlLeaseId === binding.controlLeaseId)
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
      const found = []
      for (const element of elements()) {
        const identity = core.identityOf(element)
        if (identity.lease === '') continue
        if (identity.sessionId !== '' && identity.sessionId !== sessionId) continue
        let probe
        try {
          probe = await element.executeJavaScript(pageCode.identity, true)
        } catch {
          continue
        }
        if (probe?.ok !== true) continue
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

    const execute = React.useCallback(async (/** @type {{ task: import('./task-scope.ts').RunScope, deadlineAt: number, budgetMs?: number, op: object, id: string, leaseId: string, connectionGeneration: number, epoch: number, sequence: number }} */ command, /** @type {number} */ batchReceivedAt) => {
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
      if (live?.ok !== true) {
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
      const file=/** @type {any} */ (op).file
      if(file){
        try{
          const binary=atob(file.base64);const bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0))
          const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('')
          if(hash!==file.sha256)return {outcome:'failed',error:{code:'invalid_request',message:'file transfer hash mismatch'}}
        }catch{return {outcome:'failed',error:{code:'invalid_request',message:'file transfer verification failed'}}}
        if(!alive.current||bound.current!==binding||command.connectionGeneration!==generation.current||command.epoch!==binding.epoch)return {outcome:'failed',error:{code:'revoked',message:'control changed while verifying the file'}}
        if(typeof command.budgetMs==='number'&&performance.now()-batchReceivedAt>=command.budgetMs)return {outcome:'dropped',error:{code:'deadline_exceeded',message:'the file command expired before page execution'}}
      }
      if(/** @type {any} */ (op).importOwner)binding.importOwner=/** @type {any} */ (op).importOwner
      let source
      try {
        source = core.programFor(pageCode, op)
      } catch (failure) {
        return { outcome: 'failed', error: { code: 'unsupported', message: String(/** @type {{ message?: unknown }} */ (failure)?.message ?? failure) } }
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
            const scanned = found.find((/** @type {any} */ entry) => entry.lease === binding.lease)
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
          setTaskSummary(polled.value.task ?? undefined)
          setDefinitions(polled.value.definitions ?? [])
          if(bound.current && polled.value.task?.task && !sameRunScope(bound.current.task,polled.value.task.task))suspendControl()
          setConnected(true)
          setLiveAgent(true)
          setAgentSummary(polled.value.agent ?? undefined)
          setError(undefined)
          if(bound.current && Array.isArray(polled.value.controls) && !polled.value.controls.includes(bound.current.controlLeaseId))suspendControl()
          // The Host names the commands it has stopped waiting for. Recording
          // them lets the panel skip a result the Host would only discard, and
          // stop work it can no longer report on.
          for (const id of polled.value.dropped ?? []) abandoned.current.add(id)
          const batchReceivedAt = performance.now()
          for (const command of polled.value.commands) {
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
            setError({ code: 'internal', message: String(/** @type {{ message?: unknown }} */ (failure)?.message ?? failure) })
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

    const authorize = React.useCallback(async (/** @type {{ lease: string, partition: string, documentToken: string, tabId: string, url?: string, title?: string }} */ page) => {
      // The user must be able to tell which physical page they are granting.
      const twins = indistinguishableFrom(pages, page)
      if (twins.length > 0) {
        setError({ code: 'page_ambiguous', message: `${String(twins.length + 1)} pages look identical; close one and authorize again` })
        return
      }
      const version = ++authorizationVersion.current
      const authorizedGeneration = generation.current
      const authorizedElement = elementOf(page.lease)
      setBusy(true)
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
        if (!alive.current || version !== authorizationVersion.current
          || authorizedGeneration !== generation.current) return
        if (answer?.ok === true) {
          if(!validRunScope(answer.value.task)){setError({code:'protocol_violation',message:t('taskMissing')});return}
          if (elementOf(page.lease) !== authorizedElement) {
            bound.current = undefined
            setAuthorized(undefined)
            setError({ code: 'page_replaced', message: t('disconnected') })
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
          setError(undefined)
        } else {
          setError(answer?.error)
        }
      } finally {
        setBusy(false)
      }
    }, [elementOf, instanceId, pages, post, sessionId, taskSummary])

    const fileOperation = async (/** @type {'prepare'|'confirm'} */ operation) => {
      const binding=bound.current;const version=authorizationVersion.current
      if(!binding)return
      setBusy(true)
      try {
        const answer=await post(ROUTES.authorize,{
          instanceId,connectionGeneration:generation.current,sessionId,task:binding.task,lease:binding.lease,partition:binding.partition,tabId:binding.tabId,documentToken:binding.documentToken,
          fileOperation:operation,
          ...(operation==='prepare'?{path:fileForm.path,scope:{kind:fileForm.kind,unitId:fileForm.unitId,legalIdentity:fileForm.legalIdentity,firstRow:Number(fileForm.firstRow),lastRow:Number(fileForm.lastRow)}}:{fileGrantId:filePreview?.fileGrantId}),
        })
        if(!alive.current||bound.current!==binding||version!==authorizationVersion.current)return
        if(answer?.ok!==true){setError(answer?.error);return}
        setFilePreview(operation==='prepare'?answer.value:{...filePreview,confirmed:true})
      }catch{if(alive.current)setError({code:'connection_lost',message:t('disconnected')})}
      finally{if(alive.current)setBusy(false)}
    }

    const revoke = React.useCallback(async () => {
      suspendControl()
      setBusy(true)
      try {
        const answer = await post(ROUTES.revoke, {
          instanceId,
          connectionGeneration: generation.current,
          sessionId,
        })
        if (answer?.ok !== true) setError(answer?.error)
      } catch (failure) {
        setError({ code: 'connection_lost', message: t('disconnected') })
      } finally {
        setBusy(false)
      }
    }, [instanceId, post, sessionId, suspendControl])

    const taskOperation=async (/** @type {'create'|'open'|'revise'|'cancel'|'finish'|'resume'} */ operation)=>{
      if(['revise','cancel','finish'].includes(operation))suspendControl()
      setBusy(true)
      try{
        const answer=await post(ROUTES.authorize,{instanceId,connectionGeneration:generation.current,sessionId,taskOperation:operation,
          ...(operation==='create'?{spec:{goal:taskForm.goal,...(taskForm.definitionId?{definitionId:taskForm.definitionId,workflowRef:taskForm.workflowRef}:{origins:taskForm.origins.split(',').map((/** @type {string} */ part)=>part.trim()).filter(Boolean)})}}:{}),
          ...(operation==='revise'?{task:taskSummary?.task,spec:{goal:taskForm.goal,...(taskSummary?.adapter==='generic'?{origins:taskForm.origins.split(',').map((/** @type {string} */ part)=>part.trim()).filter(Boolean)}:{})}}:{}),
          ...(operation==='resume'?{task:taskSummary?.task,waitId:taskSummary?.active_context?.waiting?.id,userInput}:{}),
          ...(['cancel','finish'].includes(operation)?{task:taskSummary?.task}:{})})
        if(!alive.current)return
        if(answer?.ok){setTaskSummary(answer.value);if(operation==='resume')setUserInput('');setError(undefined)}else setError(answer?.error)
      }catch{if(alive.current)setError({code:'connection_lost',message:t('disconnected')})}
      finally{if(alive.current)setBusy(false)}
    }
    const selectedDefinition=definitions.find((/** @type {any} */ item)=>item.id===taskForm.definitionId)
    const taskPanel=h('section',{'data-browser-flow-task':''},h('h4',null,t('taskTitle')),
      taskSummary ? h('p',{'data-browser-flow-task-identity':''},`${taskSummary.task.taskId} · ${taskSummary.state} · ${taskSummary.goal}`) : h('p',null,t('taskMissing')),
      taskSummary?.writeBlocked ? h('p',{role:'alert'},taskSummary?.state==='read_only'?t('taskReadOnly'):t('taskBlocked')) : null,
      taskSummary?.active_context?.waiting ? h('section',{'data-browser-flow-user-wait':''},h('p',null,t('waitingUser')+': '+taskSummary.active_context.waiting.reason),h('p',null,taskSummary.active_context.waiting.resumeCondition),h('label',null,t('userInput'),h('input',{'data-browser-flow-input':'user-input',value:userInput,onChange:(/** @type {any} */ event)=>setUserInput(event.target.value)})),h('button',{type:'button','data-browser-flow-action':'task-resume',disabled:busy||taskSummary.writeBlocked,onClick:()=>{void taskOperation('resume')}},t('resumeTask'))) : null,
      h('label',null,t('taskGoal'),h('input',{'data-browser-flow-input':'task-goal',value:taskForm.goal,onChange:(/** @type {any} */ event)=>setTaskForm({...taskForm,goal:event.target.value})})),
      h('label',null,t('taskOrigins'),h('input',{'data-browser-flow-input':'task-origins',value:taskForm.origins,onChange:(/** @type {any} */ event)=>setTaskForm({...taskForm,origins:event.target.value})})),
      h('label',null,t('taskDefinition'),h('select',{'data-browser-flow-input':'task-definition',value:taskForm.definitionId,disabled:!!taskSummary,onChange:(/** @type {any} */ event)=>{const selected=definitions.find((/** @type {any} */ item)=>item.id===event.target.value);setTaskForm({...taskForm,definitionId:event.target.value,workflowRef:selected?.workflows[0]?.id ?? ''})}},h('option',{value:''},t('taskGeneric')),...definitions.map((/** @type {any} */ item)=>h('option',{key:item.id,value:item.id},item.id)))),
      selectedDefinition ? h('label',null,t('taskWorkflow'),h('select',{'data-browser-flow-input':'task-workflow',value:taskForm.workflowRef,disabled:!!taskSummary,onChange:(/** @type {any} */ event)=>setTaskForm({...taskForm,workflowRef:event.target.value})},...selectedDefinition.workflows.map((/** @type {any} */ row)=>h('option',{key:row.id,value:row.id},row.description)))) : null,
      ...(['create','open','revise','cancel','finish']).map(operation=>h('button',{type:'button','data-browser-flow-action':'task-'+operation,disabled:(['cancel','finish'].includes(operation)?false:busy)||(['revise','cancel','finish'].includes(operation)&&!taskSummary)||(operation==='create'&&!!taskSummary),onClick:()=>{void taskOperation(/** @type {'create'|'open'|'revise'|'cancel'|'finish'|'resume'} */(operation))}},t(operation+'Task'))))

    const rows = pages.map((/** @type {DiscoveredPage} */ page) => h('li', { key: page.lease, 'data-browser-flow-page': page.lease },
      h('div', { className: 'bf-page-title' }, page.title || page.url),
      h('div', { className: 'bf-page-url' }, page.url),
      // The alias is what makes two pages on the same address distinguishable.
      h('div', { className: 'bf-page-alias' }, `${t('pageAlias')}: ${page.tabId}`),
      h('div', { className: 'bf-page-state' }, authorized === page.lease ? t('authorized') : ''),
      h('button', {
        type: 'button',
        disabled: busy || !supported || !taskSummary,
        'data-browser-flow-action': 'authorize',
        onClick: () => { void authorize(page) },
      }, t('authorize'))))

    const fileFields=['path','unitId','legalIdentity','firstRow','lastRow'].map(key=>h('label',{key},t('file_'+key),h('input',{type:'text','data-browser-flow-input':key,value:fileForm[key],disabled:busy,onChange:(/** @type {any} */ event)=>setFileForm({...fileForm,[key]:event.target.value})})))
    const filePanel=authorized&&taskSummary?.adapter==='bjrsj'&&!taskSummary?.writeBlocked?h('section',{'data-browser-flow-import':''},h('h4',null,t('importTitle')),h('p',null,t('importHint')),...fileFields,
      h('label',null,t('file_kind'),h('select',{'data-browser-flow-input':'kind',value:fileForm.kind,disabled:busy,onChange:(/** @type {any} */ event)=>setFileForm({...fileForm,kind:event.target.value})},...['add','modify','reduce'].map(kind=>h('option',{key:kind,value:kind},t('file_'+kind))))),
      h('button',{type:'button','data-browser-flow-action':'prepare-file',disabled:busy,onClick:()=>{void fileOperation('prepare')}},t('prepareFile')),
      filePreview?h('div',{'data-browser-flow-file-preview':''},h('p',null,filePreview.path),h('p',null,`${t('file_kind')}: ${t('file_'+filePreview.kind)}; ${filePreview.bytes} ${t('bytes')}; ${filePreview.rows} ${t('rows')}`),h('p',null,'SHA-256: '+filePreview.sha256),h('p',null,t('stopBoundary')),
        h('button',{type:'button','data-browser-flow-action':'confirm-file',disabled:busy||filePreview.confirmed,onClick:()=>{void fileOperation('confirm')}},t(filePreview.confirmed?'fileConfirmed':'confirmFile'))):null):null
    return h('section', { 'data-browser-flow-panel': '', 'aria-label': t('title') },
      taskPanel,
      filePanel,
      h('header', { className: 'bf-header' },
        h('h3', null, t('title')),
        h('button', {
          type: 'button',
          'data-browser-flow-action': 'revoke',
          disabled: !supported,
          onClick: () => { void revoke() },
        }, t('revoke'))),
      !supported && h('p', { role: 'status' }, t('unsupportedHost')),
      supported && !connected && h('p', { role: 'status' }, t('disconnected')),
      supported && connected && !liveAgent && h('p', { role: 'status' }, t('noAgent')),
      error !== undefined && h('p', { role: 'alert' }, `${t('error')}: ${error.code} ${error.message}`),
      // The user must see which Session and which live Agent instance the grant
      // is attached to before granting it.
      h('p', { className: 'bf-target', 'data-browser-flow-target': '' },
        `${t('session')}: ${sessionId}`,
        agentSummary === undefined || agentSummary === null ? '' : ` · ${t('agentInstance')}: ${agentSummary.instance}`),
      supported && pages.length === 0 ? h('p', null, t('empty')) : null,
      supported && pages.length > 0 ? h('ul', { className: 'bf-pages' }, rows) : null,
      h('p', { className: 'bf-note' }, t('privacy')),
      h('p', { className: 'bf-note' }, t('limit')),
      h('p', { className: 'bf-note' }, t('revokeHint')),
      tabInfo === undefined ? null : h('p', { className: 'bf-note' }, tabInfo.tab.kind))
  }
}
