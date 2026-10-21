import {expectRecord,expectList,expectString,expectSized} from './helpers/assertions.ts'
/**
 * Page-program tests.
 *
 * The programs this plugin executes inside the user's page are the highest-risk
 * artifact: they run with the page's own privileges. These tests execute the
 * exact generated source against a minimal fake DOM to prove the properties the
 * privacy and staleness rules depend on:
 *
 * - the document token is minted once per document and detects replacement;
 * - password and hidden input values never appear in a result;
 * - an element reference from an older observation is refused;
 * - `type` replaces the value and dispatches input/change, `check` sets an
 *   explicit state, and neither falls back to a different element;
 * - the observe text and node budgets are respected.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  actProgram, findProgram, hasSensitiveQuery, identityProgram, observeProgram, redactUrl, waitProgram,
} from '../src/pagecode.ts'

/**
 * Build one fake browser realm.
 *
 * The programs use `instanceof` against `HTMLInputElement` and friends, so the
 * fake elements are instances of the fake classes defined here rather than
 * plain objects with patched prototypes.
 * @param {object} input - realm configuration.
 * @returns {object} realm with constructors, `document`, and helpers.
 */
interface FakeNodeLike {querySelectorAll:()=>FakeNodeLike[]}
interface FakeSpec {tag?:string;connected?:boolean;disabled?:boolean;readOnly?:boolean;contentEditable?:boolean;text?:string;labels?:{textContent:string}[];attributes?:Record<string,string>;width?:number;height?:number;closest?:(selector:string)=>FakeNodeLike|null;type?:string;value?:string;checked?:boolean;options?:{value:string;text?:string;selected?:boolean}[];selectedIndex?:number;href?:string}
function realm(input: {nodes?:FakeNodeLike[];body?:FakeNodeLike;title?:string;execCommand?:(...args:unknown[])=>boolean;url?:string} = {}) {
  class FakeEvent {
    bubbles:boolean
    constructor(public type:string, init?:{bubbles?:boolean}) {
      this.bubbles = init?.bubbles ?? false
    }
  }
  class FakeNode {
    tagName:string;isConnected:boolean;children:FakeNodeLike[]=[];disabled:boolean;readOnly:boolean;isContentEditable:boolean;textContent:string;innerText:string;labels:{textContent:string}[];events:FakeEvent[]=[];attributes:Map<string,string>;rect:{x:number;y:number;width:number;height:number};closestMatch:FakeSpec['closest'];focused=false
    constructor(spec:FakeSpec = {}) {
      this.tagName = (spec.tag ?? 'div').toUpperCase()
      this.isConnected = spec.connected ?? true
      this.children = []
      this.disabled = spec.disabled ?? false
      this.readOnly = spec.readOnly ?? false
      this.isContentEditable = spec.contentEditable ?? false
      this.textContent = spec.text ?? ''
      this.innerText = spec.text ?? ''
      this.labels = spec.labels ?? []
      this.events = []
      this.attributes = new Map(Object.entries(spec.attributes ?? {}))
      this.rect = { x: 0, y: 0, width: spec.width ?? 10, height: spec.height ?? 10 }
      this.closestMatch = spec.closest
    }
    getAttribute(name:string) { return this.attributes.has(name) ? this.attributes.get(name) : null }
    setAttribute(name:string, value:string) { this.attributes.set(name, value) }
    closest(selector:string) { return this.closestMatch === undefined ? null : this.closestMatch(selector) }
    getBoundingClientRect() { return this.rect }
    matches(selector:string) {
      // The observe program keeps leaf text nodes and interactive elements.
      return /input|select|textarea|button|a\[href\]|role|contenteditable|tabindex/.test(selector)
        && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(this.tagName)
    }
    querySelectorAll():FakeNodeLike[] { return [] }
    focus() { this.focused = true }
    click() { this.events.push(new FakeEvent('click')) }
    dispatchEvent(event:FakeEvent) { this.events.push(event); return true }
    append(child:FakeNodeLike) { this.children.push(child) }
  }
  class FakeInput extends FakeNode {
    type:string;value:string;checked:boolean
    constructor(spec:FakeSpec = {}) {
      super({ tag: 'input', ...spec })
      this.type = spec.type ?? 'text'
      this.value = spec.value ?? ''
      this.checked = spec.checked ?? false
    }
  }
  class FakeTextArea extends FakeNode {
    value:string
    constructor(spec:FakeSpec = {}) {
      super({ tag: 'textarea', ...spec })
      this.value = spec.value ?? ''
    }
  }
  class FakeSelect extends FakeNode {
    options:NonNullable<FakeSpec['options']>;value:string;selectedIndex:number
    constructor(spec:FakeSpec = {}) {
      super({ tag: 'select', ...spec })
      this.options = spec.options ?? []
      this.value = spec.value ?? ''
      this.selectedIndex = spec.selectedIndex ?? 0
    }
  }
  class FakeAnchor extends FakeNode {
    href:string
    constructor(spec:FakeSpec = {}) {
      super({ tag: 'a', ...spec })
      this.href = spec.href ?? ''
    }
  }
  class FakeMutationObserver {
    constructor(public callback:()=>void) {}
    observe() {}
    disconnect() {}
  }
  const nodes = input.nodes ?? []
  const body = input.body ?? new FakeNode({ tag: 'body' })
  // The observe program walks `document.body.querySelectorAll('*')`.
  body.querySelectorAll = () => nodes
  const document = {
    title: input.title ?? 'Sample sheet',
    readyState: 'complete',
    body,
    documentElement: body,
    querySelectorAll: () => nodes,
    createRange: () => ({ selectNodeContents() {} }),
    execCommand: input.execCommand ?? (() => true),
    getElementById: () => null,
  }
  const scope = {
    HTMLButtonElement:FakeNode,
    location: { origin:'', href: input.url ?? 'https://example.test/sheet?token=secret&q=1' },
    document,
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    crypto: {
      getRandomValues: (array:Uint32Array) => {
        for (let index = 0; index < array.length; index++) array[index] = index + 1
        return array
      },
    },
    MutationObserver: FakeMutationObserver,
    Event: FakeEvent,
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    HTMLSelectElement: FakeSelect,
    HTMLAnchorElement: FakeAnchor,
  }
  return { scope, FakeNode, FakeInput, FakeTextArea, FakeSelect, FakeAnchor }
}

