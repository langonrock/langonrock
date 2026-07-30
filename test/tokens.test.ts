import { describe, expect, test } from 'bun:test'

import { estimateTokens } from '../src/compile/tokens.ts'

describe('estimateTokens', () => {
  test('is zero for empty input', () => {
    expect(estimateTokens('')).toBe(0)
  })

  test('rounds up so any content costs at least one token', () => {
    expect(estimateTokens('a')).toBe(1)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })

  test('grows with length, which is what comparisons rely on', () => {
    const small = estimateTokens('a'.repeat(400))
    const large = estimateTokens('a'.repeat(800))

    expect(large).toBeGreaterThan(small)
    expect(large).toBe(200)
  })
})
