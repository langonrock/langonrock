import { describe, expect, test } from 'bun:test'

import {
  extractLinkTargets,
  resolveLinks,
  resolveTarget
} from '../src/okf/links.ts'

const PATH_TO_ID = new Map([
  ['tables/orders.md', 'tables/orders'],
  ['tables/customers.md', 'customers'],
  ['metrics/orders.md', 'metrics/orders']
])

describe('extractLinkTargets', () => {
  test('collects targets and ignores link titles', () => {
    const targets = extractLinkTargets(
      'See [a](./a.md) and [b](../b.md "Title") plus ![img](x.png).'
    )

    expect(targets).toEqual(['./a.md', '../b.md', 'x.png'])
  })

  test('returns nothing for text with no links', () => {
    expect(extractLinkTargets('Plain prose with [brackets] only.')).toEqual([])
  })
})

describe('resolveTarget', () => {
  test('resolves a sibling link', () => {
    expect(resolveTarget('./customers.md', 'tables/orders.md')).toBe(
      'tables/customers.md'
    )
  })

  test('resolves a parent traversal', () => {
    expect(resolveTarget('../metrics/orders.md', 'tables/orders.md')).toBe(
      'metrics/orders.md'
    )
  })

  test('strips anchors and query strings', () => {
    expect(resolveTarget('./customers.md#grain', 'tables/orders.md')).toBe(
      'tables/customers.md'
    )
    expect(resolveTarget('./customers.md?v=2', 'tables/orders.md')).toBe(
      'tables/customers.md'
    )
  })

  test('appends the markdown extension when omitted', () => {
    expect(resolveTarget('./customers', 'tables/orders.md')).toBe(
      'tables/customers.md'
    )
  })

  test('treats a leading slash as bundle root', () => {
    expect(resolveTarget('/metrics/orders.md', 'tables/orders.md')).toBe(
      'metrics/orders.md'
    )
  })

  test('ignores external schemes and bare anchors', () => {
    expect(resolveTarget('https://example.test/x', 'a.md')).toBeUndefined()
    expect(resolveTarget('mailto:a@b.test', 'a.md')).toBeUndefined()
    expect(resolveTarget('#section', 'a.md')).toBeUndefined()
  })

  test('decodes percent-encoded paths', () => {
    expect(resolveTarget('./my%20file.md', 'a/b.md')).toBe('a/my file.md')
  })
})

describe('resolveLinks', () => {
  test('resolves internal links, drops external ones, flags broken ones', () => {
    const body = [
      'Joined with [customers](./customers.md) and [payments](./payments.md).',
      'See [spec](https://example.test/spec) and [metric](../metrics/orders.md).'
    ].join('\n')

    const resolved = resolveLinks(body, 'tables/orders.md', PATH_TO_ID)

    expect(resolved.ids).toEqual(['customers', 'metrics/orders'])
    expect(resolved.broken).toEqual(['./payments.md'])
  })

  test('excludes self references', () => {
    const resolved = resolveLinks(
      'Back to [self](./orders.md).',
      'tables/orders.md',
      PATH_TO_ID
    )

    expect(resolved.ids).toEqual([])
    expect(resolved.broken).toEqual([])
  })

  test('deduplicates and sorts ids for stable output', () => {
    const body =
      '[m](../metrics/orders.md) [c](./customers.md) [m again](../metrics/orders.md)'
    const resolved = resolveLinks(body, 'tables/orders.md', PATH_TO_ID)

    expect(resolved.ids).toEqual(['customers', 'metrics/orders'])
  })
})