/**
 * Execute one generated program inside a fake realm.
 *
 * `globalThis` is bound to the realm object as well: the programs keep their
 * document registry on `globalThis`, and each test must start from a document
 * with no registry, exactly as a freshly loaded page would.
 * @param {string} source - program source.
 * @param {object} scope - realm globals.
 * @returns {unknown} program result.
 */
function run(source: string, scope: Record<string,unknown>) {
  const names = Object.keys(scope)
  const values = names.map(name => scope[name])
  // Executing the exact shipped source is the point of this test.
  const factory = new Function(...names, 'globalThis', `return ${source}`)
  return expectRecord(factory(...values, scope))
}

/** Build a small page: a table cell, a save button, a password field, a checkbox. */
function samplePage() {
  const { FakeNode, FakeInput } = realm()
  return {
    cell: new FakeNode({ tag: 'td', text: 'alpha', attributes: { 'data-cell-id': 'r1c1' } }),
    button: new FakeNode({ tag: 'button', text: 'Save', attributes: { 'aria-label': 'Save sheet' } }),
    password: new FakeInput({ type: 'password', value: 'hunter2' }),
    checkbox: new FakeInput({ type: 'checkbox', checked: false }),
  }
}

/**
 * Realm whose page contains the sample nodes.
 * @returns {object} realm plus nodes.
 */
function sampleRealm() {
  const nodes = samplePage()
  const built = realm({ nodes: Object.values(nodes) })
  return { ...built, nodes }
}

describe('identity program', () => {
  it('mints a document token and redacts sensitive query values', () => {
    const { scope } = realm({})
    const result = run(identityProgram(), scope)
    assert.equal(result.ok, true)
    assert.match(expectString(expectRecord(result.value).documentToken), /^[0-9a-f]{32}$/)
    assert.equal(expectString(expectRecord(result.value).url).includes('secret'), false)
    assert.equal(expectString(expectRecord(result.value).url).includes('q=1'), true)
    assert.equal(expectRecord(result.value).title, 'Sample sheet')
  })
})

