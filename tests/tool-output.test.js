/**
 * Keyless canonical and expected output for the six tools.
 *
 * Every tool returns one canonical value; the model-visible text and the
 * presentation metadata are derived from it. These tests pin the rendered output
 * for a representative success and for each failure class, so a change to the
 * canonical result or its rendering is visible as a diff rather than discovered
 * by a model at runtime.
 *
 * The expected values are written literally here rather than recorded from a
 * run: they are the contract, so a change must be deliberate.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createTools } from '../src/tools.js'
import { resolveConfig } from '../src/config.js'
import { failure, success } from '../src/protocol.js'

/**
 * Build the six tools over a scripted service.
 *
 * The tools resolve the caller first and then call one service method with the
 * resolved caller; the fake implements that exact shape so the tool's argument
 * validation and forwarding are what the test exercises.
 * @param {object} answers - one answer per service method.
 * @returns {Map<string, object>} tools by name.
 */
function toolsWith(answers) {
  const calls = []
  const service = {
    resolveCaller(exec) {
      calls.push(['resolveCaller', exec])
      return exec.agent === undefined
        ? failure('no_live_agent', 'this Session has no live Agent')
        : success(exec.agent)
    },
    listTabs: caller => { calls.push(['listTabs', caller]); return answers.listTabs },
    observe: async (caller, signal) => { calls.push(['observe', caller, signal]); return answers.observe },
    find: async (caller, query, signal) => { calls.push(['find', caller, query, signal]); return answers.find },
    act: async (caller, action, signal) => { calls.push(['act', caller, action, signal]); return answers.act },
    wait: async (caller, input, signal) => { calls.push(['wait', caller, input, signal]); return answers.wait },
    release: async caller => { calls.push(['release', caller]); return answers.release },
  }
  const tools = new Map(createTools(service, resolveConfig({})).map(definition => [definition.name, definition]))
  return { tools, calls, service }
}

/** A live caller for one Agent. */
const caller = { agent: { id: 'session-1', session: { id: 'session-1' } } }

/**
 * Render one tool result the way the Host presents it to the model.
 * @param {object} tool - tool definition.
 * @param {object} args - tool arguments.
 * @param {object} value - canonical value.
 * @returns {object} rendered content and metadata.
 */
function render(tool, args, value) {
  return {
    content: tool.output.render(args, value),
    meta: tool.output.presentationMeta(args, value),
  }
}

describe('tool output contract', () => {
  it('renders one canonical value as pretty JSON, with the tool name as metadata', () => {
    const { tools } = toolsWith({ listTabs: success({ pages: [] }) })
    const tabs = tools.get('browser_tabs')
    const value = { pages: [{ tabId: 'tab-1', url: 'https://example.test/a', title: 'A', authorized: false }] }
    const rendered = render(tabs, {}, value)
    assert.deepEqual(rendered.meta, { tool: 'browser_tabs' })
    assert.equal(rendered.content.length, 1)
    assert.equal(rendered.content[0].type, 'text')
    assert.equal(rendered.content[0].text, JSON.stringify(value, undefined, 2))
  })

  it('declares an object output schema for every tool', () => {
    const { tools } = toolsWith({})
    for (const [name, tool] of tools) {
      assert.equal(tool.output.schema.type, 'object', name)
      assert.equal(typeof tool.output.render, 'function', name)
      assert.equal(typeof tool.output.presentationMeta, 'function', name)
    }
  })

  it('states in every description that tool arguments may already be logged', () => {
    const { tools } = toolsWith({})
    for (const [name, tool] of tools) {
      assert.ok(/message log|already recorded|recorded/i.test(tool.description),
        `${name} must warn that arguments may already be in the message log`)
    }
  })
})

describe('browser_tabs output', () => {
  it('returns the page list with the authorization flag', async () => {
    const value = { pages: [{ tabId: 'tab-1', url: 'https://example.test/a', title: 'A', authorized: true }] }
    const { tools, calls } = toolsWith({ listTabs: success(value) })
    const outcome = await tools.get('browser_tabs').execute({}, { ...caller, signal: new AbortController().signal })
    assert.equal(outcome.ok, true)
    assert.deepEqual(outcome.value, value)
    assert.equal(calls[1][0], 'listTabs')
    assert.equal(calls[1][1], caller.agent)
  })

  it('surfaces a refusal unchanged', async () => {
    const refusal = failure('no_live_agent', 'this Session has no live Agent')
    const { tools } = toolsWith({ listTabs: refusal })
    const outcome = await tools.get('browser_tabs').execute({}, { ...caller, signal: new AbortController().signal })
    assert.equal(outcome.ok, false)
    assert.deepEqual(outcome.error, refusal.error)
  })
})

describe('browser_observe output', () => {
  it('passes the observation through and forwards the caller', async () => {
    const value = { documentToken: 'doc-1', url: 'https://example.test/a', text: 'Bolts 10', nodes: [] }
    const { tools, calls } = toolsWith({ observe: success(value) })
    const outcome = await tools.get('browser_observe').execute({}, { ...caller, signal: new AbortController().signal })
    assert.equal(outcome.ok, true)
    assert.deepEqual(outcome.value, value)
    assert.equal(calls[1][0], 'observe')
  })

  it('accepts an optional view without permitting a different page', () => {
    // Observation targets only the authorized page.
    const { tools } = toolsWith({})
    const observe = tools.get('browser_observe')
    assert.deepEqual(observe.parameters.required, [])
    assert.deepEqual(Object.keys(observe.parameters.properties), ['view','ref','offset'])
    assert.deepEqual(observe.parameters.properties.view.enum, ['page', 'bjrsj_import','task'])
    assert.equal(observe.parameters.additionalProperties, false)
  })
})

