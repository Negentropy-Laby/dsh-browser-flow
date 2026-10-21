import { TASK, TASK_VIEW } from './helpers/task-scope.ts'
/**
 * Protocol boundary tests: everything the Host and the Client accept from each
 * other is validated structurally, and an invalid message never partially
 * applies.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ERROR_CODES, PROTOCOL_VERSION, encodePayload, failure, isRetryable, success,
  validateCommand, validateHello, validateResult,
} from '../src/protocol.ts'

/** A valid command envelope for mutation in tests. */
function command(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'command', protocolVersion:3, task:TASK,
    id: 'cmd-1',
    leaseId: 'lease-1',
    connectionGeneration: 1,
    epoch: 0,
    sequence: 0,
    deadlineAt: 1000,
    op: { kind: 'observe', maxChars: 1000, maxNodes: 50 },
    ...overrides,
  }
}

/** A valid hello envelope for mutation in tests. */
function hello(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'hello',
    protocolVersion: PROTOCOL_VERSION,
    connectionGeneration: 1,
    sessionId: 'session-1',
    panel: {
      instanceId: 'panel-1',
      pages: [{ lease: 'guest-1', partition: 'part-1', url: 'https://example.test/a', documentToken: 'doc-1' }],
    },
    ...overrides,
  }
}

/** A valid result envelope for mutation in tests. */
function result(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'result', protocolVersion:3, task:TASK,
    instanceId: 'panel-1',
    id: 'cmd-1',
    leaseId: 'lease-1',
    connectionGeneration: 1,
    epoch: 0,
    sequence: 0,
    outcome: 'ok',
    payload: { documentToken: 'doc-1' },
    ...overrides,
  }
}

describe('validateCommand', () => {
  it('accepts a minimal observe command and keeps only known fields', () => {
    const verdict = validateCommand(command({ extra: 'dropped' }))
    assert.equal(verdict.ok, true)
    assert.equal(verdict.command.kind, 'command')
    assert.equal('extra' in verdict.command, false)
    assert.deepEqual(verdict.command.op, { kind: 'observe', maxChars: 1000, maxNodes: 50 })
  })

  it('rejects a non-object, a wrong kind, and a missing identity field', () => {
    const cases: [unknown, RegExp][] = [
      [null, /command must be an object/],
      [command({ kind: 'other' }), /kind must be "command"/],
      [command({ id: '' }), /id is required/],
      [command({ leaseId: undefined }), /leaseId is required/],
      [command({ sequence: -1 }), /sequence is required/],
      [command({ epoch: 1.5 }), /epoch is required/],
      [command({ connectionGeneration: 'one' }), /connectionGeneration is required/],
    ]
    for (const [input, reason] of cases) {
      const verdict = validateCommand(input)
      assert.equal(verdict.ok, false, `expected refusal for ${JSON.stringify(input)}`)
      assert.match(verdict.reason, reason)
    }
  })

  it('rejects an unknown operation and an unknown action', () => {
    assert.equal(validateCommand(command({ op: { kind: 'script', source: 'alert(1)' } })).ok, false)
    const act = validateCommand(command({ op: { kind: 'act', action: 'paste', target: { documentToken: 'd', elementRef: 'e' } } }))
    assert.equal(act.ok, false)
    assert.match(act.reason, /act.action is unknown/)
  })

  it('rejects a find query that could smuggle a selector', () => {
    const bySelector = validateCommand(command({ op: { kind: 'find', query: { by: 'css', value: '*' }, limit: 5 } }))
    assert.equal(bySelector.ok, false)
    assert.match(bySelector.reason, /find.query.by is unknown/)
    const attrWithoutName = validateCommand(command({ op: { kind: 'find', query: { by: 'attr', value: 'x' }, limit: 5 } }))
    assert.equal(attrWithoutName.ok, false)
    assert.match(attrWithoutName.reason, /name is required for attr/)
  })

  it('requires the action-specific fields and refuses extras on click', () => {
    const target = { documentToken: 'doc-1', elementRef: 'el-1' }
    assert.equal(validateCommand(command({ op: { kind: 'act', action: 'type', target } })).ok, false)
    assert.equal(validateCommand(command({ op: { kind: 'act', action: 'select', target } })).ok, false)
    assert.equal(validateCommand(command({ op: { kind: 'act', action: 'check', target } })).ok, false)
    const clickWithValue = validateCommand(command({ op: { kind: 'act', action: 'click', target, value: 'x' } }))
    assert.equal(clickWithValue.ok, false)
    assert.match(clickWithValue.reason, /click takes no value/)
    const ok = validateCommand(command({ op: { kind: 'act', action: 'check', target, checked: false } }))
    assert.equal(ok.ok, true)
    assert.equal(ok.command.op.checked, false)
  })

  it('requires the text for a text wait and validates the wait bound', () => {
    const target = { documentToken: 'doc-1', elementRef: 'el-1' }
    const missingText = validateCommand(command({ op: { kind: 'wait', condition: 'text', target, timeoutMs: 10 } }))
    assert.equal(missingText.ok, false)
    assert.match(missingText.reason, /wait.text is required/)
    const ok = validateCommand(command({ op: { kind: 'wait', condition: 'absent', target, timeoutMs: 10 } }))
    assert.equal(ok.ok, true)
  })
})