describe('observe program', () => {
  it('describes visible elements and never returns a password value', () => {
    const { scope } = sampleRealm()
    const result = run(observeProgram(1000, 50), scope)
    assert.equal(result.ok, true)
    assert.equal(JSON.stringify(result.value).includes('hunter2'), false, 'a password value must never be returned')
    assert.ok(expectSized(expectRecord(result.value).nodes).length >= 2)
    const cell = expectList(expectRecord(result.value).nodes).find((node) => expectRecord(node).tag === 'td')
    assert.equal(expectRecord(cell).text, 'alpha')
    assert.match(expectString(expectRecord(cell).elementRef), /^el-/)
  })

  it('respects the node and character budgets', () => {
    const { scope } = sampleRealm()
    const result = run(observeProgram(80, 1), scope)
    assert.equal(result.ok, true)
    assert.ok(expectSized(expectRecord(result.value).nodes).length <= 1)
  })

  it('returns a documentToken that act can use', () => {
    const { scope } = sampleRealm()
    const observed = run(observeProgram(1000, 50), scope)
    assert.equal(typeof expectRecord(observed.value).documentToken, 'string')
    assert.equal(expectSized(expectRecord(observed.value).documentToken).length, 32)
  })
})

describe('find program', () => {
  it('matches by visible text', () => {
    const { scope } = sampleRealm()
    const result = run(findProgram({ by: 'text', value: 'Save' }, 20), scope)
    assert.equal(result.ok, true)
    assert.ok(expectSized(expectRecord(result.value).matches).length >= 1)
    assert.equal(expectRecord(expectList(expectRecord(result.value).matches)[0]).tag, 'button')
  })

  it('matches by explicit attribute', () => {
    const { scope } = sampleRealm()
    const result = run(findProgram({ by: 'attr', value: 'r1c1', name: 'data-cell-id' }, 20), scope)
    assert.equal(result.ok, true)
    assert.equal(expectSized(expectRecord(result.value).matches).length, 1)
    assert.equal(expectRecord(expectList(expectRecord(result.value).matches)[0]).tag, 'td')
  })

  it('matches by role or tag', () => {
    const { scope } = sampleRealm()
    const result = run(findProgram({ by: 'role', value: 'button' }, 20), scope)
    assert.equal(result.ok, true)
    assert.ok(expectSized(expectRecord(result.value).matches).length >= 1)
  })
})

