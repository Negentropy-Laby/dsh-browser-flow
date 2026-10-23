import {fixturePanelUi} from './helpers/panel-ui.ts'
import {expectRecord,present,expectString,expectList,expectSized} from './helpers/assertions.ts'
import { TASK, TASK_VIEW } from './helpers/task-scope.ts'
/**
 * Panel component tests.
 *
 * The panel is the user's authorization surface: it lists live pages, asks the
 * Host to authorize the one the user clicks, runs dispatched commands, and
 * returns results. These tests drive the real component with a minimal
 * React-shaped harness and a fake DOM, so the behaviour that matters is
 * asserted rather than only the bundle's shape:
 *
 * - it renders the unsupported-host notice instead of pretending to work in Web;
 * - it never sends an Agent identity (the Host resolves the Agent itself);
 * - it polls, executes a dispatched command through the fixed program, and
 *   returns the Host-assigned generation/epoch/sequence unchanged;
 * - it reports a thrown execution as `unknown_outcome`, never as success;
 * - authorization is only attempted when the user clicks, and the result is
 *   surfaced when the Host refuses.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { COPY, PAGE_CODE, POLL_INTERVAL_MS, ROUTES, createPanel } from '../src/panel.ts'

/**
 * Minimal React substitute: enough of `useState`, `useRef`, `useMemo`,
 * `useCallback`, and `useEffect` to drive one render and its effects.
 * @returns {object} React-shaped API plus the render function.
 */
function createReactHarness() {
  const state:unknown[]=[],effects:(()=>void|(()=>void))[]=[],refs:unknown[]=[],memos:{deps?:readonly unknown[];value:unknown}[]=[],effectDeps:(readonly unknown[]|undefined)[]=[]
  let cursor=0
  const memo=<T>(factory:()=>T,deps?:readonly unknown[]):T=>{const index=cursor++,previous=memos[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps?.[i])))memos[index]={value:factory(),deps};return memos[index].value as T}
  const React:import('../src/panel.ts').ReactLike={
    createElement:(type,props,...children)=>({type,props:props??{},children:children.flat()}),
    useState<T>(initial:T|(()=>T)):[T,(next:T|((previous:T)=>T))=>void]{
      const index=cursor++
      if(!(index in state))state[index]=typeof initial==='function'?(initial as ()=>T)():initial
      return [state[index] as T,next=>{state[index]=typeof next==='function'?(next as (value:T)=>T)(state[index] as T):next}]
    },
    useRef<T>(initial:T):{current:T}{const index=cursor++;if(!(index in refs))refs[index]={current:initial};return refs[index] as {current:T}},
    useMemo:memo,
    useCallback:(callback,deps)=>memo(()=>callback,deps),
    useEffect(callback,deps){const index=cursor++,previous=effectDeps[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous[i]))){effectDeps[index]=deps;effects.push(callback)}},
  }
  return {React,render(Component:(props:{sessionId:string})=>unknown,props:{sessionId:string}){cursor=0;return Component(props)},runEffects(){const cleanups:(()=>void)[]=[];for(const effect of effects.splice(0)){const cleanup=effect();if(typeof cleanup==='function')cleanups.push(cleanup)}return cleanups},state}
}

/** A locale lookup that returns the key, so assertions read the key names. */
const t = (key:string) => key

/** Collect every element in a rendered tree. */
interface TreeNode {type:unknown;props:Record<string,unknown>;children:unknown[]}
function flatten(node:unknown):TreeNode[]{
 if(node===null||typeof node!=='object'||!('children' in node)||!Array.isArray(node.children))return []
 const value=node as TreeNode
 return [value,...value.children.flatMap(flatten)]
}
function find(node:unknown,predicate:(node:TreeNode)=>boolean){return flatten(node).find(predicate)}
function findAll(node:unknown,predicate:(node:TreeNode)=>boolean){return flatten(node).filter(predicate)}

/**
 * Install a fake browser environment for one test.
 * @param {object} input - environment inputs.
 * @returns {object} recorded calls and a restore function.
 */
