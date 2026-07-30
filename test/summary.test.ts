import { describe, expect, test } from 'bun:test'

import {
  EMPTY_CELL,
  deriveSummary,
  firstSentence,
  normalizeKind,
  sanitizeCell,
  truncate
} from '../src/compile/summary.ts'

describe('sanitizeCell', () => {
  test('removes tabs and newlines that would corrupt a row', () => {
    expect(sanitizeCell('has a\ttab and a\nnewline')).toBe(
      'has a tab and a newline'
    )
  })

  test('collapses runs of whitespace and trims', () => {
    expect(sanitizeCell('  spaced   out  ')).toBe('spaced out')
  })

  test('returns the empty cell marker for blank input', () => {
    expect(sanitizeCell('   \t\n  ')).toBe(EMPTY_CELL)
  })
})

describe('truncate', () => {
  test('leaves values within the budget untouched', () => {
    expect(truncate('short', 10)).toBe('short')
  })

  test('cuts at a word boundary and marks the truncation', () => {
    expect(truncate('one two three four', 11)).toBe('one two…')
  })

  test('cuts mid-word when no late space exists', () => {
    expect(truncate('supercalifragilistic', 8)).toBe('supercal…')
  })

  test('keeps a value of exactly the budget length', () => {
    expect(truncate('abcde', 5)).toBe('abcde')
  })
})

describe('normalizeKind', () => {
  test('slugs a multi-word type', () => {
    expect(normalizeKind('BigQuery Table')).toBe('bigquery_table')
  })

  test('strips leading and trailing separators', () => {
    expect(normalizeKind('  -Metric-  ')).toBe('metric')
  })

  test('returns the empty cell marker for a missing or non-string type', () => {
    expect(normalizeKind(undefined)).toBe(EMPTY_CELL)
    expect(normalizeKind(42)).toBe(EMPTY_CELL)
    expect(normalizeKind('***')).toBe(EMPTY_CELL)
  })
})

describe('firstSentence', () => {
  test('skips headings and blank lines', () => {
    expect(firstSentence('\n# Title\n\nThe real text. More after.\n')).toBe(
      'The real text.'
    )
  })

  test('skips fenced code blocks', () => {
    const body = '\n```sql\nSELECT 1;\n```\n\nProse wins. Second sentence.\n'

    expect(firstSentence(body)).toBe('Prose wins.')
  })

  test('returns the whole line when it has no sentence end', () => {
    expect(firstSentence('\nNo terminator here\n')).toBe('No terminator here')
  })

  test('returns empty when nothing usable exists', () => {
    expect(firstSentence('\n\n# Only a heading\n')).toBe('')
  })
})

describe('deriveSummary', () => {
  test('prefers the description field', () => {
    const summary = deriveSummary(
      { description: 'From frontmatter.' },
      'From body. Ignored.',
      120
    )

    expect(summary).toBe('From frontmatter.')
  })

  test('falls back to the body when description is absent', () => {
    expect(deriveSummary({}, 'From body. Ignored.', 120)).toBe('From body.')
  })

  test('sanitizes before truncating so the width counts real characters', () => {
    const summary = deriveSummary({ description: 'a\tb\nc  d' }, '', 120)

    expect(summary).toBe('a b c d')
  })

  test('applies the width budget', () => {
    const summary = deriveSummary(
      { description: 'one two three four five six' },
      '',
      11
    )

    expect(summary).toBe('one two…')
  })
})
