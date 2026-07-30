import { describe, expect, test } from 'bun:test'

import { slugify, splitSections } from '../src/compile/sections.ts'

function named(body: string): Record<string, string> {
  return Object.fromEntries(
    splitSections(body).map(section => [
      section.name,
      body.slice(section.start, section.end)
    ])
  )
}

describe('slugify', () => {
  test('lowercases and joins words with underscores', () => {
    expect(slugify('Join Paths')).toBe('join_paths')
  })

  test('falls back to the default name when nothing survives', () => {
    expect(slugify('***')).toBe('body')
  })
})

describe('splitSections', () => {
  test('splits on headings and keeps leading prose as body', () => {
    const sections = named('Intro.\n\n## Schema\n\ncol a\n\n## Joins\n\nx\n')

    expect(Object.keys(sections)).toEqual(['body', 'schema', 'joins'])
    expect(sections['body']).toBe('Intro.\n\n')
    expect(sections['schema']).toBe('## Schema\n\ncol a\n\n')
    expect(sections['joins']).toBe('## Joins\n\nx\n')
  })

  test('ignores comment lines inside fenced code blocks', () => {
    const body =
      '## Query\n\n```sql\n# not a heading\nSELECT 1\n```\n\n## Notes\n\nz\n'
    const sections = named(body)

    expect(Object.keys(sections)).toEqual(['query', 'notes'])
    expect(sections['query']).toContain('# not a heading')
  })

  test('treats an unterminated fence as running to the end', () => {
    const sections = named('## A\n\n```\n# still fenced\n')

    expect(Object.keys(sections)).toEqual(['a'])
  })

  test('disambiguates repeated headings', () => {
    const sections = named('## Notes\n\na\n\n## Notes\n\nb\n')

    expect(Object.keys(sections)).toEqual(['notes', 'notes_2'])
    expect(sections['notes_2']).toBe('## Notes\n\nb\n')
  })

  test('does not let a Body heading collide with the default section', () => {
    const sections = named('Lead.\n\n## Body\n\nx\n')

    expect(Object.keys(sections)).toEqual(['body', 'body_2'])
  })

  test('produces a single body section when there are no headings', () => {
    const sections = named('Just prose.\n')

    expect(Object.keys(sections)).toEqual(['body'])
  })

  test('omits the body section when nothing precedes the first heading', () => {
    const sections = named('\n## Schema\n\nx\n')

    expect(Object.keys(sections)).toEqual(['schema'])
  })

  test('covers the whole body with no gaps', () => {
    const body = 'Lead.\n\n## A\n\nx\n\n## B\n\ny\n'
    const sections = splitSections(body)
    const rebuilt = sections
      .map(section => body.slice(section.start, section.end))
      .join('')

    expect(rebuilt).toBe(body)
  })
})
