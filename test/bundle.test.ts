import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { open } from '../src/client/connection.ts'
import { buildTenantIndex, searchTenant } from '../src/search/tenant.ts'
import { serve } from '../src/server/http.ts'
import { openTenant } from '../src/store/reader.ts'
import { putTenantRoot } from '../src/store/writer.ts'

import type { TenantIndex } from '../src/search/tenant.ts'
import type { LangonrockServer } from '../src/server/http.ts'
import type { TenantReader } from '../src/store/reader.ts'

const ON_POSIX = process.platform !== 'win32'

let scratch = ''
let socket = ''
let server: LangonrockServer | undefined
let reader: TenantReader
let built: TenantIndex

function concept(title: string, body: string): string {
  return `---\ntype: Table\ndescription: ${title}\n---\n\n${body}\n`
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-bundle-'))

  const source = join(scratch, 'sources')
  const root = join(scratch, 'data')

  await mkdir(join(source, 'sales'), { recursive: true })
  await mkdir(join(source, 'ops'), { recursive: true })

  for (let index = 0; index < 10; index++) {
    await writeFile(
      join(source, 'sales', `orders_${index}.md`),
      concept(`Sales orders slice ${index}.`, 'Orders orders orders.')
    )
  }

  await writeFile(
    join(source, 'ops', 'deploy.md'),
    concept('Deploy runbook for orders.', 'How to deploy the orders service.')
  )
  await writeFile(
    join(source, 'ops', 'rollback.md'),
    concept('Rollback runbook.', 'Reverses a [deploy](./deploy.md).')
  )

  await putTenantRoot(source, { root, tenant: 'acme' })
  reader = await openTenant(root, 'acme')
  built = await buildTenantIndex(reader)
  socket = `/tmp/lr-bundle-${process.pid}.sock`

  if (ON_POSIX) {
    server = serve({ root, unix: socket })
  }
})

afterAll(async () => {
  server?.stop(true)
  await rm(socket, { force: true })
  await rm(scratch, { recursive: true, force: true })
})

function rows(tsv: string): string[] {
  return tsv
    .split('\n')
    .filter(
      line => line !== '' && !line.startsWith('#') && !line.startsWith('id\t')
    )
}

function bundleOf(row: string): string {
  return row.split('\t')[1] ?? ''
}

describe('manifest by bundle', () => {
  test('returns only that bundle, keeping the preamble and columns', async () => {
    const slice = await reader.manifest('ops')

    expect(slice).toContain('# tenant: acme')
    expect(slice).toContain('id\tbundle\tkind\tstatus\tgrain\tsummary\tlinks')
    expect(rows(slice)).toHaveLength(2)
    expect(rows(slice).every(row => bundleOf(row) === 'ops')).toBe(true)
  })

  test('is much smaller than the whole tenant manifest', async () => {
    const whole = await reader.manifest()
    const slice = await reader.manifest('ops')

    expect(rows(whole)).toHaveLength(12)
    expect(slice.length).toBeLessThan(whole.length / 2)
  })

  test('groups each bundle into one contiguous run of rows', async () => {
    const seen = rows(await reader.manifest()).map(bundleOf)
    const runs = seen.filter((name, index) => name !== seen[index - 1])

    expect(runs).toEqual(['ops', 'sales'])
  })

  test('names the bundles it does have when asked for one it does not', async () => {
    expect(reader.manifest('marketing')).rejects.toThrow(
      /no bundle "marketing".*ops, sales/s
    )
  })
})

describe('search by bundle', () => {
  test('ranks within the bundle instead of trimming the global top k', async () => {
    const global = rows(
      await searchTenant(built, 'orders', { expand: false }, reader.get)
    )
    const scoped = rows(
      await searchTenant(
        built,
        'orders',
        { bundle: 'ops', expand: false },
        reader.get
      )
    )
    const idsOf = (found: string[]) => found.map(row => row.split('\t')[0])

    // Ten sales concepts crowd the global top k, so the one ops match is not
    // in it. Filtering before the cut is what brings it back.
    expect(global.every(row => bundleOf(row) === 'sales')).toBe(true)
    expect(idsOf(global)).not.toContain('deploy')
    expect(idsOf(scoped)).toEqual(['deploy'])
  })

  test('keeps the one hop expansion inside the bundle', async () => {
    const scoped = await searchTenant(
      built,
      'rollback',
      { bundle: 'ops' },
      reader.get
    )

    expect(rows(scoped).every(row => bundleOf(row) === 'ops')).toBe(true)
    expect(rows(scoped).map(row => row.split('\t')[0])).toContain('deploy')
  })

  test('records the narrowing in the header', async () => {
    expect(
      await searchTenant(built, 'orders', { bundle: 'ops' }, reader.get)
    ).toContain('# bundle: ops')
  })
})

describe('over the wire', () => {
  /**
   * The client caches the manifest by etag. If the whole document and a bundle
   * slice shared one entry, the second call would be answered from the wrong
   * body, and no status code would reveal it.
   */
  test('caches the whole manifest and a bundle slice separately', async () => {
    if (!ON_POSIX) {
      return
    }

    const remote = open(`okf+unix://${socket}?tenant=acme`)
    const whole = await remote.manifest()
    const slice = await remote.manifest('ops')

    expect(rows(slice)).toHaveLength(2)
    expect(rows(whole)).toHaveLength(12)
    expect(await remote.manifest()).toBe(whole)
    expect(await remote.manifest('ops')).toBe(slice)
  })

  test('narrows a search to one bundle across the wire', async () => {
    if (!ON_POSIX) {
      return
    }

    const remote = open(`okf+unix://${socket}?tenant=acme`)
    const scoped = await remote.search('orders', { bundle: 'ops' })

    expect(rows(scoped).every(row => bundleOf(row) === 'ops')).toBe(true)
  })
})
