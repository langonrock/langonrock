import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { open } from '../src/client/connection.ts'
import { putTenantRoot } from '../src/store/writer.ts'

let scratch = ''
let root = ''
let backup = ''

const TENANTS = ['acme', 'globex']

interface Fingerprint {
  snapshot: string
  manifest: string
  concept: string
  search: string
}

function md(description: string, body: string): string {
  return `---\ntype: Table\ndescription: ${description}\n---\n\n${body}\n`
}

async function write(name: string, version: number): Promise<string> {
  const source = join(scratch, 'src', name)

  await mkdir(join(source, 'sales'), { recursive: true })
  await writeFile(
    join(source, 'sales', 'orders.md'),
    md(`Orders for ${name}.`, `Revision ${version} of the ${name} ledger.`)
  )

  return source
}

async function fingerprint(tenant: string): Promise<Fingerprint> {
  const connection = open(`okf://${root}?tenant=${tenant}`)

  return {
    snapshot: await connection.snapshot(),
    manifest: await connection.manifest(),
    concept: (await connection.get(['orders'])).get('orders')?.text ?? '',
    search: await connection.search('ledger')
  }
}

function expectUnchanged(
  tenant: string,
  original: Fingerprint | undefined,
  after: Fingerprint
): void {
  if (original === undefined) {
    throw new Error(`no fingerprint was recorded for ${tenant}`)
  }

  // Guard against a vacuous pass: two empty strings also compare equal.
  expect(original.snapshot).toMatch(/^[0-9a-f]{64}$/)
  expect(original.manifest).toContain(`# tenant: ${tenant}`)
  expect(original.concept.length).toBeGreaterThan(0)

  expect(after.snapshot).toBe(original.snapshot)
  expect(after.manifest).toBe(original.manifest)
  expect(after.concept).toBe(original.concept)
  expect(after.search).toBe(original.search)
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-restore-'))
  root = join(scratch, 'data')
  backup = join(scratch, 'backup')

  // Several revisions per tenant so the store holds more than one snapshot,
  // which is what makes "copy the directory" a non-trivial claim.
  for (const tenant of TENANTS) {
    for (let version = 1; version <= 3; version++) {
      await putTenantRoot(await write(tenant, version), { root, tenant })
    }
  }
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

describe('the documented backup is sufficient', () => {
  test('destroying everything but a copy of tenants/ loses nothing', async () => {
    const before = new Map<string, Fingerprint>()

    for (const tenant of TENANTS) {
      before.set(tenant, await fingerprint(tenant))
    }

    // Back up only what Part 11 says to back up.
    await cp(join(root, 'tenants'), join(backup, 'tenants'), {
      recursive: true
    })

    // Then destroy the entire data root, not just the snapshots. If anything
    // outside tenants/ were load-bearing, this is where it would show up.
    await rm(root, { recursive: true, force: true })
    expect(await Bun.file(join(root, 'tenants')).exists()).toBe(false)

    await cp(join(backup, 'tenants'), join(root, 'tenants'), {
      recursive: true
    })

    for (const tenant of TENANTS) {
      expectUnchanged(tenant, before.get(tenant), await fingerprint(tenant))
    }
  })

  test('a restored store is still writable', async () => {
    const result = await putTenantRoot(await write('acme', 4), {
      root,
      tenant: 'acme'
    })

    expect(result.reused).toBe(false)
    expect(
      (await open(`okf://${root}?tenant=acme`).manifest()).includes('orders')
    ).toBe(true)
  })

  test('the search index rebuilds itself, because nothing persists it', async () => {
    const hits = await open(`okf://${root}?tenant=globex`).search('ledger')

    expect(hits).toContain('# query: ledger')
    expect(hits).toContain('orders')
  })
})

describe('incremental backup', () => {
  test('copying only the snapshots the backup lacks is enough', async () => {
    const tenant = 'globex'
    const live = join(root, 'tenants', tenant, 'snapshots')
    const saved = join(backup, 'tenants', tenant, 'snapshots')

    await putTenantRoot(await write(tenant, 9), { root, tenant })

    const expected = await fingerprint(tenant)
    const have = new Set(await readdir(saved))
    const missing = (await readdir(live)).filter(name => !have.has(name))

    expect(missing.length).toBeGreaterThan(0)

    for (const name of missing) {
      await cp(join(live, name), join(saved, name))
    }

    // The pointer is the only mutable file, so it has to come across too.
    await cp(
      join(root, 'tenants', tenant, 'current'),
      join(backup, 'tenants', tenant, 'current')
    )

    await rm(root, { recursive: true, force: true })
    await cp(join(backup, 'tenants'), join(root, 'tenants'), {
      recursive: true
    })

    const after = await fingerprint(tenant)

    expect(after.snapshot).toBe(expected.snapshot)
    expect(after.manifest).toBe(expected.manifest)
    expect(after.concept).toBe(expected.concept)
  })
})
