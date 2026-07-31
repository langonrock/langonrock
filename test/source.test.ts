import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { open } from '../src/client/connection.ts'
import { serve } from '../src/server/http.ts'
import { openTenant } from '../src/store/reader.ts'
import { hashContent, listSource, readSource } from '../src/store/source.ts'
import { putTenantRoot } from '../src/store/writer.ts'

import type { Connection } from '../src/client/connection.ts'
import type { LangonrockServer } from '../src/server/http.ts'

const ON_POSIX = process.platform !== 'win32'

const CONCEPT = `---
type: BigQuery Table
title: Orders
description: One row per completed customer order.
grain: order_id
---

# Schema

| column | type |
| --- | --- |
| order_id | STRING |
`

let scratch = ''
let root = ''
let source = ''
let socket = ''
let server: LangonrockServer | undefined
let tcp: LangonrockServer | undefined

function tcpDsn(query: string): string {
  return `okf+http://127.0.0.1:${tcp?.port}${query}`
}

async function seed(): Promise<void> {
  await mkdir(join(source, 'sales', 'tables'), { recursive: true })
  await writeFile(join(source, 'sales', 'tables', 'orders.md'), CONCEPT)
  await putTenantRoot(source, { root, tenant: 'acme' })
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-source-'))
  root = join(scratch, 'data')
  source = join(scratch, 'sources', 'acme')
  socket = `/tmp/lr-source-${process.pid}.sock`

  await mkdir(root, { recursive: true })
  await seed()
  await writeFile(join(root, 'sources.json'), JSON.stringify({ acme: source }))
  await writeFile(
    join(root, 'tokens.json'),
    JSON.stringify({
      'writer-token': { tenant: 'acme', write: true },
      'reader-token': 'acme'
    })
  )

  const sources = new Map([['acme', source]])
  const sync = async (tenant: string) => putTenantRoot(source, { root, tenant })

  if (ON_POSIX) {
    server = serve({ root, unix: socket, sources, sync })
  }

  tcp = serve({
    root,
    port: 0,
    hostname: '127.0.0.1',
    sources,
    sync,
    tokens: new Map([
      ['writer-token', { tenant: 'acme', write: true }],
      ['reader-token', { tenant: 'acme', write: false }]
    ])
  })
})

afterAll(async () => {
  server?.stop(true)
  tcp?.stop(true)
  await rm(socket, { force: true })
  await rm(scratch, { recursive: true, force: true })
})

function local(): Connection {
  return open(`okf+unix://${socket}?tenant=acme`)
}

describe('the source service', () => {
  test('lists every concept with its hash', async () => {
    const entries = await listSource(source)
    const orders = entries.find(entry => entry.path === 'tables/orders.md')

    expect(orders?.bundle).toBe('sales')
    expect(orders?.hash).toBe(hashContent(CONCEPT))
    expect(orders?.bytes).toBe(Buffer.byteLength(CONCEPT))
  })

  test('reads a concept back byte for byte', async () => {
    const found = await readSource(source, 'sales', 'tables/orders.md')

    expect(found?.content).toBe(CONCEPT)
  })
})

describe('preconditions', () => {
  test('refuses a write that names no version', async () => {
    if (!ON_POSIX) {
      return
    }

    const response = await fetch(
      'http://langonrock/v1/acme/source/sales/tables/orders.md',
      { unix: socket, method: 'PUT', body: 'nope' }
    )

    expect(response.status).toBe(428)
    expect(await readSource(source, 'sales', 'tables/orders.md')).toEqual({
      content: CONCEPT,
      hash: hashContent(CONCEPT)
    })
  })

  test('refuses a write whose hash is stale', async () => {
    if (!ON_POSIX) {
      return
    }

    const response = await fetch(
      'http://langonrock/v1/acme/source/sales/tables/orders.md',
      {
        unix: socket,
        method: 'PUT',
        headers: { 'if-match': '"deadbeef"' },
        body: 'nope'
      }
    )

    expect(response.status).toBe(412)
  })

  test('refuses to create over something that exists', async () => {
    if (!ON_POSIX) {
      return
    }

    await expect(
      local().writeSource('sales', 'tables/orders.md', 'nope')
    ).rejects.toThrow('412')
  })

  test('accepts a write that names the current version', async () => {
    if (!ON_POSIX) {
      return
    }

    const connection = local()
    const before = await connection.readSource('sales', 'tables/orders.md')
    const updated = `${CONCEPT}\nAppended by the editor.\n`
    const hash = await connection.writeSource(
      'sales',
      'tables/orders.md',
      updated,
      before?.hash
    )

    expect(hash).toBe(hashContent(updated))
    expect(
      (await readSource(source, 'sales', 'tables/orders.md'))?.content
    ).toBe(updated)

    await connection.writeSource('sales', 'tables/orders.md', CONCEPT, hash)
  })

  test('a second editor holding the old hash is refused, not merged', async () => {
    if (!ON_POSIX) {
      return
    }

    const connection = local()
    const stale = (await connection.readSource('sales', 'tables/orders.md'))
      ?.hash
    const first = `${CONCEPT}\nFirst editor.\n`

    await connection.writeSource(
      'sales',
      'tables/orders.md',
      first,
      stale ?? ''
    )

    await expect(
      connection.writeSource(
        'sales',
        'tables/orders.md',
        `${CONCEPT}\nSecond editor.\n`,
        stale ?? ''
      )
    ).rejects.toThrow('412')

    expect(
      (await readSource(source, 'sales', 'tables/orders.md'))?.content
    ).toBe(first)

    await connection.writeSource(
      'sales',
      'tables/orders.md',
      CONCEPT,
      hashContent(first)
    )
  })
})

