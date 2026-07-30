import { describe, expect, test } from 'bun:test'

import { compileBundle, serialize } from '../src/compile/manifest.ts'

import type { Concept } from '../src/okf/types.ts'

const FIXTURE = `${import.meta.dir}/fixtures/sales`

const EXPECTED = [
  '# bundle: sales',
  'id\tkind\tgrain\tsummary\tlinks',
  'customers\tbigquery_table\tcustomer_id\tRegistered customers, including churned.\ttables/orders',
  'messy\traw_extract\t-\tHas a tab and a newline plus collapsed spacing.\t-',
  'metrics/orders\tmetric\t-\tCount of completed orders in the period.\ttables/orders',
  'orders_db\tdataset\t-\tThe production sales database.\t-',
  'tables/orders\tbigquery_table\torder_id\tOne row per completed customer order.\tcustomers metrics/orders',
  'weekly_active_users\t-\t-\tDistinct user_id seen in a trailing 7 day window.\t-',
  ''
].join('\n')

describe('compileBundle', () => {
  test('produces the expected manifest for the fixture bundle', async () => {
    const result = await compileBundle(FIXTURE, { bundle: 'sales' })

    expect(result.tsv).toBe(EXPECTED)
  })

  test('skips index.md and log.md', async () => {
    const result = await compileBundle(FIXTURE, { bundle: 'sales' })
    const ids = result.concepts.map(concept => concept.id)

    expect(ids).not.toContain('index')
    expect(ids).not.toContain('log')
    expect(result.concepts).toHaveLength(6)
  })

  test('warns about a missing type and an unresolved link', async () => {
    const result = await compileBundle(FIXTURE, { bundle: 'sales' })
    const messages = result.diagnostics.map(
      diagnostic => `${diagnostic.path}: ${diagnostic.message}`
    )

    expect(messages).toContain(
      'metrics/weekly_active_users.md: missing required frontmatter field "type"'
    )
    expect(messages).toContain(
      'tables/orders.md: unresolved link "./payments.md"'
    )
    expect(result.diagnostics).toHaveLength(2)
  })

  test('is byte-identical across runs', async () => {
    const first = await compileBundle(FIXTURE, { bundle: 'sales' })
    const second = await compileBundle(FIXTURE, { bundle: 'sales' })

    expect(second.tsv).toBe(first.tsv)
  })

  test('orders concepts by id, not by filesystem enumeration', async () => {
    const result = await compileBundle(FIXTURE, { bundle: 'sales' })
    const ids = result.concepts.map(concept => concept.id)

    expect(ids).toEqual([...ids].sort())
    expect(ids[0]).toBe('customers')
  })

  test('defaults the bundle name to the directory name', async () => {
    const result = await compileBundle(FIXTURE)

    expect(result.tsv.startsWith('# bundle: sales\n')).toBe(true)
  })

  test('honours the summary width budget', async () => {
    const result = await compileBundle(FIXTURE, {
      bundle: 'sales',
      summaryWidth: 12
    })
    const customers = result.concepts.find(
      concept => concept.id === 'customers'
    )

    expect(customers?.summary).toBe('Registered…')
  })
})

describe('serialize', () => {
  test('writes rows in the order given, leaving ordering to the caller', () => {
    const concepts: Concept[] = [
      { id: 'b', path: 'b.md', kind: 'x', grain: '-', summary: 's', links: [] },
      { id: 'a', path: 'a.md', kind: 'x', grain: '-', summary: 's', links: [] }
    ]

    const lines = serialize(concepts, 'demo').split('\n')

    expect(lines[2]).toBe('b\tx\t-\ts\t-')
    expect(lines[3]).toBe('a\tx\t-\ts\t-')
  })

  test('renders an empty link list as the empty cell marker', () => {
    const concepts: Concept[] = [
      { id: 'a', path: 'a.md', kind: 'x', grain: '-', summary: 's', links: [] }
    ]

    expect(serialize(concepts, 'demo')).toContain('a\tx\t-\ts\t-\n')
  })

  test('emits no timestamp so prompt caching survives a rebuild', () => {
    const output = serialize([], 'demo')

    expect(output).toBe('# bundle: demo\nid\tkind\tgrain\tsummary\tlinks\n')
  })
})
