import { TASK, TASK_VIEW } from './helpers/task-scope.ts'
/** Revocation barriers exercised against the shipped bundle and real React/DOM. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = process.env.DSH_CHECKOUT ?? join(root, '..', 'deepseek-harness')
function dependency(name) {
  const direct = join(checkout, 'node_modules', name)
  if (existsSync(direct)) return direct
  const store = join(checkout, 'node_modules', '.pnpm')
  if (!existsSync(store)) return undefined
  for (const entry of readdirSync(store)) {
    if (!entry.startsWith(`${name.replace('/', '+')}@`)) continue
    const candidate = join(store, entry, 'node_modules', name)
    if (existsSync(candidate)) return candidate
  }
}
function entry(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  return join(directory, manifest.main ?? 'index.js')
}
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const packages = Object.fromEntries(['react', 'react-dom', 'jsdom'].map(name => [name, dependency(name)]))
const missing = Object.entries(packages).filter(([, directory]) => directory === undefined).map(([name]) => name)
const options = { skip: missing.length ? `missing DOM dependencies: ${missing.join(', ')}` : false }

async function withPanel(run, fileRace = false) {
  const { JSDOM } = await import(pathToFileURL(entry(packages.jsdom)).href)
  const react = await import(pathToFileURL(entry(packages.react)).href)
  const React = react.default ?? react
  const client = await import(pathToFileURL(join(packages['react-dom'], 'client.js')).href)
  const main = await import(pathToFileURL(entry(packages['react-dom'])).href)
  const act = React.act ?? (await import(pathToFileURL(join(packages['react-dom'], 'test-utils.js')).href)).act
  const dom = new JSDOM('<div data-sidebar-right-session="session-1"><div data-sidebar-right-tab="tab-1"><webview name="guest-1" partition="persist:one" data-sidebar-browser-frame="webview"></webview></div></div><div id="root"></div>', { url: 'http://127.0.0.1:1/' })
  const { window } = dom
  const guest = window.document.querySelector('webview')
  const identity = { ok: true, value: { url: 'https://example.test/sheet', title: 'Sheet', documentToken: 'doc-1' } }
  const ticks = []
  let identitySource
  let operations = 0
  let clientTime = 0
  let pendingCommands = []
  let holdIdentity = false
  let revokeFailure = false
  const revokeReply = deferred()
  const identityEntered = deferred()
  const identityReply = deferred()
  const hashEntered=deferred();const hashReply=deferred()
  const fileEntered=deferred();const fileReply=deferred();let heldFileOperation
  let resultSeen = deferred()
  const sent = []
  guest.executeJavaScript = async source => {
    identitySource ??= source
    if (source !== identitySource) operations += 1
    if (source === identitySource && holdIdentity) {
      holdIdentity = false
      identityEntered.resolve()
      await identityReply.promise
    }
    return identity
  }
  const fetch = async (route, init) => {
    const body = JSON.parse(init.body)
    sent.push({ route, body })
    let answer = { ok: true, value: {} }
    if (route.endsWith('/poll')) {
      const commands = pendingCommands
      pendingCommands = []
      answer = { ok: true, value: { protocolVersion: 3, task:TASK_VIEW, commands, dropped: [], agent: { id: 'session-1', instance: 'agent-1' } } }
    } else if (route.endsWith('/authorize')) {
      if(body.fileOperation){
        if(body.fileOperation===heldFileOperation){fileEntered.resolve();await fileReply.promise}
        answer={ok:true,value:body.fileOperation==='prepare'?{fileGrantId:'grant',path:'local-fixture.xlsx',sha256:'11'.repeat(32),bytes:1,rows:1,kind:'add'}:{confirmed:true}}
      }else{
      answer = { ok: true, value: {task:TASK,origins:['https://example.test'],controlLeaseId: 'lease-1', epoch: 0, documentToken: 'doc-1', nextSequence: 0 } }
      }
    } else if (route.endsWith('/revoke')) {
      if (revokeFailure) throw new Error('test connection failure')
      await revokeReply.promise
    } else if (route.endsWith('/result')) {
      resultSeen.resolve(body)
    }
    return { json: async () => answer }
  }
  const globals = { window, document: window.document, navigator: window.navigator,
    dshDesktop: { protocolVersion: 1, browser: {} }, fetch,
    setInterval: callback => { ticks.push(callback); return ticks.length }, clearInterval: () => {},
    IS_REACT_ACT_ENVIRONMENT: true, performance: { now: () => clientTime } }
  if(fileRace)globals.crypto={subtle:{digest:()=>{hashEntered.resolve();return hashReply.promise}}}
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })
  let reactRoot
  try {
    let factory
    window.__ModuleLoader__ = { load(registration) { factory = registration.factory } }
    const platform = { react: React, 'react-dom': main.default ?? main, 'react-dom/client': client }
    const requirePlatform = name => {
      assert.ok(Object.hasOwn(platform, name), `non-platform dependency: ${name}`)
      return platform[name]
    }
    new window.Function('require', readFileSync(join(root, 'lib/client.js'), 'utf8'))(requirePlatform)
    const contributions = new Map()
    const locale = new Map()
    factory(requirePlatform).apply({
      locale: { register(name, table) { locale.set(name, table); return () => {} }, bind: name => key => locale.get(name)?.en?.[key] ?? key },
      sidebarRightTabs: { register() { return () => {} } },
      slots: { inject(_name, callback) { return callback() }, register(spec, component) { contributions.set(spec.name, component); return () => {} } },
      effect(callback) { return callback() },
    })
    const container = window.document.getElementById('root')
    reactRoot = client.createRoot(container)
    await act(async () => { reactRoot.render(React.createElement(contributions.get('sidebar.right.pane.tab'), { sessionId: 'session-1' })) })
    await act(async () => { container.querySelector('[data-browser-flow-action="authorize"]').click() })
    const enqueue = (op={ kind: 'act', action: 'click', target: { documentToken: 'doc-1', elementRef: 'el-0' } }) => {
      resultSeen = deferred()
      pendingCommands = [{protocolVersion:3,task:TASK, id: `command-${sent.length}`, leaseId: 'lease-1', connectionGeneration: 1, epoch: 0, sequence: 0,
        budgetMs: 10000, deadlineAt: 0, op }]
    }
    const revoke = async failure => {
      revokeFailure = failure
      await act(async () => { container.querySelector('[data-browser-flow-action="revoke"]').click() })
    }
    const tickToResult = async () => {
      let result
      await act(async () => { ticks[0](); result = await resultSeen.promise })
      return result
    }
    await run({ enqueue, revoke, tickToResult, operations: () => operations, sent,
      beginFileOperation:async stage=>{
        if(stage==='confirm')await act(async()=>{container.querySelector('[data-browser-flow-action="prepare-file"]').click()})
        heldFileOperation=stage
        await act(async()=>{container.querySelector('[data-browser-flow-action="'+(stage==='prepare'?'prepare-file':'confirm-file')+'"]').click();await fileEntered.promise})
      },
      revokeDisabled:()=>container.querySelector('[data-browser-flow-action="revoke"]').disabled,
      finishFileOperation:async()=>{await act(async()=>{fileReply.resolve()});assert.equal(container.querySelector('[data-browser-flow-file-preview]'),null)},
      beginIdentityRace: async () => {
        // The scan finishes first; the command identity probe is held afterwards.
        const previousFetch = globalThis.fetch
        globalThis.fetch = async (route, init) => {
          const answer = await previousFetch(route, init)
          if (route.endsWith('/poll')) holdIdentity = true
          return answer
        }
        await act(async () => { ticks[0](); await identityEntered.promise })
      },
      replaceGuest: () => { guest.replaceWith(guest.cloneNode()) },
      advanceTime: milliseconds => { clientTime += milliseconds },
      finishIdentity: async () => {
        let result
        await act(async () => { identityReply.resolve(); result = await resultSeen.promise })
        return result
      },
      finishRevoke: async () => { await act(async () => { revokeReply.resolve() }) },
      beginHashRace:async()=>{await act(async()=>{ticks[0]();await hashEntered.promise})},
      finishHash:async(value=0x11)=>{let result;await act(async()=>{hashReply.resolve(new Uint8Array(32).fill(value).buffer);result=await resultSeen.promise});return result},
    })
  } finally {
    identityReply.resolve()
    hashReply.resolve(new Uint8Array(32).fill(0x11).buffer)
    fileReply.resolve()
    revokeReply.resolve()
    await act(async () => { reactRoot?.unmount() })
    for (const [key, descriptor] of saved) {
      if (descriptor === undefined) delete globalThis[key]
      else Object.defineProperty(globalThis, key, descriptor)
    }
    window.close()
  }
}

test('local revoke stops actions while the Host reply is pending', options, async () => {
  await withPanel(async panel => {
    await panel.revoke(false)
    panel.enqueue()
    const result = await panel.tickToResult()
    assert.equal(panel.operations(), 0, 'revoked control must not dispatch an action')
    assert.equal(result.outcome, 'failed')
    await panel.finishRevoke()
  })
})

for(const stage of ['prepare','confirm'])test(`user can revoke during a pending file ${stage} receipt`,options,async()=>{
  await withPanel(async panel=>{
    await panel.beginFileOperation(stage)
    assert.equal(panel.revokeDisabled(),false,'a pending file request must not disable revocation')
    await panel.revoke(false)
    await panel.finishFileOperation()
    panel.enqueue();const result=await panel.tickToResult()
    assert.equal(result.outcome,'failed');assert.equal(panel.operations(),0)
    await panel.finishRevoke()
  })
})

const fileOperation=()=>({kind:'act',action:'set_file',target:{documentToken:'doc-1',elementRef:'el-0'},importOwner:'owner',importScope:{kind:'add'},windowMs:25000,file:{fileGrantId:'grant',name:'input.xlsx',expectedIdentity:{unitId:'UNIT1',legalIdentity:'123456789012345678'},sha256:'11'.repeat(32),bytes:1,base64:'eA==',kind:'add'}})
test('revocation during file hashing prevents entry into the guest',options,async()=>{
  await withPanel(async panel=>{panel.enqueue(fileOperation());await panel.beginHashRace();await panel.revoke(false);const result=await panel.finishHash();assert.equal(result.error.code,'revoked');assert.equal(panel.operations(),0);await panel.finishRevoke()},true)
})
test('file hashing cannot renew the remaining command budget',options,async()=>{
  await withPanel(async panel=>{panel.enqueue(fileOperation());await panel.beginHashRace();panel.advanceTime(10000);const result=await panel.finishHash();assert.equal(result.outcome,'dropped');assert.equal(panel.operations(),0)},true)
})
test('corrupt file transfer never reaches the guest',options,async()=>{
  await withPanel(async panel=>{panel.enqueue(fileOperation());await panel.beginHashRace();const result=await panel.finishHash(0);assert.equal(result.error.code,'invalid_request');assert.equal(panel.operations(),0)},true)
})

test('a failed revoke request cannot restore local control', options, async () => {
  await withPanel(async panel => {
    await panel.revoke(true)
    panel.enqueue()
    const result = await panel.tickToResult()
    assert.equal(panel.operations(), 0)
    assert.equal(result.outcome, 'failed')
  })
})

test('an identity probe completing after revoke cannot dispatch the old action', options, async () => {
  await withPanel(async panel => {
    panel.enqueue()
    await panel.beginIdentityRace()
    await panel.revoke(false)
    const result = await panel.finishIdentity()
    assert.equal(panel.operations(), 0)
    assert.equal(result.outcome, 'failed')
    await panel.finishRevoke()
  })
})

test('a replaced guest cannot receive an action after its old identity probe completes', options, async () => {
  await withPanel(async panel => {
    panel.enqueue()
    await panel.beginIdentityRace()
    panel.replaceGuest()
    const result = await panel.finishIdentity()
    assert.equal(panel.operations(), 0)
    assert.equal(result.outcome, 'failed')
  })
})

test('identity probe time cannot renew an expired page-operation budget', options, async () => {
  await withPanel(async panel => {
    panel.enqueue()
    await panel.beginIdentityRace()
    panel.advanceTime(10000)
    const result = await panel.finishIdentity()
    assert.equal(panel.operations(), 0)
    assert.equal(result.outcome, 'dropped')
    assert.equal(result.error.code, 'deadline_exceeded')
  })
})
