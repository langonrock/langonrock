import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compileBundle } from '../src/compile/manifest.ts'
import { readStaleAfter } from '../src/compile/summary.ts'
import { buildTenantIndex, searchTenant } from '../src/search/tenant.ts'
import { openTenant } from '../src/store/reader.ts'
import { putBundle } from '../src/store/writer.ts'

let scratch = ''

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-stale-'))
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

const concept = (frontmatter: string, body = 'Some prose.\n') =>
  `---\ntype: Table\n${frontmatter}\n---\n\n${body}`

describe('readStaleAfter', () => {
  test('accepts a quoted ISO date string', () => {
    expect(readStaleAfter({ stale_after: '2027-03-01' })).toBe('2027-03-01')
    expect(readStaleAfter({ stale_after: ' 2027-03-01 ' })).toBe('2027-03-01')
  })

  test('accepts the Date object YAML makes of a bare date', () => {
    expect(readStaleAfter({ stale_after: new Date('2027-03-01') })).toBe(
      '2027-03-01'
    )
  })

  test('rejects everything else as empty', () => {
    expect(readStaleAfter({})).toBe('')
    expect(readStaleAfter({ stale_after: 'next spring' })).toBe('')
    expect(readStaleAfter({ stale_after: 42 })).toBe('')
    expect(readStaleAfter({ stale_after: new Date('nope') })).toBe('')
  })
})

describe('compiling stale_after', () => {
  test('stores the date without judging it against the clock', async () => {
    const dir = await seed('kept', {
      'past.md': concept('stale_after: "2000-01-01"'),
      'future.md': concept('stale_after: "2999-12-31"')
    })

    const result = await compileBundle(dir, { bundle: 'acme' })
    const dates = new Map(
      result.concepts.map(entry => [entry.id, entry.staleAfter])
    )

    expect(dates.get('past')).toBe('2000-01-01')
    expect(dates.get('future')).toBe('2999-12-31')
    expect(result.tsv).not.toContain('stale')
    expect(result.diagnostics).toEqual([])
  })

  test('parses a bare YAML date the way authors write one', async () => {
    const dir = await seed('bare', {
      'note.md': concept('stale_after: 2000-01-01')
    })

    const result = await compileBundle(dir, { bundle: 'acme' })

    expect(result.concepts[0]?.staleAfter).toBe('2000-01-01')
  })

  test('warns on a stale_after that is not a date', async () => {
    const dir = await seed('warned', {
      'note.md': concept('stale_after: soonish')
    })

    const result = await compileBundle(dir, { bundle: 'acme' })

    expect(result.concepts[0]?.staleAfter).toBe('')
    expect(result.diagnostics).toEqual([
      {
        level: 'warn',
        path: 'note.md',
        message: 'stale_after is not a date (YYYY-MM-DD), ignored'
      }
    ])
  })
})

describe('the reader demotes expired concepts', () => {
  let root = ''

  beforeAll(async () => {
    const dir = await seed('tenant', {
      'expired.md': concept('stale_after: "2000-01-01"', 'Old prose.\n'),
      'fresh.md': concept('stale_after: "2999-12-31"', 'Fresh prose.\n'),
      'retired.md': concept(
        'status: deprecated\nstale_after: "2000-01-01"',
        'Retired prose.\n'
      ),
      'plain.md': concept('description: Nothing special.')
    })

    root = join(scratch, 'tenant-data')
    await putBundle(dir, { root, tenant: 'acme', bundle: 'sales' })
  })

  test('an expired concept shows stale where its status was empty', async () => {
    const reader = await openTenant(root, 'acme')
    const rows = new Map(
      (await reader.manifest())
        .split('\n')
        .filter(line => line !== '' && !line.startsWith('#'))
        .map(line => [line.split('\t')[0] ?? '', line.split('\t')[3] ?? ''])
    )

    expect(rows.get('expired')).toBe('stale')
    expect(rows.get('fresh')).toBe('-')
    expect(rows.get('plain')).toBe('-')
  })

  test('an explicit status wins over the demotion', async () => {
    const reader = await openTenant(root, 'acme')
    const row = (await reader.manifest())
      .split('\n')
      .find(line => line.startsWith('retired\t'))

    expect(row?.split('\t')[3]).toBe('deprecated')
  })

  test('the bundle-filtered manifest demotes too', async () => {
    const reader = await openTenant(root, 'acme')
    const row = (await reader.manifest('sales'))
      .split('\n')
      .find(line => line.startsWith('expired\t'))

    expect(row?.split('\t')[3]).toBe('stale')
  })

  test('search rows inherit the demotion through the index build', async () => {
    const reader = await openTenant(root, 'acme')
    const built = await buildTenantIndex(reader)
    const result = await searchTenant(built, 'old prose', {}, reader.get)
    const row = result.split('\n').find(line => line.startsWith('expired\t'))

    expect(row).toBeDefined()
    expect(row?.split('\t')[3]).toBe('stale')
  })

  test('the snapshot bytes never depend on the clock', async () => {
    const dir = join(scratch, 'tenant')
    const again = await putBundle(dir, {
      root,
      tenant: 'acme',
      bundle: 'sales'
    })

    expect(again.reused).toBe(true)
  })
})
