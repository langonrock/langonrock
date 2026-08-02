import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compileBundle } from '../src/compile/manifest.ts'
import { hasFrontmatter } from '../src/okf/frontmatter.ts'

let scratch = ''

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-ingest-'))
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

async function seed(
  name: string,
  files: Record<string, string>
): Promise<string> {
  const dir = join(scratch, name)

  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path)

    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content)
  }

  return dir
}

const CONCEPT = '---\ntype: Table\ndescription: Orders.\n---\n\nBody.\n'

describe('hasFrontmatter', () => {
  test('accepts a concept and rejects repository furniture', () => {
    expect(hasFrontmatter(CONCEPT)).toBe(true)
    expect(hasFrontmatter('# Readme\n\nJust prose.\n')).toBe(false)
  })

  test('rejects an opening delimiter with no closing one', () => {
    expect(hasFrontmatter('---\ntype: Table\n\nNever closed.\n')).toBe(false)
  })
})

describe('compileBundle ingestion', () => {
  test('compiles a cloned repository README like any markdown', async () => {
    const dir = await seed('cloned', {
      'README.md': '# acme-knowledge\n\nPublished on BundleDex.\n',
      'CONTRIBUTING.md': '# Contributing\n\nOpen a PR.\n',
      'tables/orders.md': CONCEPT
    })

    const result = await compileBundle(dir, { bundle: 'acme' })

    expect(result.concepts.map(concept => concept.id)).toEqual([
      'CONTRIBUTING',
      'README',
      'orders'
    ])
    expect(result.tsv).toContain('README')
    expect(result.bodies.has('README')).toBe(true)
  })

  test('reports plain markdown as a conformance warning, not a skip', async () => {
    const dir = await seed('reported', {
      'README.md': '# Readme\n',
      'tables/orders.md': CONCEPT
    })

    const result = await compileBundle(dir, { bundle: 'acme' })

    expect(result.diagnostics).toEqual([
      {
        level: 'warn',
        path: 'README.md',
        message:
          'no frontmatter, compiled as plain markdown, not an OKF concept'
      }
    ])
  })

  test('a plain markdown sibling takes part in id derivation', async () => {
    const dir = await seed('shadow', {
      'orders.md': '# Orders\n\nPlain markdown is a concept now.\n',
      'tables/orders.md': CONCEPT
    })

    const result = await compileBundle(dir, { bundle: 'acme' })

    expect(result.concepts.map(concept => concept.id)).toEqual([
      'orders',
      'tables/orders'
    ])
  })

  test('derives kind, summary and title for a plain markdown file', async () => {
    const dir = await seed('derived', {
      'guide.md': '# Getting Started\n\nInstall it with one command.\n'
    })

    const result = await compileBundle(dir, { bundle: 'acme' })
    const guide = result.concepts[0]

    expect(guide?.kind).toBe('-')
    expect(guide?.summary).toBe('Install it with one command.')
    expect(guide?.title).toBe('Getting Started')
  })

  test('does not mistake a fenced comment for the title', async () => {
    const dir = await seed('fenced', {
      'notes.md': '```sql\n# not a heading\nselect 1;\n```\n\nProse after.\n'
    })

    const result = await compileBundle(dir, { bundle: 'acme' })

    expect(result.concepts[0]?.title).toBe('')
  })
})

describe('status column', () => {
  test('shows a deviation and stays empty for the default', async () => {
    const dir = await seed('status', {
      'live.md': '---\ntype: Table\nstatus: current\n---\n\nLive.\n',
      'old.md': '---\ntype: Table\nstatus: deprecated\n---\n\nOld.\n',
      'draft.md': '---\ntype: Table\nstatus: Draft\n---\n\nDraft.\n',
      'plain.md': CONCEPT
    })

    const result = await compileBundle(dir, { bundle: 'acme' })
    const status = new Map(
      result.concepts.map(concept => [concept.id, concept.status])
    )

    expect(status.get('old')).toBe('deprecated')
    expect(status.get('draft')).toBe('Draft')
    expect(status.get('live')).toBe('-')
    expect(status.get('plain')).toBe('-')
  })

  test('reaches the manifest row so selection can see it', async () => {
    const dir = await seed('status-row', {
      'old.md': '---\ntype: Table\nstatus: deprecated\n---\n\nOld.\n'
    })

    const result = await compileBundle(dir, { bundle: 'acme' })

    expect(result.tsv).toContain('old\ttable\tdeprecated\t')
  })
})
