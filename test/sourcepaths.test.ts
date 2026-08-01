import { describe, expect, test } from 'bun:test'
import { isAbsolute } from 'node:path'

import {
  assertBundleName,
  assertConceptPath,
  sourceFile
} from '../src/store/sourcepaths.ts'

describe('assertBundleName', () => {
  test('accepts a plain name and rejects anything with a separator', () => {
    expect(assertBundleName('sales')).toBe('sales')
    expect(() => assertBundleName('sales/ops')).toThrow('invalid bundle name')
    expect(() => assertBundleName('..')).toThrow('invalid bundle name')
    expect(() => assertBundleName('')).toThrow('invalid bundle name')
  })
})

describe('assertConceptPath', () => {
  test('accepts a nested markdown path', () => {
    expect(assertConceptPath('tables/orders.md')).toBe('tables/orders.md')
  })

  test.each([
    ['../../etc/passwd.md', 'traversal'],
    ['tables/../../escape.md', 'a traversal in the middle'],
    ['/etc/passwd.md', 'an absolute path'],
    ['tables\\orders.md', 'a windows separator'],
    ['.hidden/orders.md', 'a dot directory the watcher would ignore'],
    ['tables/orders.txt', 'a file that is not markdown'],
    ['tables//orders.md', 'an empty segment']
  ])('rejects %p, %s', path => {
    expect(() => assertConceptPath(path)).toThrow('invalid path')
  })

  test('rejects a path long enough to break Windows', () => {
    expect(() => assertConceptPath(`${'a'.repeat(300)}.md`)).toThrow(
      'longer than'
    )
  })

  test('rejects a null byte', () => {
    expect(() => assertConceptPath('tables/or\0ders.md')).toThrow(
      'invalid path'
    )
  })
})

describe('sourceFile', () => {
  test('builds a path inside the bundle', () => {
    const built = sourceFile('/data/acme', 'sales', 'tables/orders.md')

    // Windows resolves this to a drive letter and backslashes, so the tail is
    // compared in one separator rather than pinning a posix absolute path.
    expect(built.replaceAll('\\', '/')).toEndWith(
      '/data/acme/sales/tables/orders.md'
    )
    expect(isAbsolute(built)).toBe(true)
  })

  test('refuses to leave the bundle even by a valid looking route', () => {
    expect(() => sourceFile('/data/acme', 'sales', '../ops/x.md')).toThrow(
      'invalid path'
    )
  })
})
