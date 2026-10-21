/**
 * Page identity and explicit selection.
 *
 * The Client must bind the exact webview element instance, not a name a
 * replacement could reuse; and a page the user cannot tell apart from another
 * candidate must not be authorized, because the grant would be ambiguous rather
 * than explicit.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { indistinguishableFrom, navigationEvent } from '../src/clientcore.ts'

/** One candidate page. */
function page(lease, url, title, tabId) {
  return { lease, url, title, tabId }
}

describe('a page the user cannot tell apart is not authorized', () => {
  it('names the twin that renders identically in every displayed field', () => {
    const pages = [
      page('guest-1', 'https://a.test/x', 'Same title', 'tab-1'),
      page('guest-2', 'https://a.test/x', 'Same title', 'tab-1'),
      page('guest-3', 'https://a.test/x', 'Same title', 'tab-2'),
      page('guest-4', 'https://b.test/y', 'Other', 'tab-3'),
    ]
    const twins = indistinguishableFrom(pages, pages[0])
    assert.equal(twins.length, 1, 'only the row that looks identical is a twin')
    assert.equal(twins[0].lease, 'guest-2')
  })

  it('lets the page alias separate two pages on the same address and title', () => {
    const pages = [
      page('guest-1', 'https://a.test/x', 'Same title', 'tab-1'),
      page('guest-2', 'https://a.test/x', 'Same title', 'tab-2'),
    ]
    assert.equal(indistinguishableFrom(pages, pages[0]).length, 0,
      'a different alias is shown to the user, so the rows are distinguishable')
  })

  it('allows a grant when a differing title separates the pages', () => {
    const pages = [
      page('guest-1', 'https://a.test/x', 'First', 'tab-1'),
      page('guest-2', 'https://a.test/x', 'Second', 'tab-2'),
    ]
    assert.equal(indistinguishableFrom(pages, pages[0]).length, 0, 'different titles are distinguishable')
  })

  it('allows a grant when the addresses differ', () => {
    const pages = [
      page('guest-1', 'https://a.test/x', 'Same', 'tab-1'),
      page('guest-2', 'https://a.test/y', 'Same', 'tab-2'),
    ]
    assert.equal(indistinguishableFrom(pages, pages[0]).length, 0)
  })

  it('never counts the page itself as its own twin', () => {
    const pages = [page('guest-1', 'https://a.test/x', 'Only', 'tab-1')]
    assert.equal(indistinguishableFrom(pages, pages[0]).length, 0, 'a lone candidate is always identifiable')
  })

  it('treats two pages with no display information at all as ambiguous', () => {
    const pages = [
      { lease: 'guest-1' },
      { lease: 'guest-2' },
    ]
    assert.equal(indistinguishableFrom(pages, pages[0]).length, 1,
      'two rows with nothing to tell them apart cannot be chosen between')
  })
})

describe('the event reported when the authorized page changes', () => {
  it('reports a same-origin navigation as same-origin', () => {
    assert.equal(navigationEvent('https://a.test/x', 'https://a.test/y'), 'same_origin_navigation')
  })

  it('reports a different host, scheme or port as cross-origin', () => {
    assert.equal(navigationEvent('https://a.test/x', 'https://b.test/x'), 'cross_origin_navigation')
    assert.equal(navigationEvent('https://a.test/x', 'http://a.test/x'), 'cross_origin_navigation')
    assert.equal(navigationEvent('https://a.test/x', 'https://a.test:8443/x'), 'cross_origin_navigation')
  })

  it('reports an unreadable address as cross-origin rather than assuming trust', () => {
    assert.equal(navigationEvent(undefined, 'https://a.test/x'), 'cross_origin_navigation')
    assert.equal(navigationEvent('https://a.test/x', undefined), 'cross_origin_navigation')
  })
})
