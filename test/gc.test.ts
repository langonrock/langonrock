import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { collect, collectAll, listTenants } from '../src/store/gc.ts'
import { openTenant } from '../src/store/reader.ts'
import { putTenantRoot } from '../src/store/writer.ts'

let scratch = ''

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-gc-'))
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

function md(description: string): string {
  return `---\ntype: Table\ndescription: ${description}\n---\n\nBody.\n`
}

interface Store {
  source: string
  root: string
  dir: string
}

async function seed(name: string, versions: number): Promise<Store> {
  const source = join(scratch, name, 'src')
  const root = join(scratch, name, 'data')

  await mkdir(join(source, 'sales'), { recursive: true })

  for (let version = 0; version < versions; version++) {
    await writeFile(
      join(source, 'sales', 'orders.md'),
      md(`Version ${version}.`)
    )
    await putTenantRoot(source, { root, tenant: 'acme' })
  }

  return { source, root, dir: join(root, 'tenants', 'acme', 'snapshots') }
}

async function snapshots(store: Store): Promise<string[]> {
  return (await readdir(store.dir)).filter(name => name.endsWith('.tnt')).sort()
}

/** Pushes every snapshot past the grace window so a test can collect them. */
async function age(store: Store): Promise<void> {
  const old = new Date(Date.now() - 86_400_000)

  for (const name of await readdir(store.dir)) {
    await utimes(join(store.dir, name), old, old)
  }
}

async function currentOf(store: Store): Promise<string> {
  return (
    await readFile(join(store.root, 'tenants', 'acme', 'current'), 'utf8')
  ).trim()
}

async function truncate(path: string, bytes: number): Promise<void> {
  const original = await Bun.file(path).arrayBuffer()

  await Bun.write(path, new Uint8Array(original).slice(0, bytes))
}

describe('the write path no longer leaves reusable partials', () => {
  test('a completed put leaves no temp file behind', async () => {
    const store = await seed('clean', 2)

    expect((await readdir(store.dir)).filter(n => n.endsWith('.tmp'))).toEqual(
      []
    )
  })
})

describe('collect', () => {
  test('keeps current and the newest snapshots, removes the rest', async () => {
    const store = await seed('retain', 5)

    await age(store)

    const before = await snapshots(store)
    const result = await collect({ root: store.root, tenant: 'acme', keep: 2 })
    const after = await snapshots(store)

    expect(before).toHaveLength(5)
    expect(after.length).toBeLessThan(before.length)
    expect(result.removed.length).toBe(before.length - after.length)
    expect(after).toContain(`${await currentOf(store)}.tnt`)
  })

  test('never removes the snapshot current points at', async () => {
    const store = await seed('current', 4)

    await age(store)
    await collect({ root: store.root, tenant: 'acme', keep: 1 })

    const current = await currentOf(store)

    expect(await snapshots(store)).toContain(`${current}.tnt`)
    expect((await openTenant(store.root, 'acme')).ids).toEqual(['orders'])
  })

  test('leaves anything inside the grace window alone', async () => {
    const store = await seed('grace', 4)
    const before = await snapshots(store)
    const result = await collect({ root: store.root, tenant: 'acme', keep: 1 })

    expect(result.removed).toEqual([])
    expect(await snapshots(store)).toEqual(before)
    expect(result.skipped.every(s => s.reason.includes('grace'))).toBe(true)
  })

  test('a dry run reports without deleting', async () => {
    const store = await seed('dry', 4)

    await age(store)

    const before = await snapshots(store)
    const result = await collect({
      root: store.root,
      tenant: 'acme',
      keep: 1,
      dryRun: true
    })

    expect(result.removed.length).toBeGreaterThan(0)
    expect(await snapshots(store)).toEqual(before)
  })

  test('sweeps partial writes left by a crash', async () => {
    const store = await seed('partials', 1)
    const orphan = join(store.dir, 'deadbeef.tnt.tmp')

    await writeFile(orphan, 'half a snapshot')
    await age(store)

    const result = await collect({ root: store.root, tenant: 'acme' })

    expect(result.partials).toEqual(['deadbeef.tnt.tmp'])
    expect(await Bun.file(orphan).exists()).toBe(false)
  })
})

describe('truncated snapshots', () => {
  test('are detected and collected even inside the keep window', async () => {
    const store = await seed('corrupt', 3)
    const all = await snapshots(store)
    const current = `${await currentOf(store)}.tnt`
    const victim = all.find(name => name !== current) ?? ''

    await truncate(join(store.dir, victim), 40)
    await age(store)

    const result = await collect({
      root: store.root,
      tenant: 'acme',
      keep: 10
    })

    expect(result.corrupt).toContain(victim)
    expect(result.removed).toContain(victim)
    expect(await snapshots(store)).not.toContain(victim)
  })

  test('are reported loudly when current points at one', async () => {
    const store = await seed('corrupt-current', 1)
    const current = `${await currentOf(store)}.tnt`

    await truncate(join(store.dir, current), 40)

    const result = await collect({ root: store.root, tenant: 'acme' })

    expect(result.currentCorrupt).toBe(true)
    expect(result.corrupt).toContain(current)
    // Still not deleted: losing it would remove the only evidence of what broke.
    expect(await snapshots(store)).toContain(current)
  })

  test('an intact store reports nothing corrupt', async () => {
    const store = await seed('healthy', 2)
    const result = await collect({ root: store.root, tenant: 'acme' })

    expect(result.corrupt).toEqual([])
    expect(result.currentCorrupt).toBe(false)
  })
})

describe('collectAll', () => {
  test('walks every tenant under the root', async () => {
    const source = join(scratch, 'many', 'src')
    const root = join(scratch, 'many', 'data')

    await mkdir(join(source, 'sales'), { recursive: true })
    await writeFile(join(source, 'sales', 'orders.md'), md('Orders.'))
    await putTenantRoot(source, { root, tenant: 'one' })
    await putTenantRoot(source, { root, tenant: 'two' })

    expect(await listTenants(root)).toEqual(['one', 'two'])

    const results = await collectAll({ root })

    expect(results.map(result => result.tenant)).toEqual(['one', 'two'])
    expect(results.every(result => !result.currentCorrupt)).toBe(true)
  })
})
