import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildIndex, search, tokenize } from '../src/search/bm25.ts'
import {
  buildTenantIndex,
  parseManifest,
  searchTenant
} from '../src/search/tenant.ts'
import { openTenant } from '../src/store/reader.ts'
import { putBundle } from '../src/store/writer.ts'

import type { TenantIndex } from '../src/search/tenant.ts'

const FIXTURE = `${import.meta.dir}/fixtures/sales`

let scratch = ''
let built: TenantIndex
let reader: Awaited<ReturnType<typeof openTenant>>

/** For indexes built by hand with no store behind them: every pos is `-`. */
const none = async () => new Map()

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-search-'))

  const root = join(scratch, 'data')

  await putBundle(FIXTURE, { root, tenant: 'acme', bundle: 'sales' })
  reader = await openTenant(root, 'acme')
  built = await buildTenantIndex(reader)
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

function ids(tsv: string): string[] {
  return tsv
    .split('\n')
    .filter(
      line => line !== '' && !line.startsWith('#') && !line.startsWith('id\t')
    )
    .map(line => line.split('\t')[0] ?? '')
}

describe('tokenize', () => {
  test('splits an underscored identifier the same way a query would', () => {
    expect(tokenize('order_id')).toEqual(['order', 'id'])
    expect(tokenize('order id')).toEqual(['order', 'id'])
  })

  test('lowercases and drops punctuation', () => {
    expect(tokenize('Hello, World! 42')).toEqual(['hello', 'world', '42'])
  })

  test('returns nothing for text with no word characters', () => {
    expect(tokenize('   --- ')).toEqual([])
  })

  test('folds accents so both spellings tokenize identically', () => {
    expect(tokenize('operações')).toEqual(['operacoes'])
    expect(tokenize('operacoes')).toEqual(['operacoes'])
    expect(tokenize('Métrica de Conversão')).toEqual([
      'metrica',
      'de',
      'conversao'
    ])
  })

  test('keeps non-latin letters instead of dropping them', () => {
    expect(tokenize('売上高 2024')).toEqual(['売上高', '2024'])
  })
})

describe('bm25 scoring', () => {
  test('ranks a rare term above a common one', () => {
    const index = buildIndex([
      { id: 'a', text: 'common rare' },
      { id: 'b', text: 'common' },
      { id: 'c', text: 'common' },
      { id: 'd', text: 'common' }
    ])

    expect(search(index, 'rare', 10).map(hit => hit.id)).toEqual(['a'])
    expect(search(index, 'common rare', 10)[0]?.id).toBe('a')
  })

  test('prefers the shorter document at equal term counts', () => {
    const index = buildIndex([
      { id: 'short', text: 'orders' },
      { id: 'long', text: `orders ${'filler '.repeat(50)}` }
    ])

    expect(search(index, 'orders', 10)[0]?.id).toBe('short')
  })

  test('saturates term frequency instead of scaling linearly', () => {
    const index = buildIndex([
      { id: 'once', text: 'orders a b c d e f g h i' },
      { id: 'many', text: 'orders '.repeat(10).trim() }
    ])
    const hits = new Map(search(index, 'orders', 10).map(h => [h.id, h.score]))
    const once = hits.get('once') ?? 0
    const many = hits.get('many') ?? 0

    expect(many).toBeGreaterThan(once)
    expect(many).toBeLessThan(once * 3)
  })

  test('breaks ties by id so repeated searches do not shuffle', () => {
    const index = buildIndex([
      { id: 'b', text: 'x' },
      { id: 'a', text: 'x' }
    ])

    expect(search(index, 'x', 10).map(hit => hit.id)).toEqual(['a', 'b'])
  })

  test('bounded selection matches the full ordering at every k', () => {
    const documents = Array.from({ length: 40 }, (_, index) => ({
      id: `doc_${String(index).padStart(2, '0')}`,
      text: `${'orders '.repeat((index % 5) + 1)}${'filler '.repeat(index % 7)}x`
    }))
    const index = buildIndex(documents)
    const full = search(index, 'orders filler', documents.length)

    expect(full).toHaveLength(documents.length)

    for (const k of [1, 3, 8, 17, 40]) {
      expect(search(index, 'orders filler', k)).toEqual(full.slice(0, k))
    }
  })

  test('returns nothing for an unknown term or an empty index', () => {
    expect(search(buildIndex([{ id: 'a', text: 'x' }]), 'zzz', 10)).toEqual([])
    expect(search(buildIndex([]), 'x', 10)).toEqual([])
  })

  test('honours k', () => {
    const index = buildIndex([
      { id: 'a', text: 'x' },
      { id: 'b', text: 'x' },
      { id: 'c', text: 'x' }
    ])

    expect(search(index, 'x', 2)).toHaveLength(2)
  })

  test('matches across accented and plain spellings both ways', () => {
    const index = buildIndex([
      { id: 'accented', text: 'Relatório de operações da região sul' },
      { id: 'plain', text: 'relatorio de operacoes da regiao norte' }
    ])

    expect(search(index, 'operações', 10)).toHaveLength(2)
    expect(search(index, 'operacoes', 10)).toHaveLength(2)
  })

  test('filters before the cut to k, not after', () => {
    const index = buildIndex([
      { id: 'a', text: 'orders orders orders' },
      { id: 'b', text: 'orders orders' },
      { id: 'c', text: 'orders' }
    ])

    expect(search(index, 'orders', 1, id => id === 'c').map(h => h.id)).toEqual(
      ['c']
    )
  })
})

