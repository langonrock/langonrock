import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { open } from '../src/client/connection.ts'
import { openTenant } from '../src/store/reader.ts'
import { listSource } from '../src/store/source.ts'
import { putTenantRoot } from '../src/store/writer.ts'

import type { Connection } from '../src/types.ts'

const CONCEPT = `---
type: BigQuery Table
description: One row per completed customer order.
---

# Schema

One row per order.
`

let scratch = ''
let root = ''
let source = ''

async function seed(files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(source, path)

    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content)
  }
}

function connection(): Connection {
  return open(`okf://${root}?tenant=acme`)
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-join-'))
  root = join(scratch, 'data')
  source = join(scratch, 'sources', 'acme')

  await mkdir(root, { recursive: true })
  await seed({
    'sales/tables/orders.md': CONCEPT,
    'sales/tables/customers.md': CONCEPT,
    'ops/orders.md': CONCEPT,
    'ops/README.md': '# Ops\n\nNo frontmatter, so not a concept.\n'
  })
  await writeFile(join(root, 'sources.json'), JSON.stringify({ acme: source }))
  await putTenantRoot(source, { root, tenant: 'acme' })
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

/**
 * An editor holds a path and the manifest holds an id, and the rule that maps
 * one to the other is the compiler's, not something a client should guess.
 */
describe('a source entry names the concept it becomes', () => {
  test('every id in the listing exists in the manifest, and the other way round', async () => {
    const entries = await listSource(source)
    const reader = await openTenant(root, 'acme')
    const listed = entries
      .map(entry => entry.id)
      .filter((id): id is string => id !== undefined)
      .sort()

    expect(listed).toEqual([...reader.ids].sort())
  })

  test('a colliding name carries its bundle prefix, matching the manifest', async () => {
    const entries = await listSource(source)
    const byPath = new Map(
      entries.map(entry => [`${entry.bundle}/${entry.path}`, entry.id])
    )

    expect(byPath.get('sales/tables/orders.md')).toBe('sales/orders')
    expect(byPath.get('ops/orders.md')).toBe('ops/orders')
    expect(byPath.get('sales/tables/customers.md')).toBe('customers')
  })

  test('a file with no frontmatter has no id at all', async () => {
    const entries = await listSource(source)
    const readme = entries.find(entry => entry.path === 'README.md')

    expect(readme).toBeDefined()
    expect(readme?.id).toBeUndefined()
  })

  test('the id follows the tree when a sibling arrives', async () => {
    const knowledge = connection()
    const before = await knowledge.listSource()

    expect(before.find(entry => entry.path === 'tables/customers.md')?.id).toBe(
      'customers'
    )

    await knowledge.writeSource('ops', 'customers.md', CONCEPT)

    const after = await knowledge.listSource()

    expect(after.find(entry => entry.path === 'tables/customers.md')?.id).toBe(
      'sales/customers'
    )

    await knowledge.deleteSource(
      'ops',
      'customers.md',
      after.find(entry => entry.path === 'customers.md')?.hash ?? ''
    )
  })
})

describe('sync reports what the compiler noticed', () => {
  test('carries the diagnostics rather than dropping them', async () => {
    const knowledge = connection()

    await knowledge.writeSource(
      'sales',
      'tables/broken.md',
      '---\ntitle: No type at all\n---\n\nSee [nowhere](./missing.md).\n'
    )

    const result = await knowledge.sync()
    const messages = result.diagnostics.map(entry => entry.message)

    expect(messages).toContain('missing required frontmatter field "type"')
    expect(messages.some(message => message.includes('unresolved link'))).toBe(
      true
    )
    expect(
      result.diagnostics.some(entry =>
        entry.message.startsWith('skipped: no frontmatter')
      )
    ).toBe(true)
    expect(result.diagnostics.every(entry => entry.level === 'warn')).toBe(true)

    const found = await knowledge.readSource('sales', 'tables/broken.md')

    await knowledge.deleteSource('sales', 'tables/broken.md', found?.hash ?? '')
    await knowledge.sync()
  })

  test('a clean tenant reports nothing', async () => {
    const knowledge = connection()
    const result = await knowledge.sync()

    expect(
      result.diagnostics.filter(
        entry => !entry.message.startsWith('skipped: no frontmatter')
      )
    ).toEqual([])
  })
})