describe('creating and removing', () => {
  test('writing the first file into a folder creates the bundle', async () => {
    if (!ON_POSIX) {
      return
    }

    const connection = local()

    await connection.writeSource('ops', 'runbooks/deploy.md', CONCEPT)

    const result = await connection.sync()

    expect(result.bundles).toContain('ops')

    await connection.deleteBundle('ops')
    await connection.sync()
  })

  test('deleting a concept needs its hash too', async () => {
    if (!ON_POSIX) {
      return
    }

    const connection = local()

    await connection.writeSource('sales', 'tables/temp.md', CONCEPT)

    await expect(
      connection.deleteSource('sales', 'tables/temp.md', 'deadbeef')
    ).rejects.toThrow('412')

    await connection.deleteSource(
      'sales',
      'tables/temp.md',
      hashContent(CONCEPT)
    )

    expect(await readSource(source, 'sales', 'tables/temp.md')).toBeUndefined()
  })
})

describe('a write reaches the snapshot', () => {
  test('sync makes a new concept visible in the manifest', async () => {
    if (!ON_POSIX) {
      return
    }

    const connection = local()
    const before = await connection.snapshot()

    await connection.writeSource('sales', 'metrics/revenue.md', CONCEPT)

    const synced = await connection.sync()

    expect(synced.snapshot).not.toBe(before)

    const reader = await openTenant(root, 'acme')

    expect(reader.ids).toContain('revenue')
    expect(await reader.manifest()).toContain('revenue')

    await connection.deleteSource(
      'sales',
      'metrics/revenue.md',
      hashContent(CONCEPT)
    )
    await connection.sync()
  })
})

describe('authorization', () => {
  test('a read only token may read the source but not write it', async () => {
    const reader = open(tcpDsn('/?token=reader-token'))

    expect(await reader.listSource()).not.toHaveLength(0)
    await expect(
      reader.writeSource('sales', 'tables/new.md', CONCEPT)
    ).rejects.toThrow('403')
  })

  test('a write token may write over TCP', async () => {
    const writer = open(tcpDsn('/?token=writer-token'))

    await writer.writeSource('sales', 'tables/tcp.md', CONCEPT)
    expect((await readSource(source, 'sales', 'tables/tcp.md'))?.content).toBe(
      CONCEPT
    )
    await writer.deleteSource('sales', 'tables/tcp.md', hashContent(CONCEPT))
  })

  test('a traversing path is refused over the wire', async () => {
    const writer = open(tcpDsn('/?token=writer-token'))

    await expect(
      writer.writeSource('sales', '../../escape.md', CONCEPT)
    ).rejects.toThrow()
  })
})

describe('tenants without a source directory', () => {
  test('stay readable and refuse writes', async () => {
    const bare = serve({ root, unix: `${socket}.bare` })

    try {
      const connection = open(`okf+unix://${socket}.bare?tenant=acme`)

      expect(await connection.manifest()).toContain('orders')
      await expect(connection.listSource()).rejects.toThrow(
        'no source directory'
      )
    } finally {
      bare.stop(true)
      await rm(`${socket}.bare`, { force: true })
    }
  })
})

/**
 * `deriveIds` gives every concept the shortest unambiguous id, so a file that
 * nobody touched can be renamed by the arrival of a sibling. An editor showing
 * ids has to re-read the manifest after a sync rather than assume they are
 * stable.
 */
describe('ids are not stable across a create', () => {
  test('adding a colliding file renames the concept that was already there', async () => {
    if (!ON_POSIX) {
      return
    }

    const connection = local()
    const before = await openTenant(root, 'acme')

    expect(before.ids).toContain('orders')

    await connection.writeSource('sales', 'staging/orders.md', CONCEPT)
    await connection.sync()

    const after = await openTenant(root, 'acme')

    expect(after.ids).not.toContain('orders')
    expect(after.ids).toContain('tables/orders')
    expect(after.ids).toContain('staging/orders')

    await connection.deleteSource(
      'sales',
      'staging/orders.md',
      hashContent(CONCEPT)
    )
    await connection.sync()
  })
})