describe('field weighting', () => {
  test('a manifest match outranks an incidental body mention', () => {
    const index = buildIndex([
      {
        id: 'orders',
        fields: 'orders bigquery_table order_id Completed customer orders.',
        text: 'The grain is one row per completed purchase, described below.'
      },
      {
        id: 'notes',
        fields: 'notes doc - Weekly meeting notes.',
        text: 'We discussed orders, then orders again, and closed on orders.'
      }
    ])

    expect(search(index, 'orders', 2)[0]?.id).toBe('orders')
  })

  test('leaves a document with no fields scored on its text alone', () => {
    const weighted = buildIndex([{ id: 'a', fields: 'orders', text: 'x y z' }])
    const plain = buildIndex([{ id: 'a', text: 'x y z' }])

    expect(search(plain, 'orders', 1)).toEqual([])
    expect(search(weighted, 'orders', 1).map(hit => hit.id)).toEqual(['a'])
  })

  test('a name match outranks the same term in ordinary fields', () => {
    const index = buildIndex([
      { id: 'named', names: 'rabbit', text: 'x y z' },
      { id: 'cited', fields: 'rabbit', text: 'x y z' }
    ])

    expect(search(index, 'rabbit', 2).map(hit => hit.id)).toEqual([
      'named',
      'cited'
    ])
  })

  test('finds a concept whose title never appears in its body', () => {
    const index = buildIndex([
      {
        id: 'recipe_181',
        names: 'recipe_181 Rabbit Soup',
        text: 'Take one, joint it, and simmer for three hours.'
      },
      {
        id: 'recipe_182',
        names: 'recipe_182 Onion Gravy',
        text: 'A rabbit pairs well with this, some say.'
      }
    ])

    expect(search(index, 'rabbit soup', 2)[0]?.id).toBe('recipe_181')
  })
})

describe('parseManifest', () => {
  test('separates comments, columns and rows, and splits links', () => {
    const manifest = parseManifest(
      [
        '# tenant: acme',
        '# bundles: sales',
        'id\tbundle\tkind\tgrain\tsummary\tlinks',
        'orders\tsales\ttable\torder_id\tOrders.\tcustomers payments',
        'customers\tsales\ttable\tcustomer_id\tCustomers.\t-',
        ''
      ].join('\n')
    )

    expect(manifest.comments).toEqual(['# tenant: acme', '# bundles: sales'])
    expect(manifest.columns.startsWith('id\t')).toBe(true)
    expect(manifest.rows.get('orders')?.links).toEqual([
      'customers',
      'payments'
    ])
    expect(manifest.rows.get('customers')?.links).toEqual([])
  })
})

