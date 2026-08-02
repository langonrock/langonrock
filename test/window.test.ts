import { describe, expect, test } from 'bun:test'

import { bestWindowStart } from '../src/search/window.ts'
import { FIND_WINDOW } from '../src/store/slice.ts'

const filler = (length: number) => 'z'.repeat(length)

describe('bestWindowStart', () => {
  test('is undefined when no query word occurs in the text', () => {
    expect(bestWindowStart('plain prose here', 'missing')).toBeUndefined()
    expect(bestWindowStart('', 'anything')).toBeUndefined()
    expect(bestWindowStart('some text', '--- !!')).toBeUndefined()
  })

  test('centres a lone occurrence inside the window', () => {
    const text = `${filler(5000)} needle ${filler(5000)}`
    const at = text.indexOf('needle')
    const slack = Math.floor((FIND_WINDOW - 'needle'.length) / 2)

    expect(bestWindowStart(text, 'needle')).toBe(at - slack)
  })

  test('prefers the window holding more distinct words', () => {
    const text = `alpha ${filler(3000)} alpha beta ${filler(3000)}`
    const cluster = text.indexOf('alpha beta')
    const slack = Math.floor((FIND_WINDOW - 'alpha beta'.length) / 2)

    expect(bestWindowStart(text, 'alpha beta')).toBe(cluster - slack)
  })

  test('breaks a density tie toward the earliest passage', () => {
    const text = `gamma ${filler(5000)} gamma ${filler(5000)}`

    expect(bestWindowStart(text, 'gamma')).toBe(0)
  })

  test('clamps to the end of the text', () => {
    const text = `${filler(3000)} needle`
    const start = bestWindowStart(text, 'needle')

    expect(start).toBe(text.length - FIND_WINDOW)
  })

  test('returns 0 for a text shorter than the window', () => {
    expect(bestWindowStart('a cat sat', 'cat')).toBe(0)
  })

  test('matches whole words only', () => {
    expect(bestWindowStart('concatenate scatter', 'cat')).toBeUndefined()
  })

  test('matches case-insensitively', () => {
    const text = `${filler(5000)} NEEDLE ${filler(5000)}`

    expect(bestWindowStart(text, 'needle')).toBeDefined()
  })

  test('does not double-count a word the query repeats', () => {
    const text = `beta beta ${filler(3000)} alpha beta ${filler(3000)}`
    const cluster = text.indexOf('alpha beta')
    const slack = Math.floor((FIND_WINDOW - 'alpha beta'.length) / 2)

    expect(bestWindowStart(text, 'beta beta alpha')).toBe(cluster - slack)
  })

  test('falls back to case-sensitive matching when folding would move offsets', () => {
    const text = `İstanbul ${filler(3000)}`

    expect(bestWindowStart(text, 'İstanbul')).toBe(0)
    expect(bestWindowStart(text, 'istanbul')).toBeUndefined()
  })
})