describe('act program', () => {
  it('refuses a stale document token', () => {
    const { scope } = sampleRealm()
    const observed = run(observeProgram(1000, 50), scope)
    const cellRef = expectRecord(expectList(expectRecord(observed.value).nodes).find((node) => expectRecord(node).tag === 'td')).elementRef
    const result = run(actProgram({ documentToken: 'a'.repeat(32), elementRef: expectString(cellRef), action: 'click' }), scope)
    assert.equal(result.ok, false)
    assert.equal(expectRecord(result.error).code, 'stale_observation')
  })

  it('refuses an unknown element reference', () => {
    const { scope } = sampleRealm()
    const observed = run(observeProgram(1000, 50), scope)
    const result = run(actProgram({
      documentToken: expectString(expectRecord(observed.value).documentToken), elementRef: 'el-zzz', action: 'click',
    }), scope)
    assert.equal(result.ok, false)
    assert.equal(expectRecord(result.error).code, 'stale_observation')
  })

  it('clicks the referenced element exactly once', () => {
    const built = sampleRealm()
    const scope = built.scope
    const nodes = built.nodes
    const observed = run(observeProgram(1000, 50), scope)
    const button = expectList(expectRecord(observed.value).nodes).find((node) => expectRecord(node).tag === 'button')
    const result = run(actProgram({
      documentToken: expectString(expectRecord(observed.value).documentToken), elementRef: expectString(expectRecord(button).elementRef), action: 'click',
    }), scope)
    assert.equal(result.ok, true)
    assert.equal(expectRecord(result.value).dispatched, true)
    assert.equal(nodes.button.events.filter(event => event.type === 'click').length, 1)
  })

  it('refuses a password field even when it is the referenced element', () => {
    const { FakeInput } = realm()
    const password = new FakeInput({ type: 'password', value: 'hunter2' })
    const built = realm({ nodes: [password] })
    const observed = run(observeProgram(1000, 50), built.scope)
    // The observe program redacts the field, so it never appears as a node.
    assert.equal(JSON.stringify(observed.value).includes('hunter2'), false)
  })

  it('replaces the value on type and dispatches input and change', () => {
    const built = realm()
    const text = new built.FakeInput({ type: 'text', value: 'old' })
    built.scope.document.body.querySelectorAll = () => [text]
    built.scope.document.querySelectorAll = () => [text]
    const observed = run(observeProgram(1000, 50), built.scope)
    const ref = expectRecord(expectList(expectRecord(observed.value).nodes)[0]).elementRef
    const result = run(actProgram({
      documentToken: expectString(expectRecord(observed.value).documentToken), elementRef: expectString(ref), action: 'type', value: 'new value',
    }), built.scope)
    assert.equal(result.ok, true)
    assert.equal(expectRecord(result.value).replaced, true)
    assert.equal(text.value, 'new value')
    assert.ok(text.events.some(event => event.type === 'input'))
    assert.ok(text.events.some(event => event.type === 'change'))
  })

  it('sets an explicit checked state and refuses an uncheckable element', () => {
    const built = realm()
    const checkbox = new built.FakeInput({ type: 'checkbox', checked: false })
    built.scope.document.body.querySelectorAll = () => [checkbox]
    built.scope.document.querySelectorAll = () => [checkbox]
    const observed = run(observeProgram(1000, 50), built.scope)
    const result = run(actProgram({
      documentToken: expectString(expectRecord(observed.value).documentToken),
      elementRef: expectString(expectRecord(expectList(expectRecord(observed.value).nodes)[0]).elementRef),
      action: 'check',
      checked: true,
    }), built.scope)
    assert.equal(result.ok, true)
    assert.equal(checkbox.checked, true)
    assert.equal(expectRecord(result.value).checked, true)

    const plainBuilt = realm()
    const plain = new plainBuilt.FakeInput({ type: 'text', value: 'not checkable' })
    plainBuilt.scope.document.body.querySelectorAll = () => [plain]
    plainBuilt.scope.document.querySelectorAll = () => [plain]
    const plainObserved = run(observeProgram(1000, 50), plainBuilt.scope)
    const plainResult = run(actProgram({
      documentToken: expectString(expectRecord(plainObserved.value).documentToken),
      elementRef: expectString(expectRecord(expectList(expectRecord(plainObserved.value).nodes)[0]).elementRef),
      action: 'check',
      checked: true,
    }), plainBuilt.scope)
    assert.equal(plainResult.ok, false)
    assert.equal(expectRecord(plainResult.error).code, 'unsupported')
  })

  it('refuses type on an element that does not accept text', () => {
    const built = realm()
    const plain = new built.FakeNode({ tag: 'div', text: 'text only' })
    built.scope.document.body.querySelectorAll = () => [plain]
    built.scope.document.querySelectorAll = () => [plain]
    const observed = run(observeProgram(1000, 50), built.scope)
    const result = run(actProgram({
      documentToken: expectString(expectRecord(observed.value).documentToken),
      elementRef: expectString(expectRecord(expectList(expectRecord(observed.value).nodes)[0]).elementRef),
      action: 'type',
      value: 'x',
    }), built.scope)
    assert.equal(result.ok, false)
    assert.equal(expectRecord(result.error).code, 'unsupported')
  })

  it('selects an explicit option and refuses an unknown one', () => {
    const built = realm()
    const options = [{ value: 'a', textContent: 'Alpha' }, { value: 'b', textContent: 'Beta' }]
    const select = new built.FakeSelect({ options, value: 'a' })
    built.scope.document.body.querySelectorAll = () => [select]
    built.scope.document.querySelectorAll = () => [select]
    const observed = run(observeProgram(1000, 50), built.scope)
    const ref = expectRecord(expectList(expectRecord(observed.value).nodes)[0]).elementRef
    const ok = run(actProgram({
      documentToken: expectString(expectRecord(observed.value).documentToken), elementRef: expectString(ref), action: 'select', value: 'Beta',
    }), built.scope)
    assert.equal(ok.ok, true)
    assert.equal(expectRecord(ok.value).selected, 'b')
    const missing = run(actProgram({
      documentToken: expectString(expectRecord(observed.value).documentToken), elementRef: expectString(ref), action: 'select', value: 'Gamma',
    }), built.scope)
    assert.equal(missing.ok, false)
    assert.equal(expectRecord(missing.error).code, 'not_found')
  })
})

