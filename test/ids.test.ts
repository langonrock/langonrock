import { describe, expect, test } from 'bun:test'

import { deriveIds } from '../src/okf/ids.ts'

describe('deriveIds', () => {
  test('uses the bare basename when it is unique', () => {
    const ids = deriveIds(['tables/orders.md', 'metrics/wau.md'])

    expect(ids.get('tables/orders.md')).toBe('orders')
    expect(ids.get('metrics/wau.md')).toBe('wau')
  })

  test('falls back to parent/basename only for the colliding files', () => {
    const ids = deriveIds([
      'tables/orders.md',
      'metrics/orders.md',
      'datasets/orders_db.md'
    ])

    expect(ids.get('tables/orders.md')).toBe('tables/orders')
    expect(ids.get('metrics/orders.md')).toBe('metrics/orders')
    expect(ids.get('datasets/orders_db.md')).toBe('orders_db')
  })

  test('falls back to the full path when parent/basename still collides', () => {
    const ids = deriveIds(['a/x/orders.md', 'b/x/orders.md'])

    expect(ids.get('a/x/orders.md')).toBe('a/x/orders')
    expect(ids.get('b/x/orders.md')).toBe('b/x/orders')
  })

  test('keeps a root file short when a nested file shares its basename', () => {
    const ids = deriveIds(['orders.md', 'tables/orders.md'])

    expect(ids.get('orders.md')).toBe('orders')
    expect(ids.get('tables/orders.md')).toBe('tables/orders')
  })

  test('never produces a duplicate id', () => {
    const paths = [
      'a/x/orders.md',
      'b/x/orders.md',
      'c/orders.md',
      'orders.md',
      'other.md'
    ]
    const ids = deriveIds(paths)
    const unique = new Set(ids.values())

    expect(ids.size).toBe(paths.length)
    expect(unique.size).toBe(paths.length)
  })

  test('strips only the markdown extension', () => {
    const ids = deriveIds(['notes/v1.2.md'])

    expect(ids.get('notes/v1.2.md')).toBe('v1.2')
  })
})