describe('searchTenant', () => {
  test('finds a concept by a word that only its description contains', async () => {
    expect(ids(await searchTenant(built, 'churned', {}, reader.get))).toContain(
      'customers'
    )
  })

  test('expands one hop through the link graph', async () => {
    const result = await searchTenant(built, 'churned', {}, reader.get)

    expect(result).toContain('1 direct, 1 linked')
    expect(ids(result)).toEqual(['customers', 'tables/orders'])
  })

  test('can be told not to expand', async () => {
    const result = await searchTenant(
      built,
      'churned',
      { expand: false },
      reader.get
    )

    expect(result).toContain('0 linked')
    expect(ids(result)).toEqual(['customers'])
  })

  test('returns manifest rows, never concept bodies', async () => {
    const result = await searchTenant(built, 'orders', {}, reader.get)
    const lines = result.split('\n')
    const columns = lines.findIndex(line => line.startsWith('id\t'))

    expect(result).not.toContain('@@')
    expect(columns).toBeGreaterThan(-1)
    expect(lines.slice(0, columns).every(line => line.startsWith('#'))).toBe(
      true
    )
  })

  test('carries the query and the tenant header for the reader', async () => {
    const result = await searchTenant(built, 'orders grain', {}, reader.get)

    expect(result).toContain('# tenant: acme')
    expect(result).toContain('# query: orders grain')
  })

  test('honours k before expansion', async () => {
    const narrow = await searchTenant(
      built,
      'orders',
      { k: 1, expand: false },
      reader.get
    )

    expect(ids(narrow)).toHaveLength(1)
  })

  test('caps expansion at k so one hub cannot flood the result', async () => {
    const hub = parseManifest(
      [
        '# tenant: acme',
        'id\tbundle\tkind\tgrain\tsummary\tlinks',
        `hub\tb\tdataset\t-\tHub.\t${['a', 'b', 'c', 'd', 'e'].join(' ')}`,
        ...['a', 'b', 'c', 'd', 'e'].map(
          id => `${id}\tb\ttable\t-\tLeaf ${id}.\t-`
        ),
        ''
      ].join('\n')
    )
    const index: TenantIndex = {
      snapshot: 'x',
      manifest: hub,
      index: buildIndex([{ id: 'hub', text: 'hub dataset' }])
    }

    const result = await searchTenant(index, 'hub', { k: 2 }, none)

    expect(result).toContain('1 direct, 2 linked')
    expect(ids(result)).toHaveLength(3)
  })

  test('ranks an expansion target linked by several hits first', async () => {
    const graph = parseManifest(
      [
        '# tenant: acme',
        'id\tbundle\tkind\tgrain\tsummary\tlinks',
        'one\tb\ttable\t-\tAlpha.\tshared lonely',
        'two\tb\ttable\t-\tAlpha.\tshared',
        'shared\tb\ttable\t-\tShared.\t-',
        'lonely\tb\ttable\t-\tLonely.\t-',
        ''
      ].join('\n')
    )
    const index: TenantIndex = {
      snapshot: 'x',
      manifest: graph,
      index: buildIndex([
        { id: 'one', text: 'alpha' },
        { id: 'two', text: 'alpha' }
      ])
    }

    const result = ids(await searchTenant(index, 'alpha', { k: 2 }, none))

    expect(result.slice(2)).toEqual(['shared', 'lonely'])
  })

  test('returns only headers when nothing matches', async () => {
    const result = await searchTenant(built, 'zzzznotaword', {}, reader.get)

    expect(result).toContain('0 direct, 0 linked')
    expect(ids(result)).toEqual([])
  })

  test('is deterministic across repeated calls', async () => {
    expect(await searchTenant(built, 'orders', {}, reader.get)).toBe(
      await searchTenant(built, 'orders', {}, reader.get)
    )
  })

  test('appends a pos column and points a body match at its passage', async () => {
    const result = await searchTenant(built, 'orders', {}, reader.get)
    const lines = result.split('\n')
    const columns = lines.find(line => line.startsWith('id\t')) ?? ''
    const row = lines.find(line => line.startsWith('tables/orders\t')) ?? ''
    const pos = row.slice(row.lastIndexOf('\t') + 1)

    expect(columns.endsWith('\tpos')).toBe(true)
    expect(pos).toMatch(/^\d+$/)
  })

  test('pos is "-" when the query matches only the manifest row', async () => {
    const result = await searchTenant(built, 'churned', {}, reader.get)
    const row = result.split('\n').find(line => line.startsWith('customers\t'))

    expect(row?.endsWith('\t-')).toBe(true)
  })

  test('linked rows carry no pos', async () => {
    const result = await searchTenant(built, 'churned', {}, reader.get)
    const linked = result
      .split('\n')
      .find(line => line.startsWith('tables/orders\t'))

    expect(linked?.endsWith('\t-')).toBe(true)
  })

  test('finds a concept by a title the compiler stripped', async () => {
    const dir = join(scratch, 'titled')

    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'recipe_181.md'),
      '---\ntype: Recipe\ntitle: Rabbit Soup\n---\n\nJoint it and simmer for three hours.\n'
    )

    const root = join(scratch, 'titled-data')

    await putBundle(dir, { root, tenant: 'titled', bundle: 'recipes' })

    const titledReader = await openTenant(root, 'titled')
    const titled = await buildTenantIndex(titledReader)

    expect(
      ids(await searchTenant(titled, 'rabbit soup', {}, titledReader.get))
    ).toEqual(['recipe_181'])
  })
})
