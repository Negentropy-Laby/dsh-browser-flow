import { TASK, TASK_VIEW } from './helpers/task-scope.js'
/**
 * The panel-side execution gate.
 *
 * The Host chooses what to dispatch; the panel must still refuse a command that
 * does not address the authorization it holds. Before this gate existed a
 * command minted for one authorization executed against whatever page the panel
 * was bound to — so authorizing a second page could redirect an in-flight call.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { navigationEvent, refuseCommand } from '../src/clientcore.js'

/** The authorization a panel holds. */
const binding = {
  lease: 'guest-1',
  task:TASK, controlLeaseId: 'lease-1',
  epoch: 2,
  documentToken: 'doc-a',
  url: 'https://a.test/x',
  expectedSequence: 5,
}

/** A command the Host would dispatch for that authorization. */
const command = {
  task:TASK, id: 'cmd-1', leaseId: 'lease-1', connectionGeneration: 3,
  epoch: 2, sequence: 5, op: { kind: 'observe' },
}

/**
 * Return the refusal code, or 'accepted' when the gate lets the command pass.
 * @param {object} candidate - command under test.
 * @param {object | undefined} held - binding under test.
 * @param {number} generation - panel connection generation.
 * @returns {string} refusal code or 'accepted'.
 */
function verdict(candidate, held, generation) {
  const refused = refuseCommand(candidate, held, generation)
  return refused === undefined ? 'accepted' : refused.error.code
}

describe('a command must address the authorization the panel holds', () => {
  it('accepts the exact command the Host minted for this authorization', () => {
    assert.equal(verdict(command, binding, 3), 'accepted')
  })

  it('refuses a command minted for another control lease', () => {
    // The user authorized a different page; this command belongs to the old one.
    assert.equal(verdict({ ...command, leaseId: 'lease-2' }, binding, 3), 'not_authorized')
  })

  it('refuses a command from an earlier panel connection', () => {
    assert.equal(verdict({ ...command, connectionGeneration: 2 }, binding, 3), 'connection_stale')
  })

  it('refuses a command for another epoch', () => {
    assert.equal(verdict({ ...command, epoch: 1 }, binding, 3), 'stale_observation')
  })

  it('refuses a command that is not the strictly next sequence', () => {
    assert.equal(verdict({ ...command, sequence: 4 }, binding, 3), 'stale_observation')
    assert.equal(verdict({ ...command, sequence: 6 }, binding, 3), 'stale_observation')
    assert.equal(verdict({ ...command, sequence: 5 }, binding, 3), 'accepted', 'the exact next sequence passes')
  })

  it('refuses every command when the panel holds no authorization', () => {
    assert.equal(verdict(command, undefined, 3), 'not_authorized')
  })
})

describe('R01: a document change names the invalidation to report', () => {
  it('treats a same-origin navigation as same-origin', () => {
    assert.equal(navigationEvent('https://a.test/x', 'https://a.test/y?q=1'), 'same_origin_navigation')
  })

  it('treats a different origin, scheme or port as cross-origin', () => {
    assert.equal(navigationEvent('https://a.test/x', 'https://b.test/x'), 'cross_origin_navigation')
    assert.equal(navigationEvent('https://a.test/x', 'http://a.test/x'), 'cross_origin_navigation')
    assert.equal(navigationEvent('https://a.test/x', 'https://a.test:8443/x'), 'cross_origin_navigation')
  })

  it('treats an unreadable or missing address as cross-origin', () => {
    assert.equal(navigationEvent(undefined, 'https://a.test/x'), 'cross_origin_navigation')
    assert.equal(navigationEvent('https://a.test/x', undefined), 'cross_origin_navigation')
    assert.equal(navigationEvent('not a url', 'https://a.test/x'), 'cross_origin_navigation')
  })
})
