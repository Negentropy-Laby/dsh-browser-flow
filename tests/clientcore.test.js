/**
 * Client helper tests: the pure functions the panel bundle inlines.
 *
 * These cover the decisions the browser side makes without a DOM: which program
 * one Host operation maps to, how a guest element's identity markers are read,
 * how an execution outcome is classified (never claiming "did not run" after a
 * throw), and which hosts can run page programs at all.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WEBVIEW_SELECTOR, classifyResult, classifyThrow, hostSupportsPageControl, identityOf, programFor,
} from '../src/clientcore.ts'

/** Program builders that record their arguments. */
function recordingPageCode() {
  const calls = []
  return {
    calls,
    identity: 'identity-source',
    observe: (maxChars, maxNodes) => { calls.push(['observe', maxChars, maxNodes]); return 'observe-source' },
    find: (query, limit) => { calls.push(['find', query, limit]); return 'find-source' },
    act: input => { calls.push(['act', input]); return 'act-source' },
    wait: input => { calls.push(['wait', input]); return 'wait-source' },
  }
}

/** Fake guest element with attributes and ancestors. */
function guest({ name, partition, session, tab }) {
  const attributes = new Map([['name', name], ['partition', partition]])
  return {
    getAttribute: attribute => (attributes.has(attribute) ? attributes.get(attribute) : null),
    closest: selector => {
      if (selector === '[data-sidebar-right-session]') return session === undefined ? null : { getAttribute: () => session }
      if (selector === '[data-sidebar-right-tab]') return tab === undefined ? null : { getAttribute: () => tab }
      return null
    },
  }
}

describe('programFor', () => {
  it('maps each supported operation to its program with the Host arguments', () => {
    const pageCode = recordingPageCode()
    assert.equal(programFor(pageCode, { kind: 'observe', maxChars: 500, maxNodes: 20 }), 'observe-source')
    assert.deepEqual(pageCode.calls.at(-1), ['observe', 500, 20])

    assert.equal(programFor(pageCode, { kind: 'find', query: { by: 'text', value: 'Save' }, limit: 20 }), 'find-source')
    assert.deepEqual(pageCode.calls.at(-1), ['find', { by: 'text', value: 'Save' }, 20])

    const act = programFor(pageCode, {
      kind: 'act', action: 'type', target: { documentToken: 'doc-1', elementRef: 'el-1' }, value: 'x',
    })
    assert.equal(act, 'act-source')
    assert.deepEqual(pageCode.calls.at(-1), ['act', {
      documentToken: 'doc-1', elementRef: 'el-1', action: 'type', value: 'x',
    }])

    const wait = programFor(pageCode, {
      kind: 'wait', condition: 'text', target: { documentToken: 'doc-1', elementRef: 'el-1' }, timeoutMs: 100, text: 'ready',
    })
    assert.equal(wait, 'wait-source')
    assert.deepEqual(pageCode.calls.at(-1), ['wait', {
      condition: 'text', target: { documentToken: 'doc-1', elementRef: 'el-1' }, timeoutMs: 100, text: 'ready',
    }])
  })

  it('does not forward an absent value or checked field', () => {
    const pageCode = recordingPageCode()
    programFor(pageCode, { kind: 'act', action: 'click', target: { documentToken: 'd', elementRef: 'e' } })
    const [, input] = pageCode.calls.at(-1)
    assert.equal('value' in input, false)
    assert.equal('checked' in input, false)
  })

  it('throws for an operation this build does not implement', () => {
    assert.throws(() => programFor(recordingPageCode(), { kind: 'screenshot' }), /unsupported operation/)
  })
})

describe('identityOf', () => {
  it('reads the lease, partition, session and tab markers', () => {
    const element = guest({ name: 'lease-1', partition: 'part-1', session: 'session-1', tab: 'tab-1' })
    assert.deepEqual(identityOf(element), {
      lease: 'lease-1', partition: 'part-1', sessionId: 'session-1', tabId: 'tab-1',
    })
  })

  it('reports empty values when the markers are absent', () => {
    const element = guest({ name: 'lease-2', partition: 'part-2' })
    assert.deepEqual(identityOf(element), { lease: 'lease-2', partition: 'part-2', sessionId: '', tabId: '' })
  })
})

describe('classifyResult', () => {
  it('reports success with the program payload', () => {
    assert.deepEqual(classifyResult({ ok: true, value: { documentToken: 'doc-1' } }), {
      outcome: 'ok', payload: { documentToken: 'doc-1' },
    })
  })

  it('reports a structured page failure', () => {
    assert.deepEqual(classifyResult({ ok: false, error: { code: 'stale_observation', message: 'gone' } }), {
      outcome: 'failed', error: { code: 'stale_observation', message: 'gone' },
    })
  })

  it('reports an unknown outcome when the page returned nothing', () => {
    for (const value of [undefined, null]) {
      assert.equal(classifyResult(value).outcome, 'unknown_outcome')
    }
  })

  it('never claims success for a malformed result', () => {
    const classified = classifyResult({ value: 'not ok' })
    assert.equal(classified.outcome, 'failed')
    assert.equal(classified.error.code, 'internal')
  })

  it('reports an unknown outcome for a thrown execution', () => {
    const classified = classifyThrow(new Error('renderer gone'))
    assert.equal(classified.outcome, 'unknown_outcome')
    assert.equal(classified.error.message, 'renderer gone')
  })
})

describe('hostSupportsPageControl', () => {
  it('accepts only the Desktop product bridge', () => {
    assert.equal(hostSupportsPageControl({ protocolVersion: 1, browser: {} }), true)
    assert.equal(hostSupportsPageControl({ protocolVersion: 2 }), false)
    assert.equal(hostSupportsPageControl(undefined), false)
    assert.equal(hostSupportsPageControl({}), false)
  })

  it('exposes the selector the shipped Browser UI uses for a live guest', () => {
    assert.equal(WEBVIEW_SELECTOR, 'webview[data-sidebar-browser-frame="webview"]')
  })
})
