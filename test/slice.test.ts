import { describe, expect, test } from 'bun:test'

import {
  FIND_WINDOW,
  MATCH_CAP,
  frameSlice,
  renderConcepts,
  sliceConcept
} from '../src/store/slice.ts'

describe('sliceConcept', () => {
  test('no options returns the whole text as a slice', () => {
    const slice = sliceConcept('hello world')

    expect(slice).toEqual({ text: 'hello world', start: 0, end: 11, total: 11 })
  })

  test('offset and limit cut an exact window', () => {
    const slice = sliceConcept('0123456789', { offset: 2, limit: 5 })

    expect(slice).toEqual({ text: '23456', start: 2, end: 7, total: 10 })
  })

  test('a limit past the end stops at the end', () => {
    const slice = sliceConcept('0123456789', { offset: 8, limit: 100 })

    expect(slice).toEqual({ text: '89', start: 8, end: 10, total: 10 })
  })

  test('an offset past the end returns an empty slice, not an error', () => {
    const slice = sliceConcept('0123456789', { offset: 50 })

    expect(slice).toEqual({ text: '', start: 10, end: 10, total: 10 })
  })

  test('a zero limit returns an empty slice at the offset', () => {
    const slice = sliceConcept('0123456789', { offset: 3, limit: 0 })

    expect(slice).toEqual({ text: '', start: 3, end: 3, total: 10 })
  })

  test('a negative offset clamps to the start', () => {
    const slice = sliceConcept('0123456789', { offset: -5, limit: 3 })

    expect(slice).toEqual({ text: '012', start: 0, end: 3, total: 10 })
  })

  test('find matches case-insensitively and reports every offset', () => {
    const text = 'The Rabbit ran. A rabbit again. RABBIT thrice.'
    const slice = sliceConcept(text, { find: 'rabbit' })

    expect(slice.matches).toEqual([4, 18, 32])
    expect(slice.matchCount).toBe(3)
    expect(slice.text).toBe(text)
  })

  test('find windows around the first match when the text is larger', () => {
    const text = `${'a'.repeat(5_000)}needle${'b'.repeat(5_000)}`
    const slice = sliceConcept(text, { find: 'needle' })

    expect(slice.end - slice.start).toBe(FIND_WINDOW)
    expect(slice.text).toContain('needle')
    expect(slice.matches).toEqual([5_000])

    const centre = 5_000 - Math.floor((FIND_WINDOW - 'needle'.length) / 2)

    expect(slice.start).toBe(centre)
  })

  test('find respects an explicit limit as the window size', () => {
    const text = `${'a'.repeat(100)}needle${'b'.repeat(100)}`
    const slice = sliceConcept(text, { find: 'needle', limit: 20 })

    expect(slice.end - slice.start).toBe(20)
    expect(slice.text).toContain('needle')
  })

  test('a window near the tail slides back to stay full-size', () => {
    const text = `${'a'.repeat(100)}needle`
    const slice = sliceConcept(text, { find: 'needle', limit: 20 })

    expect(slice).toMatchObject({ start: 86, end: 106 })
    expect(slice.text.endsWith('needle')).toBe(true)
  })

  test('find overrides offset', () => {
    const text = `${'a'.repeat(100)}needle${'b'.repeat(100)}`
    const slice = sliceConcept(text, { find: 'needle', offset: 190, limit: 20 })

    expect(slice.text).toContain('needle')
  })

  test('find with no occurrence reports zero matches and no text', () => {
    const slice = sliceConcept('nothing to see', { find: 'ghost' })

    expect(slice).toEqual({
      text: '',
      start: 0,
      end: 0,
      total: 14,
      matches: [],
      matchCount: 0
    })
  })

  test('the match list is capped while the count stays honest', () => {
    const text = 'ab'.repeat(100)
    const slice = sliceConcept(text, { find: 'ab' })

    expect(slice.matchCount).toBe(100)
    expect(slice.matches).toHaveLength(MATCH_CAP)
    expect(slice.matches?.[0]).toBe(0)
    expect(slice.matches?.[MATCH_CAP - 1]).toBe((MATCH_CAP - 1) * 2)
  })

  test('occurrences do not overlap', () => {
    const slice = sliceConcept('aaaa', { find: 'aa' })

    expect(slice.matches).toEqual([0, 2])
    expect(slice.matchCount).toBe(2)
  })

  test('a boundary never splits a surrogate pair', () => {
    const slice = sliceConcept('ab😀cd', { limit: 3 })

    expect(slice.text).toBe('ab😀')
    expect(slice.end).toBe(4)

    const tail = sliceConcept('ab😀cd', { offset: 3 })

    expect(tail.text).toBe('😀cd')
    expect(tail.start).toBe(2)
  })

  test('case folding that would move offsets falls back to exact case', () => {
    const text = 'İstanbul'

    expect(sliceConcept(text, { find: 'istanbul' }).matchCount).toBe(0)
    expect(sliceConcept(text, { find: 'İstanbul' }).matches).toEqual([0])
  })
})

describe('frameSlice', () => {
  test('a whole read keeps the bare frame it always had', () => {
    expect(frameSlice('orders', sliceConcept('body'))).toBe('@@ orders')
  })

  test('a partial read names its range and total', () => {
    const slice = sliceConcept('0123456789', { offset: 2, limit: 5 })

    expect(frameSlice('orders', slice)).toBe('@@ orders [2..7 of 10]')
  })

  test('a find names its matches', () => {
    const slice = sliceConcept('x rabbit y', { find: 'rabbit' })

    expect(frameSlice('alice_1', slice)).toBe('@@ alice_1 1 match at 2')
  })

  test('a capped match list says what it is showing', () => {
    const slice = sliceConcept('ab'.repeat(100), { find: 'ab', limit: 10 })

    expect(frameSlice('x', slice)).toBe(
      `@@ x [0..10 of 200] first ${MATCH_CAP} of 100 matches at ${slice.matches?.join(' ')}`
    )
  })

  test('a miss says so instead of returning silence', () => {
    const slice = sliceConcept('nothing here', { find: 'ghost' })

    expect(frameSlice('ch51', slice)).toBe('@@ ch51 no match in 12 chars')
  })
})

describe('renderConcepts', () => {
  test('frames every found concept and lists the missing', () => {
    const found = new Map([
      ['a', sliceConcept('alpha')],
      ['b', sliceConcept('0123456789', { limit: 4 })]
    ])

    expect(renderConcepts(['a', 'b', 'c'], found)).toBe(
      '@@ a\nalpha\n@@ b [0..4 of 10]\n0123\n@@ missing\nc'
    )
  })

  test('an empty slice renders its frame without a blank body line', () => {
    const found = new Map([['a', sliceConcept('text', { find: 'ghost' })]])

    expect(renderConcepts(['a'], found)).toBe('@@ a no match in 4 chars')
  })
})