describe('validateResult', () => {
  it('refuses non-string optional diagnostics before accepting a terminal result', () => {
    for (const error of [42, {message: 42}, {message: 'x'.repeat(4001)}] as const) {
      assert.equal(validateResult(result({outcome:'unknown_outcome',error})).ok,false)
    }
  })
  it('requires a nonempty panel instance id', () => {
    for (const instanceId of [undefined, '', 42] as const) {
      const verdict = validateResult(result({ instanceId }))
      assert.equal(verdict.ok, false)
      assert.match(verdict.reason, /instanceId/)
    }
  })

  it('accepts a well-formed success and drops unknown fields', () => {
    const verdict = validateResult(result({ ignored: true }))
    assert.equal(verdict.ok, true)
    assert.equal('ignored' in verdict.result, false)
  })

  it('accepts each terminal outcome', () => {
    for (const outcome of ['ok', 'dropped', 'unknown_outcome'] as const) {
      assert.equal(validateResult(result({ outcome })).ok, true, outcome)
    }
    const failed = validateResult(result({ outcome: 'failed', error: { code: 'not_found', message: 'nothing matched' } }))
    assert.equal(failed.ok, true)
  })

  it('refuses an unknown outcome, an unknown error code, and a missing message', () => {
    assert.equal(validateResult(result({ outcome: 'maybe' })).ok, false)
    assert.equal(validateResult(result({ outcome: 'failed' })).ok, false)
    const badCode = validateResult(result({ outcome: 'failed', error: { code: 'made-up', message: 'x' } }))
    assert.equal(badCode.ok, false)
    assert.match(badCode.reason, /unknown code/)
    const noMessage = validateResult(result({ outcome: 'failed', error: { code: 'not_found' } }))
    assert.equal(noMessage.ok, false)
  })

  it('refuses a payload over the accepted size', () => {
    const huge = { text: 'x'.repeat(400_001) }
    const verdict = validateResult(result({ payload: huge }))
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason, /exceeds the accepted size/)
  })

  it('refuses a non-integer sequence and an out-of-range generation', () => {
    assert.equal(validateResult(result({ sequence: 0.5 })).ok, false)
    assert.equal(validateResult(result({ connectionGeneration: -1 })).ok, false)
  })
})

describe('validateHello', () => {
  it('accepts one panel with one page and normalizes optional fields away', () => {
    const verdict = validateHello(hello({ extra: 'dropped' }))
    assert.equal(verdict.ok, true)
    assert.deepEqual(verdict.hello.panel.pages[0], {
      lease: 'guest-1', partition: 'part-1', url: 'https://example.test/a', documentToken: 'doc-1',
    })
  })

  it('refuses a protocol version mismatch and a missing panel', () => {
    const wrongVersion = validateHello(hello({ protocolVersion: 1 }))
    assert.equal(wrongVersion.ok, false)
    assert.match(wrongVersion.reason, /protocolVersion/)
    const noPanel = validateHello(hello({ panel: undefined }))
    assert.equal(noPanel.ok, false)
  })

  it('refuses a page without the fields the Host needs to bind', () => {
    const verdict = validateHello(hello({ panel: { instanceId: 'p', pages: [{ lease: 'g' }] } }))
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason, /need lease, partition, url and documentToken/)
  })

  it('bounds the page list', () => {
    const pages = Array.from({ length: 201 }, (_value, index) => ({
      lease: `guest-${index}`, partition: 'p', url: 'https://example.test/', documentToken: 'd',
    }))
    assert.equal(validateHello(hello({ panel: { instanceId: 'p', pages } })).ok, false)
  })
})

describe('payload helpers', () => {
  it('round-trips a JSON payload', () => {
    const encoded = encodePayload({ a: 1, b: [true, null] })
    assert.equal(encoded.ok, true)
    assert.deepEqual(JSON.parse(encoded.text), { a: 1, b: [true, null] })
  })

  it('refuses a payload with no JSON representation', () => {
    const cyclic: {self?: object} = {}
    cyclic.self = cyclic
    const encoded = encodePayload(cyclic)
    assert.equal(encoded.ok, false)
    assert.match(encoded.reason, /not JSON-serializable/)
  })

  it('reports retryability without ever retrying an unknown outcome', () => {
    assert.equal(isRetryable('stale_observation'), true)
    assert.equal(isRetryable('ambiguous_match'), true)
    assert.equal(isRetryable('unknown_outcome'), false)
    assert.equal(isRetryable('not_authorized'), false)
  })

  it('builds structured successes and failures', () => {
    assert.deepEqual(success({ a: 1 }), { ok: true, value: { a: 1 } })
    assert.deepEqual(failure('not_found', 'no match'), { ok: false, error: { code: 'not_found', message: 'no match' } })
    assert.deepEqual(failure('not_found', 'no match', { n: 0 }).error.details, { n: 0 })
  })

  it('every declared error code is a stable string', () => {
    assert.ok(ERROR_CODES.length > 0)
    for (const code of ERROR_CODES) assert.equal(typeof code, 'string')
  })
})
