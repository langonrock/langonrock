import { describe, expect, test } from 'bun:test'

import { parseFrontmatter } from '../src/okf/frontmatter.ts'

describe('parseFrontmatter', () => {
  test('returns the whole source as body when there is no frontmatter', () => {
    const source = '# Title\n\nJust prose.\n'
    const parsed = parseFrontmatter(source)

    expect(parsed.data).toEqual({})
    expect(parsed.body).toBe(source)
    expect(parsed.error).toBeUndefined()
  })

  test('parses nested v0.2 provenance fields', () => {
    const parsed = parseFrontmatter(
      [
        '---',
        'type: BigQuery Table',
        'tags: [sales, revenue]',
        'sources:',
        '  - url: https://wiki.acme.test/orders',
        '    trust: high',
        '---',
        '',
        'Body here.'
      ].join('\n')
    )

    expect(parsed.data['type']).toBe('BigQuery Table')
    expect(parsed.data['tags']).toEqual(['sales', 'revenue'])
    expect(parsed.data['sources']).toEqual([
      { url: 'https://wiki.acme.test/orders', trust: 'high' }
    ])
    expect(parsed.body).toBe('\nBody here.')
  })

  test('does not treat a --- separator further down as frontmatter', () => {
    const source = 'Intro paragraph.\n\n---\n\ntype: not frontmatter\n'
    const parsed = parseFrontmatter(source)

    expect(parsed.data).toEqual({})
    expect(parsed.body).toBe(source)
  })

  test('reports malformed YAML instead of throwing', () => {
    const parsed = parseFrontmatter('---\ntype: [unclosed\n---\n\nBody.\n')

    expect(parsed.data).toEqual({})
    expect(parsed.error).toBeDefined()
    expect(parsed.body).toBe('\nBody.\n')
  })

  test('rejects frontmatter that is not a mapping', () => {
    const parsed = parseFrontmatter('---\n- one\n- two\n---\n\nBody.\n')

    expect(parsed.data).toEqual({})
    expect(parsed.error).toBe('frontmatter is not a mapping')
  })

  test('handles an empty frontmatter block', () => {
    const parsed = parseFrontmatter('---\n\n---\nBody.\n')

    expect(parsed.data).toEqual({})
    expect(parsed.body).toBe('Body.\n')
  })
})
