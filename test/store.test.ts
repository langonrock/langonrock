import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compileTenant } from '../src/compile/tenant.ts'
import { acquireWriteLock } from '../src/store/lock.ts'
import { assertTenantId, currentFile, logFile } from '../src/store/paths.ts'
import { openTenant } from '../src/store/reader.ts'
import { putBundle } from '../src/store/writer.ts'

const FIXTURE = `${import.meta.dir}/fixtures/sales`

let scratch = ''
let root = ''

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'langonrock-store-'))
  root = join(scratch, 'data')
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

async function seedBundle(name: string, body: string): Promise<string> {
  const dir = join(scratch, name)

  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'thing.md'),
    `---\ntype: Table\ndescription: A thing.\n---\n\n${body}`
  )

  return dir
}

describe('assertTenantId', () => {
  test('accepts ordinary ids', () => {
    expect(assertTenantId('acme_1')).toBe('acme_1')
    expect(assertTenantId('T-2')).toBe('T-2')
  })

  test('rejects anything that could escape the tenant directory', () => {
    expect(() => assertTenantId('../evil')).toThrow('invalid tenant id')
    expect(() => assertTenantId('a/b')).toThrow('invalid tenant id')
    expect(() => assertTenantId('.')).toThrow('invalid tenant id')
    expect(() => assertTenantId('')).toThrow('invalid tenant id')
    expect(() => assertTenantId('a'.repeat(65))).toThrow('invalid tenant id')
  })
})

describe('acquireWriteLock', () => {
  test('refuses a second holder while the first is live', async () => {
    const path = join(scratch, 'demo.lock')
    const release = await acquireWriteLock(path)

    await expect(acquireWriteLock(path)).rejects.toThrow('another writer')
    await release()

    const second = await acquireWriteLock(path)

    await second()
  })

  test('steals a lock left behind by a dead writer', async () => {
    const path = join(scratch, 'stale.lock')

    await writeFile(path, '99999\n')
    await utimes(path, new Date(0), new Date(0))

    const release = await acquireWriteLock(path)

    await release()

    expect(await Bun.file(path).exists()).toBe(false)
  })

  test('releasing twice is harmless', async () => {
    const path = join(scratch, 'double.lock')
    const release = await acquireWriteLock(path)

    await release()
    await release()

    expect(await Bun.file(path).exists()).toBe(false)
  })
})

describe('putBundle', () => {
  test('writes a snapshot, a current pointer and a log entry', async () => {
    const result = await putBundle(FIXTURE, { root, tenant: 'acme' })

    expect(result.concepts).toBe(6)
    expect(result.reused).toBe(false)
    expect(result.snapshot).toMatch(/^[0-9a-f]{64}$/)

    const current = await readFile(currentFile(root, 'acme'), 'utf8')

    expect(current.trim()).toBe(result.snapshot)

    const log = await readFile(logFile(root, 'acme'), 'utf8')
    const entry = JSON.parse(log.trim().split('\n')[0] ?? '{}') as {
      snapshot: string
      concepts: number
    }

    expect(entry.snapshot).toBe(result.snapshot)
    expect(entry.concepts).toBe(6)
  })

  test('reuses the snapshot when content is unchanged', async () => {
    const first = await putBundle(FIXTURE, { root, tenant: 'reuse' })
    const second = await putBundle(FIXTURE, { root, tenant: 'reuse' })

    expect(second.snapshot).toBe(first.snapshot)
    expect(second.reused).toBe(true)
  })

  test('produces a new snapshot when content changes', async () => {
    const dir = await seedBundle('mutable', 'First body.\n')
    const first = await putBundle(dir, { root, tenant: 'mutable' })

    await writeFile(
      join(dir, 'thing.md'),
      '---\ntype: Table\ndescription: A thing.\n---\n\nSecond body.\n'
    )

    const second = await putBundle(dir, { root, tenant: 'mutable' })

    expect(second.snapshot).not.toBe(first.snapshot)

    const current = await readFile(currentFile(root, 'mutable'), 'utf8')

    expect(current.trim()).toBe(second.snapshot)
  })

  test('surfaces compile diagnostics to the caller', async () => {
    const result = await putBundle(FIXTURE, { root, tenant: 'diags' })

    expect(result.diagnostics).toHaveLength(2)
  })
})

describe('openTenant', () => {
  test('serves the same manifest bytes the compiler produced', async () => {
    await putBundle(FIXTURE, { root, tenant: 'read', bundle: 'sales' })

    const reader = await openTenant(root, 'read')
    const compiled = await compileTenant(
      [{ name: 'sales', dir: FIXTURE }],
      'read'
    )

    expect(await reader.manifest()).toBe(compiled.tsv)
  })

  test('fetches a batch of concepts in one call', async () => {
    await putBundle(FIXTURE, { root, tenant: 'batch' })

    const reader = await openTenant(root, 'batch')
    const found = await reader.get(['customers', 'tables/orders', 'orders_db'])

    expect([...found.keys()].sort()).toEqual([
      'customers',
      'orders_db',
      'tables/orders'
    ])
    expect(found.get('customers')).toContain('Back to [orders]')
  })

  test('returns only the requested section', async () => {
    const dir = await seedBundle(
      'sectioned',
      'Lead text.\n\n## Schema\n\ncol a\n\n## Joins\n\nx on y\n'
    )

    await putBundle(dir, { root, tenant: 'sectioned' })

    const reader = await openTenant(root, 'sectioned')
    const found = await reader.get(['thing'], 'schema')

    expect(found.get('thing')).toBe('## Schema\n\ncol a\n\n')
    expect(found.get('thing')).not.toContain('Lead text')
  })

  test('omits ids and sections that do not exist', async () => {
    await putBundle(FIXTURE, { root, tenant: 'missing' })

    const reader = await openTenant(root, 'missing')
    const byId = await reader.get(['customers', 'nope'])

    expect(byId.has('customers')).toBe(true)
    expect(byId.has('nope')).toBe(false)

    const bySection = await reader.get(['customers'], 'no_such_section')

    expect(bySection.size).toBe(0)
  })

  test('exposes every stored id', async () => {
    await putBundle(FIXTURE, { root, tenant: 'ids' })

    const reader = await openTenant(root, 'ids')

    expect(reader.ids).toHaveLength(6)
    expect(reader.ids).toContain('weekly_active_users')
  })

  test('reads the snapshot the current pointer names', async () => {
    const put = await putBundle(FIXTURE, { root, tenant: 'pointer' })
    const reader = await openTenant(root, 'pointer')

    expect(reader.snapshot).toBe(put.snapshot)
  })
})