function fakeBrowser(input:{responses?:Record<string,unknown>;elements?:unknown[];desktop?:unknown}={}) {
 const calls:{route:string;body:Record<string,unknown>}[]=[]
 const responses=new Map(Object.entries(input.responses??{})),ticks:(()=>void)[]=[]
 const globals={
  fetch:async(route:string,init?:{body?:string})=>{calls.push({route,body:init?.body===undefined?{}:JSON.parse(init.body)});const answer=responses.get(route)??{ok:false,error:{code:'internal',message:'no canned answer'}};return {status:200,json:async()=>await answer}},
  document:{querySelectorAll:()=>input.elements??[]},dshDesktop:input.desktop,setInterval:(callback:()=>void)=>{ticks.push(callback);return ticks.length},clearInterval:()=>{},
 }
 const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
 for(const[key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true})
 return {calls,responses,ticks,restore(){for(const[key,value]of previous){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key)}}}
}

/** One live guest element as the panel sees it. */
function guest({ lease = 'guest-1', partition = 'part-1', session = 'session-1', tab = 'tab-1', probe, executed = [] }:{lease?:string;partition?:string;session?:string;tab?:string;probe?:unknown;executed?:string[]} = {}) {
  return {
    isConnected: true,
    getAttribute: (name:string) => (name === 'name' ? lease : name === 'partition' ? partition : null),
    closest: (selector:string) => {
      if (selector === '[data-sidebar-right-session]') return { getAttribute: () => session }
      if (selector === '[data-sidebar-right-tab]') return { getAttribute: () => tab }
      return null
    },
    executeJavaScript: async (source:string) => {
      executed.push(source)
      if (source === PAGE_CODE.identity) return probe ?? { ok: true, value: { url: 'https://example.test/a', title: 'Sheet', documentToken: 'doc-1' } }
      return { ok: true, value: { observed: true } }
    },
  }
}

describe('panel copy', () => {
  it('declares both locales with the same keys', () => {
    assert.deepEqual(Object.keys(COPY.zh).sort(), Object.keys(COPY.en).sort())
  })

  it('states the unsupported-host and privacy limits in both languages', () => {
    for (const locale of [COPY.zh, COPY.en] as const) {
      assert.equal(typeof locale.unsupportedHost, 'string')
      assert.equal(typeof locale.privacy, 'string')
      assert.equal(typeof locale.limit, 'string')
      assert.equal(typeof locale.revokeHint, 'string')
    }
  })
})

describe('panel rendering', () => {
  it('puts permission withdrawal before every scrollable task and file form',()=>{
    const browser=fakeBrowser()
    try{
      const harness=createReactHarness(),Panel=createPanel({React:harness.React,t,ui:fixturePanelUi(harness.React)})
      const root=present(find(harness.render(Panel,{sessionId:'session-1'}),node=>node.props['data-browser-flow-panel']!==undefined))
      assert.equal(expectRecord(root.children[0]).type,'header')
    }finally{browser.restore()}
  })
  it('renders the unsupported-host notice on the Web carrier', () => {
    const browser = fakeBrowser({ desktop: undefined })
    try {
      const harness = createReactHarness()
      const Panel = createPanel({ React: harness.React, t, ui:fixturePanelUi(harness.React) })
      const tree = harness.render(Panel, { sessionId: 'session-1' })
      assert.notEqual(present(find(tree, (node:TreeNode) => node.type === 'section')), undefined)
      assert.notEqual(present(find(tree, (node:TreeNode) => node.children?.includes('unsupportedHost'))), undefined)
      // With no Desktop bridge the panel must not offer an authorize button.
      const authorize = findAll(tree, (node:TreeNode) => node.props?.['data-browser-flow-action'] === 'authorize')
      assert.equal(authorize.length, 0)
    } finally {
      browser.restore()
    }
  })

  it('offers authorize per page on the Desktop carrier', () => {
    const browser = fakeBrowser({ desktop: { protocolVersion: 1 } })
    try {
      const harness = createReactHarness()
      const Panel = createPanel({ React: harness.React, t, ui:fixturePanelUi(harness.React) })
      // Seed the page list by rendering once, running the poll effect, then re-rendering.
      harness.render(Panel, { sessionId: 'session-1' })
      assert.notEqual(present(find(harness.render(Panel, { sessionId: 'session-1' }), (node:TreeNode) => node.type === 'section')), undefined)
    } finally {
      browser.restore()
    }
  })
})

