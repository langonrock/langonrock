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
  test('leaves a cloned repository README out of the manifest', async () => {
    const dir = await seed('cloned', {
      'README.md': '# acme-knowledge\n\nPublished on BundleDex.\n',
      'CONTRIBUTING.md': '# Contributing\n\nOpen a PR.\n',
      'tables/orders.md': CONCEPT
    })

    const result = await compileBundle(dir, { bundle: 'acme' })

    expect(result.concepts.map(concept => concept.id)).toEqual(['orders'])
    expect(result.tsv).not.toContain('README')
    expect(result.bodies.has('README')).toBe(false)
  })

  test('reports every skipped file rather than dropping it silently', async () => {
    const dir = await seed('reported', {
      'README.md': '# Readme\n',
      'tables/orders.md': CONCEPT
    })

    const result = await compileBundle(dir, { bundle: 'acme' })
    const skipped = result.diagnostics.filter(diagnostic =>
      diagnostic.message.startsWith('skipped:')
    )

    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.path).toBe('README.md')
    expect(skipped[0]?.level).toBe('warn')
  })

  test('a skipped file does not lengthen a real concept id', async () => {
    const dir = await seed('shadow', {
      'orders.md': '# Orders\n\nNo frontmatter, so not a concept.\n',
      'tables/orders.md': CONCEPT
    })

    const result = await compileBundle(dir, { bundle: 'acme' })

    expect(result.concepts.map(concept => concept.id)).toEqual(['orders'])
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
