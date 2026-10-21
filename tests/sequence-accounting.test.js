import { TASK } from './helpers/task-scope.ts'
/**
 * Sequence accounting must stay in step across the panel.
 *
 * The Host advances its sequence when it dispatches a command; the panel must
 * therefore consume the sequence when it *accepts* one, not when it succeeds.
 * Advancing only on success leaves the counters permanently apart after any
 * failed command, and every later command is refused as out of sequence — a
 * page that silently stops accepting work.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { refuseCommand } from '../src/clientcore.ts'

/** One panel binding, as the panel holds it after authorization. */
function bindingAt(sequence) {
  return {
    lease: 'guest-1',
    task:TASK,controlLeaseId: 'lease-1',
    epoch: 0,
    documentToken: 'doc-a',
    url: 'https://a.test/x',
    expectedSequence: sequence,
  }
}

/**
 * The panel's acceptance step: gate, then consume the sequence.
 * @param {object} command - command the Host dispatched.
 * @param {object} binding - panel binding, mutated as the panel would.
 * @param {number} generation - panel connection generation.
 * @returns {boolean} whether the command was accepted.
 */
function accept(command, binding, generation) {
  if (refuseCommand(command, binding, generation) !== undefined) return false
  binding.expectedSequence += 1
  return true
}

describe('sequence accounting across successes and failures', () => {
  it('accepts consecutive commands while the counters advance together', () => {
    const binding = bindingAt(0)
    let hostSequence = 0
    for (let index = 0; index < 3; index += 1) {
      const command = {task:TASK, leaseId: 'lease-1', connectionGeneration: 1, epoch: 0, sequence: hostSequence }
      assert.equal(accept(command, binding, 1), true, `command ${String(index)} must be accepted`)
      // The Host advanced when it dispatched, so both counters move together
      // regardless of whether the page command later succeeded.
      hostSequence += 1
    }
    assert.equal(binding.expectedSequence, hostSequence)
  })

  it('stays in step after a command the page failed', () => {
    const binding = bindingAt(0)
    // The first command is accepted and then fails on the page. Its sequence is
    // still consumed on both sides.
    assert.equal(accept({task:TASK, leaseId: 'lease-1', connectionGeneration: 1, epoch: 0, sequence: 0 }, binding, 1), true)
    // The Host dispatches the next one as 1; it must not be refused.
    assert.equal(accept({task:TASK, leaseId: 'lease-1', connectionGeneration: 1, epoch: 0, sequence: 1 }, binding, 1), true,
      'a failed command must not desynchronize the sequence')
    assert.equal(binding.expectedSequence, 2)
  })

  it('refuses a command that skips a sequence without consuming it', () => {
    const binding = bindingAt(0)
    assert.equal(accept({task:TASK, leaseId: 'lease-1', connectionGeneration: 1, epoch: 0, sequence: 5 }, binding, 1), false)
    assert.equal(binding.expectedSequence, 0, 'a refused command must not consume a sequence')
    // The command the Host actually dispatched next is still accepted.
    assert.equal(accept({task:TASK, leaseId: 'lease-1', connectionGeneration: 1, epoch: 0, sequence: 0 }, binding, 1), true)
  })

  it('refuses a replay of a consumed sequence', () => {
    const binding = bindingAt(0)
    accept({task:TASK, leaseId: 'lease-1', connectionGeneration: 1, epoch: 0, sequence: 0 }, binding, 1)
    assert.equal(accept({task:TASK, leaseId: 'lease-1', connectionGeneration: 1, epoch: 0, sequence: 0 }, binding, 1), false,
      'a replayed command must be refused')
  })
})