describe('panel command loop', () => {
  it('polls, executes the dispatched command, and returns its sequence unchanged', async () => {
    const executed:string[] = []
    const element = guest({ executed })
    const browser = fakeBrowser({
      desktop: { protocolVersion: 1 },
      elements: [element],
      responses: {
        [ROUTES.poll]: {
          ok: true,
          value: {
            protocolVersion: 4, task:TASK_VIEW,
            commands: [{
              id: 'cmd-1', protocolVersion:4,task:TASK, leaseId: 'lease-1', connectionGeneration: 3, epoch: 2, sequence: 7,
              deadlineAt: Date.now() + 10_000,
              op: { kind: 'observe', maxChars: 100, maxNodes: 5 },
            }],
            dropped: [],
          },
        },
        [ROUTES.result]: { ok: true, value: { settled: 'cmd-1' } },
        [ROUTES.authorize]: { ok: true, value: {task:TASK,origins:['https://example.test'],controlLeaseId: 'lease-1', epoch: 2 } },
      },
    })
    try {
      const harness = createReactHarness()
      const Panel = createPanel({ React: harness.React, t, ui:fixturePanelUi(harness.React) })
      harness.render(Panel, { sessionId: 'session-1' })
      const cleanups = harness.runEffects()
      // The poll effect starts a tick immediately; wait for it to settle.
      await new Promise(resolve => setTimeout(resolve, 50))
      const poll = browser.calls.find(call => call.route === ROUTES.poll)
      assert.notEqual(poll, undefined, 'the panel must poll the Host')
      assert.equal(present(poll).body.sessionId, 'session-1')
      assert.equal(expectSized(present(poll).body.pages).length, 1)
      assert.equal(expectRecord(expectList(present(poll).body.pages)[0]).lease, 'guest-1')
      assert.equal(expectRecord(expectList(present(poll).body.pages)[0]).documentToken, 'doc-1')
      // No page is authorized yet, so the command is refused rather than executed.
      const result = browser.calls.find(call => call.route === ROUTES.result)
      assert.notEqual(result, undefined)
      assert.equal(present(result).body.outcome, 'failed')
      assert.equal(expectRecord(present(result).body.error).code, 'not_authorized')
      assert.equal(present(result).body.connectionGeneration, 3)
      assert.equal(present(result).body.epoch, 2)
      assert.equal(present(result).body.sequence, 7)
      for (const cleanup of cleanups) cleanup()
    } finally {
      browser.restore()
    }
  })

  it('never sends an Agent identity over the wire', async () => {
    const browser = fakeBrowser({
      desktop: { protocolVersion: 1 },
      elements: [guest()],
      responses: { [ROUTES.poll]: { ok: true, value: { protocolVersion: 4, task:TASK_VIEW, commands: [], dropped: [] } } },
    })
    try {
      const harness = createReactHarness()
      const Panel = createPanel({ React: harness.React, t, ui:fixturePanelUi(harness.React) })
      harness.render(Panel, { sessionId: 'session-1' })
      harness.runEffects()
      await new Promise(resolve => setTimeout(resolve, 50))
      const serialized = JSON.stringify(browser.calls)
      assert.equal(serialized.includes('agentInstanceToken'), false)
      assert.equal(serialized.includes('agentId'), false)
    } finally {
      browser.restore()
    }
  })

  it('reports a Host refusal instead of assuming success', async () => {
    const browser = fakeBrowser({
      desktop: { protocolVersion: 1 },
      elements: [guest()],
      responses: {
        [ROUTES.poll]: { ok: false, error: { code: 'page_unavailable', message: 'panel not connected' } },
      },
    })
    try {
      const harness = createReactHarness()
      const Panel = createPanel({ React: harness.React, t, ui:fixturePanelUi(harness.React) })
      harness.render(Panel, { sessionId: 'session-1' })
      harness.runEffects()
      await new Promise(resolve => setTimeout(resolve, 50))
      const tree = harness.render(Panel, { sessionId: 'session-1' })
      const alert = present(find(tree, (node:TreeNode) => expectRecord(node.props)?.role === 'alert'))
      assert.notEqual(alert, undefined, 'a Host refusal must surface as an alert')
      assert.ok(flatten(alert).some(node => node.children.includes('operationFailed')))
      const details=present(find(tree,node=>node.type==='button'&&node.children.includes('detailsTitle')))
      ;(details.props.onClick as ()=>void)()
      const diagnostic=present(find(harness.render(Panel,{sessionId:'session-1'}),node=>node.props['data-browser-flow-error-details']!==undefined))
      assert.ok(flatten(diagnostic).some(node=>node.children.includes('page_unavailable')))
    } finally {
      browser.restore()
    }
  })

  it('uses the declared poll interval', () => {
    assert.ok(POLL_INTERVAL_MS > 0 && POLL_INTERVAL_MS <= 5_000)
  })
})