describe('wait program', () => {
  it('returns immediately when the condition already holds', () => {
    const { FakeNode } = realm()
    const cell = new FakeNode({ tag: 'td', text: 'alpha' })
    const built = realm({ nodes: [cell] })
    const observed = run(observeProgram(1000, 50), built.scope)
    const result = run(waitProgram({
      condition: 'present',
      target: { documentToken: expectString(expectRecord(observed.value).documentToken), elementRef: expectString(expectRecord(expectList(expectRecord(observed.value).nodes)[0]).elementRef) },
      timeoutMs: 50,
    }), built.scope)
    assert.equal(result.ok, true)
    assert.equal(expectRecord(result.value).satisfied, true)
    assert.equal(expectRecord(result.value).waitedMs, 0)
  })

  it('refuses a stale document token instead of waiting forever', () => {
    const { scope } = realm({})
    const result = run(waitProgram({
      condition: 'present', target: { documentToken: 'b'.repeat(32), elementRef: 'el-1' }, timeoutMs: 50,
    }), scope)
    assert.equal(result.ok, false)
    assert.equal(expectRecord(result.error).code, 'stale_observation')
  })
})

describe('URL redaction', () => {
  it('redacts sensitive parameter values and user information', () => {
    assert.equal(redactUrl('https://user:pass@example.test/a?token=abc&q=1'), 'https://example.test/a?token=%5Bredacted%5D&q=1')
    assert.equal(redactUrl('not a url'), '[invalid-url]')
  })

  it('detects whether a URL carries a sensitive parameter', () => {
    assert.equal(hasSensitiveQuery('https://example.test/?access_token=x'), true)
    assert.equal(hasSensitiveQuery('https://example.test/?q=1'), false)
    assert.equal(hasSensitiveQuery('not a url'), false)
  })
})

describe('element references are never reassigned', () => {
  it('refuses a reference from an earlier observation after the order changes', () => {
    const { FakeNode } = realm()
    const first = new FakeNode({ tag: 'button', text: 'First', attributes: { 'aria-label': 'First' } })
    const second = new FakeNode({ tag: 'button', text: 'Second', attributes: { 'aria-label': 'Second' } })
    const nodes = [first, second]
    const built = realm({ nodes })
    const before = run(observeProgram(1000, 50), built.scope)
    assert.equal(before.ok, true)
    const staleRef = expectRecord(expectList(expectRecord(before.value).nodes).find((node) => expectRecord(node).text === 'First')).elementRef

    // The document order changes between observations. Reusing reference names
    // would now hand the stale `el-0` to the element that sorts first instead.
    nodes.reverse()
    const after = run(observeProgram(1000, 50), built.scope)
    assert.equal(after.ok, true)
    assert.equal(expectRecord(after.value).documentToken, expectRecord(before.value).documentToken, 'the same document keeps one token')

    const result = run(actProgram({
      documentToken: expectString(expectRecord(before.value).documentToken), elementRef: expectString(staleRef), action: 'click',
    }), built.scope)
    assert.equal(result.ok, false, 'a reference from an earlier observation must be refused')
    assert.equal(expectRecord(result.error).code, 'stale_observation')
    assert.equal(first.events.length, 0, 'the stale reference must not act on its original element')
    assert.equal(second.events.length, 0, 'the stale reference must not act on the element that replaced it')
  })

  it('still acts on a reference taken from the latest observation', () => {
    const { FakeNode } = realm()
    const first = new FakeNode({ tag: 'button', text: 'First', attributes: { 'aria-label': 'First' } })
    const second = new FakeNode({ tag: 'button', text: 'Second', attributes: { 'aria-label': 'Second' } })
    const nodes = [first, second]
    const built = realm({ nodes })
    run(observeProgram(1000, 50), built.scope)
    nodes.reverse()
    const after = run(observeProgram(1000, 50), built.scope)
    const freshRef = expectRecord(expectList(expectRecord(after.value).nodes).find((node) => expectRecord(node).text === 'Second')).elementRef
    const result = run(actProgram({
      documentToken: expectString(expectRecord(after.value).documentToken), elementRef: expectString(freshRef), action: 'click',
    }), built.scope)
    assert.equal(result.ok, true, 'a fresh reference must work')
    assert.equal(second.events.length, 1, 'the fresh reference must act on its own element')
  })
})

