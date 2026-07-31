import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { compileTenant, discoverBundles } from '../src/compile/tenant.ts'
import { openTenant } from '../src/store/reader.ts'
import { putTenantRoot } from '../src/store/writer.ts'

let scratch = ''

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-tenant-'))
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

function md(type: string, description: string, body = ''): string {
  return `---\ntype: ${type}\ndescription: ${description}\n---\n\n${body}`
}

type Layout = Record<string, Record<string, string>>

async function seed(name: string, layout: Layout): Promise<string> {
  const dir = join(scratch, name)

  await rm(dir, { recursive: true, force: true })

  for (const [bundle, files] of Object.entries(layout)) {
    for (const [path, body] of Object.entries(files)) {
      const target = join(dir, bundle, path)

      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, body)
    }
  }

  return dir
}

describe('discoverBundles', () => {
  test('treats every immediate subdirectory as a bundle, sorted', async () => {
    const dir = await seed('discover', {
      sales: { 'a.md': md('Table', 'a') },
      ops: { 'b.md': md('Runbook', 'b') }
    })

    await mkdir(join(dir, '.git'), { recursive: true })
    await writeFile(join(dir, 'README.md'), 'not a bundle')

    const bundles = await discoverBundles(dir)

    expect(bundles.map(bundle => bundle.name)).toEqual(['ops', 'sales'])
  })
})

describe('compileTenant', () => {
  test('carries a bundle column and keeps unique ids bare', async () => {
    const dir = await seed('unique', {
      sales: { 'orders.md': md('Table', 'Orders.') },
      ops: { 'deploy.md': md('Runbook', 'Deploy.') }
    })

    const result = await compileTenant(await discoverBundles(dir), 'acme')
    const lines = result.tsv.split('\n')

    expect(lines[0]).toBe('# tenant: acme')
    expect(lines[1]).toBe('# bundles: ops sales')
    expect(lines[2]).toBe('id\tbundle\tkind\tgrain\tsummary\tlinks')
    expect(lines[3]).toBe('deploy\tops\trunbook\t-\tDeploy.\t-')
    expect(lines[4]).toBe('orders\tsales\ttable\t-\tOrders.\t-')
  })

  test('prefixes only the ids that collide across bundles', async () => {
    const dir = await seed('collide', {
      sales: {
        'orders.md': md('Table', 'Sales orders.'),
        'customers.md': md('Table', 'Customers.')
      },
      ops: { 'orders.md': md('Runbook', 'Ops orders.') }
    })

    const result = await compileTenant(await discoverBundles(dir), 'acme')
    const ids = result.concepts.map(concept => concept.id)

    expect(ids).toEqual(['customers', 'ops/orders', 'sales/orders'])
  })

  test('rewrites links to the global ids', async () => {
    const dir = await seed('links', {
      sales: {
        'orders.md': md('Table', 'Orders.', 'See [c](./customers.md).\n'),
        'customers.md': md('Table', 'Customers.')
      },
      ops: { 'orders.md': md('Runbook', 'Ops orders.') }
    })

    const result = await compileTenant(await discoverBundles(dir), 'acme')
    const orders = result.concepts.find(
      concept => concept.id === 'sales/orders'
    )

    expect(orders?.links).toEqual(['customers'])
  })

  test('rewrites a link whose target was itself renamed', async () => {
    const dir = await seed('links-renamed', {
      sales: {
        'orders.md': md('Table', 'Orders.', 'See [c](./customers.md).\n'),
        'customers.md': md('Table', 'Sales customers.')
      },
      ops: {
        'orders.md': md('Runbook', 'Ops orders.'),
        'customers.md': md('Table', 'Ops customers.')
      }
    })

    const result = await compileTenant(await discoverBundles(dir), 'acme')
    const orders = result.concepts.find(
      concept => concept.id === 'sales/orders'
    )

    expect(orders?.links).toEqual(['sales/customers'])
  })

  test('keeps bodies reachable under the global id', async () => {
    const dir = await seed('bodies', {
      sales: { 'orders.md': md('Table', 'Orders.', 'Body text here.\n') },
      ops: { 'orders.md': md('Runbook', 'Ops orders.') }
    })

    const result = await compileTenant(await discoverBundles(dir), 'acme')

    expect(result.bodies.get('sales/orders')).toContain('Body text here.')
  })

  test('is byte-identical across runs', async () => {
    const dir = await seed('determinism', {
      sales: { 'orders.md': md('Table', 'Orders.') },
      ops: { 'deploy.md': md('Runbook', 'Deploy.') }
    })
    const sources = await discoverBundles(dir)
    const first = await compileTenant(sources, 'acme')
    const second = await compileTenant(sources, 'acme')

    expect(second.tsv).toBe(first.tsv)
  })
})

describe('putTenantRoot', () => {
  test('stores every bundle in one snapshot', async () => {
    const source = await seed('store-multi', {
      sales: { 'orders.md': md('Table', 'Orders.') },
      ops: { 'deploy.md': md('Runbook', 'Deploy.') }
    })
    const root = join(scratch, 'data-multi')
    const result = await putTenantRoot(source, { root, tenant: 'acme' })

    expect(result.bundles).toEqual(['ops', 'sales'])
    expect(result.concepts).toBe(2)

    const reader = await openTenant(root, 'acme')

    expect(reader.ids.sort()).toEqual(['deploy', 'orders'])
  })

  test('adding a folder adds a bundle', async () => {
    const source = await seed('store-add', {
      sales: { 'orders.md': md('Table', 'Orders.') }
    })
    const root = join(scratch, 'data-add')
    const before = await putTenantRoot(source, { root, tenant: 'acme' })

    await mkdir(join(source, 'ops'), { recursive: true })
    await writeFile(join(source, 'ops', 'deploy.md'), md('Runbook', 'Deploy.'))

    const after = await putTenantRoot(source, { root, tenant: 'acme' })

    expect(before.bundles).toEqual(['sales'])
    expect(after.bundles).toEqual(['ops', 'sales'])
    expect(after.snapshot).not.toBe(before.snapshot)
  })

  test('deleting a folder removes a bundle', async () => {
    const source = await seed('store-remove', {
      sales: { 'orders.md': md('Table', 'Orders.') },
      ops: { 'deploy.md': md('Runbook', 'Deploy.') }
    })
    const root = join(scratch, 'data-remove')

    await putTenantRoot(source, { root, tenant: 'acme' })
    await rm(join(source, 'ops'), { recursive: true, force: true })

    const after = await putTenantRoot(source, { root, tenant: 'acme' })
    const reader = await openTenant(root, 'acme')

    expect(after.bundles).toEqual(['sales'])
    expect(reader.ids).toEqual(['orders'])
  })
})