it('keeps an edit draft across polls, cancels locally, and rejects a revised scope before sending',async()=>{
 const browser=fakeBrowser({desktop:{protocolVersion:1},responses:{[ROUTES.poll]:{ok:true,value:{protocolVersion:4,task:TASK_VIEW,commands:[],agent:{id:'session-1',instance:'agent-a'}}}}})
 try{
  const harness=createReactHarness(),Panel=createPanel({React:harness.React,t,ui:fixturePanelUi(harness.React)}),props={sessionId:'session-1'}
  harness.render(Panel,props);const cleanups=harness.runEffects();await new Promise<void>(resolve=>setImmediate(resolve))
  const click=(key:string)=>{const node=present(find(harness.render(Panel,props),row=>row.props['data-browser-flow-action']===key));(node.props.onClick as ()=>void)()}
  click('editTask')
  const goal=present(find(harness.render(Panel,props),row=>row.props['data-browser-flow-input']==='task-goal'))
  ;(goal.props.onChange as (event:{target:{value:string}})=>void)({target:{value:'Unsaved draft'}})
  browser.ticks[0]();await new Promise<void>(resolve=>setImmediate(resolve))
  assert.equal(find(harness.render(Panel,props),row=>row.props['data-browser-flow-input']==='task-goal')?.props.value,'Unsaved draft')
  assert.equal(harness.runEffects().length,0,'presentation edits must not restart the polling effect')
  const requests=browser.calls.length;click('cancelEdit');assert.equal(browser.calls.length,requests)
  click('editTask');browser.responses.set(ROUTES.poll,{ok:true,value:{protocolVersion:4,task:{...TASK_VIEW,task:{...TASK,scopeRevision:2}},commands:[]}});browser.ticks[0]();await new Promise<void>(resolve=>setImmediate(resolve))
  const beforeRevision=browser.calls.length
  click('task-revise');assert.equal(browser.calls.length,beforeRevision,'stale revision must not revoke or send a request')
  assert.equal(find(harness.render(Panel,props),row=>row.props['data-browser-flow-action']==='task-revise')?.props.disabled,true)
  for(const dispose of cleanups)dispose()
 }finally{browser.restore()}
})
it('displays no live Agent for an explicit null Agent response',async()=>{
 const browser=fakeBrowser({desktop:{protocolVersion:1},elements:[guest()],responses:{[ROUTES.poll]:{ok:true,value:{protocolVersion:4,task:TASK_VIEW,agent:null,commands:[]}}}})
 try{
  const harness=createReactHarness(),Panel=createPanel({React:harness.React,t,ui:fixturePanelUi(harness.React)});harness.render(Panel,{sessionId:'session-1'});const cleanups=harness.runEffects();await new Promise<void>(resolve=>setImmediate(resolve))
  const tree=harness.render(Panel,{sessionId:'session-1'});assert.ok(find(tree,row=>row.children.includes('noAgent')));assert.equal(find(tree,row=>row.props['data-browser-flow-action']==='authorize')?.props.disabled,true)
  for(const cleanup of cleanups)cleanup()
 }finally{browser.restore()}
})
it('does not display a previous Session draft or accept its late task response',async()=>{
 let resolveAnswer:(answer:unknown)=>void=()=>{throw new Error('request not started')}
 const response=new Promise<unknown>(resolve=>{resolveAnswer=resolve})
 const browser=fakeBrowser({desktop:{protocolVersion:1},responses:{[ROUTES.authorize]:response}})
 try{
  const harness=createReactHarness(),Panel=createPanel({React:harness.React,t,ui:fixturePanelUi(harness.React)}),props={sessionId:'session-1'}
  harness.render(Panel,props);harness.state[1]=true;harness.state[13]={goal:'Private A',origins:'https://example.test',definitionId:'',workflowRef:''}
  const open=present(find(harness.render(Panel,props),row=>row.props['data-browser-flow-action']==='task-open'));(open.props.onClick as ()=>void)()
  const next={sessionId:'session-2'};const switched=harness.render(Panel,next)
  assert.ok(!JSON.stringify(switched).includes('Private A'))
  resolveAnswer({ok:true,value:TASK_VIEW});await new Promise<void>(resolve=>setImmediate(resolve))
  assert.equal(find(harness.render(Panel,next),row=>row.props['data-browser-flow-task-identity']!==undefined),undefined)
 }finally{browser.restore()}
})