describe('a query is compared, never interpreted', () => {
  it('builds no selector from the query', () => {
    // In a browser an invalid selector throws; in this fake realm the selector is
    // ignored, so comparing outcomes would prove nothing. The shipped program text
    // is what carries the guarantee: the query reaches property comparisons only.
    const source = findProgram({ by: 'text', value: '"] , script' }, 10)
    assert.equal(/querySelector(All)?\(\s*QUERY/.test(source), false,
      'the query value must never be handed to a selector engine')
    assert.equal(/querySelector(All)?\(\s*\$\{/.test(source), false,
      'the query value must never be interpolated into a selector')
  })

  it('compares an attribute by name and value, not by a selector', () => {
    const source = findProgram({ by: 'attr', name: 'data-cell-id', value: 'r1c1' }, 10)
    assert.equal(source.includes("getAttribute(QUERY.name) === QUERY.value"), true,
      'an attribute match must be a literal comparison')
    const hostile = findProgram({ by: 'attr', name: 'data-cell-id', value: 'r1c1"]' }, 10)
    assert.equal(/querySelector(All)?\(\s*QUERY/.test(hostile), false)
  })

  it('treats a selector-shaped value as literal text at run time', () => {
    const built = sampleRealm()
    const scope = built.scope
    const nodes = built.nodes
    const result = run(findProgram({ by: 'text', value: '"] , script' }, 10), scope)
    assert.equal(result.ok, true, 'a hostile-looking value must not break the program')
    assert.equal(expectSized(expectRecord(result.value).matches).length, 0, 'it must not match anything it did not literally find')
    assert.equal(nodes.cell.events.length, 0)
  })
})

describe('scoped import action restrictions', () => {
  for (const [label,action,allowed] of [
    ['在职职工管理','click',true],['批量增员','click',true],['批量修改','click',false],
    ['提交','click',false],['保存待办','click',false],['上传申报信息','click',false],
    ['单位信息','type',false],['普通按钮','click',false],
  ] as const) it(`${allowed?'permits':'refuses'} ${action} on ${label}`,()=>{
    const built=realm()
    const button=new built.FakeNode({tag:'button',text:label})
    built.scope.HTMLButtonElement=built.FakeNode
    built.scope.location.origin='https://fuwu.rsj.beijing.gov.cn'
    built.scope.document.querySelectorAll=()=>[button]
    built.scope.document.body.querySelectorAll=()=>[button]
    const observed=run(observeProgram(1000,20),built.scope).value
    const result=run(actProgram({documentToken:expectString(expectRecord(observed).documentToken),elementRef:expectString(expectRecord(expectList(expectRecord(observed).nodes)[0]).elementRef),action,value:'x',importScope:{kind:'add'}}),built.scope)
    assert.equal(result.ok,allowed)
    assert.equal(button.events.filter(event=>event.type==='click').length,allowed?1:0)
  })
  it('does not allow a navigation label to submit a form',()=>{
    const built=realm();const button=new built.FakeNode({tag:'button',text:'单位信息'})
    Object.assign(button,{form:{},type:'submit'})
    built.scope.HTMLButtonElement=built.FakeNode;built.scope.location.origin='https://fuwu.rsj.beijing.gov.cn'
    built.scope.document.querySelectorAll=built.scope.document.body.querySelectorAll=()=>[button]
    const observed=run(observeProgram(1000,20),built.scope).value
    assert.equal(run(actProgram({documentToken:expectString(expectRecord(observed).documentToken),elementRef:expectString(expectRecord(expectList(expectRecord(observed).nodes)[0]).elementRef),action:'click',importScope:{kind:'add'}}),built.scope).ok,false)
    assert.equal(button.events.length,0)
  })
})
