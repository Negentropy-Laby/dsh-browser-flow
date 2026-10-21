/**
 * A command may only use the budget it has left.
 *
 * The Host's deadline covers the whole call. A `wait` that runs for its full
 * requested timeout can outlive that deadline; by then the Host has settled the
 * call as an unknown outcome while the page keeps waiting — the "renewing the
 * budget" failure. The panel therefore hands the page only the time it
 * still has, minus a margin to report back.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { capToBudget } from '../src/clientcore.ts'

const wait = timeoutMs => ({ kind: 'wait', condition: 'present', target: { documentToken: 'doc-1', elementRef: 'el-0' }, timeoutMs })

describe('the budget caps what the page may spend', () => {
  it('shortens a wait that asked for more than is left', () => {
    const capped = capToBudget(wait(30000), 5000, 250)
    assert.equal(capped.timeoutMs, 4750, 'the wait gets the remaining time minus the reporting margin')
  })

  it('leaves a wait that already fits', () => {
    const capped = capToBudget(wait(1000), 5000, 250)
    assert.equal(capped.timeoutMs, 1000, 'a shorter wait keeps its own timeout')
  })

  it('never returns a negative timeout', () => {
    assert.equal(capToBudget(wait(30000), 100, 250).timeoutMs, 0)
    assert.equal(capToBudget(wait(30000), -5000, 250).timeoutMs, 0)
  })

  it('leaves operations without a time allowance untouched', () => {
    const observe = { kind: 'observe', maxChars: 100, maxNodes: 5 }
    assert.equal(capToBudget(observe, 50), observe, 'an observation has no window of its own to cap')
    const act = { kind: 'act', action: 'click', target: { documentToken: 'doc-1', elementRef: 'el-0' } }
    assert.equal(capToBudget(act, 50), act)
  })

  it('does not mutate the operation the Host dispatched', () => {
    const original = wait(30000)
    const capped = capToBudget(original, 5000, 250)
    assert.equal(original.timeoutMs, 30000, 'the dispatched envelope is left as it arrived')
    assert.notEqual(capped, original)
    assert.notEqual(capped.target, undefined, 'the rest of the operation is carried through')
  })

  it('fills in a timeout when the wait did not state one', () => {
    const open = { kind: 'wait', condition: 'present', target: { documentToken: 'doc-1', elementRef: 'el-0' } }
    assert.equal(capToBudget(open, 4000, 250).timeoutMs, 3750)
  })
})