describe('browser_find output', () => {
  it('returns one match for a single hit', async () => {
    const value = { documentToken: 'doc-1', match: { elementRef: 'el-1', tag: 'input', label: 'q', text: '' } }
    const { tools, calls } = toolsWith({ find: success(value) })
    const outcome = await tools.get('browser_find').execute({ by: 'attr', name: 'id', value: 'q' }, { ...caller, signal: new AbortController().signal })
    assert.equal(outcome.ok, true)
    assert.deepEqual(outcome.value, value)
    assert.deepEqual(calls[1][2], { by: 'attr', name: 'id', value: 'q' })
  })

  it('reports ambiguity with the candidate matches', async () => {
    const refusal = failure('ambiguous_match', '2 elements match this query; narrow it', {
      documentToken: 'doc-1',
      matches: [{ elementRef: 'el-1' }, { elementRef: 'el-2' }],
    })
    const { tools } = toolsWith({ find: refusal })
    const outcome = await tools.get('browser_find').execute({ by: 'text', value: 'Save' }, { ...caller, signal: new AbortController().signal })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'ambiguous_match')
    assert.equal(outcome.error.details.matches.length, 2)
  })

  it('requires an attribute name when by is attr', async () => {
    const { tools, calls } = toolsWith({ find: success({}) })
    const outcome = await tools.get('browser_find').execute({ by: 'attr', value: 'x' }, { ...caller, signal: new AbortController().signal })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'invalid_request')
    assert.equal(calls.length, 0)
  })
})

describe('browser_act output', () => {
  it('forwards a declared action', async () => {
    const value = { action: 'click', executed: true }
    const { tools, calls } = toolsWith({ act: success(value) })
    const outcome = await tools.get('browser_act').execute(
      { documentToken: 'doc-1', elementRef: 'el-1', action: 'click' },
      { ...caller, signal: new AbortController().signal },
    )
    assert.equal(outcome.ok, true)
    assert.deepEqual(outcome.value, value)
    assert.equal(calls[1][0], 'act')
  })

  it('rejects an undeclared action and never dispatches it', async () => {
    const { tools, calls } = toolsWith({ act: success({}) })
    const outcome = await tools.get('browser_act').execute(
      { documentToken: 'doc-1', elementRef: 'el-1', action: 'scroll' },
      { ...caller, signal: new AbortController().signal },
    )
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'invalid_request')
    assert.equal(calls.length, 0)
  })

  it('requires a value for type and a boolean for check', async () => {
    const { tools, calls } = toolsWith({ act: success({}) })
    const typed = await tools.get('browser_act').execute(
      { documentToken: 'doc-1', elementRef: 'el-1', action: 'type' },
      { ...caller, signal: new AbortController().signal },
    )
    assert.equal(typed.ok, false)
    assert.equal(typed.error.code, 'invalid_request')
    const checked = await tools.get('browser_act').execute(
      { documentToken: 'doc-1', elementRef: 'el-1', action: 'check', checked: 'yes' },
      { ...caller, signal: new AbortController().signal },
    )
    assert.equal(checked.ok, false)
    assert.equal(checked.error.code, 'invalid_request')
    assert.equal(calls.length, 0)
  })

  it('reports an unknown outcome without claiming the page did not act', async () => {
    const refusal = failure('unknown_outcome', 'the page did not answer before the deadline')
    const { tools } = toolsWith({ act: refusal })
    const outcome = await tools.get('browser_act').execute(
      { documentToken: 'doc-1', elementRef: 'el-1', action: 'click' },
      { ...caller, signal: new AbortController().signal },
    )
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'unknown_outcome')
  })
})

describe('browser_wait output', () => {
  it('forwards a bounded wait and its condition', async () => {
    const value = { condition: 'present', satisfied: true }
    const { tools, calls } = toolsWith({ wait: success(value) })
    const outcome = await tools.get('browser_wait').execute(
      { documentToken: 'doc-1', elementRef: 'el-1', condition: 'present', timeoutMs: 500 },
      { ...caller, signal: new AbortController().signal },
    )
    assert.equal(outcome.ok, true)
    assert.deepEqual(outcome.value, value)
    assert.equal(calls[1][0], 'wait')
  })

  it('requires text for the text condition and rejects an out-of-range timeout', async () => {
    const { tools, calls } = toolsWith({ wait: success({}) })
    const missingText = await tools.get('browser_wait').execute(
      { documentToken: 'doc-1', elementRef: 'el-1', condition: 'text', timeoutMs: 100 },
      { ...caller, signal: new AbortController().signal },
    )
    assert.equal(missingText.ok, false)
    assert.equal(missingText.error.code, 'invalid_request')
    const tooLong = await tools.get('browser_wait').execute(
      { documentToken: 'doc-1', elementRef: 'el-1', condition: 'present', timeoutMs: 10_000_000 },
      { ...caller, signal: new AbortController().signal },
    )
    assert.equal(tooLong.ok, false)
    assert.equal(tooLong.error.code, 'invalid_request')
    assert.equal(calls.length, 0)
  })
})

describe('browser_release output', () => {
  it('reports the detached lease and keeps the page', async () => {
    const value = { released: true, pageKept: true }
    const { tools, calls } = toolsWith({ release: success(value) })
    const outcome = await tools.get('browser_release').execute({}, { ...caller, signal: new AbortController().signal })
    assert.equal(outcome.ok, true)
    assert.deepEqual(outcome.value, value)
    assert.equal(calls[1][0], 'release')
  })

  it('reports that nothing was authorized without failing', async () => {
    const refusal = failure('not_authorized', 'no active control lease matches this request')
    const { tools } = toolsWith({ release: refusal })
    const outcome = await tools.get('browser_release').execute({}, { ...caller, signal: new AbortController().signal })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'not_authorized')
  })
})
