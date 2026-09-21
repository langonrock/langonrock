import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { open } from '../src/client/connection.ts'
import { serve } from '../src/server/http.ts'
import { MAX_BYTES, sourceResponse } from '../src/server/sourceroutes.ts'
import { ensureSource, loadSources } from '../src/server/sources.ts'
import { openTenant } from '../src/store/reader.ts'
import {
  deleteSource,
  hashContent,
  listSource,
  readSource
} from '../src/store/source.ts'
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
  const sourceDir = (tenant: string) => sources.get(tenant)
  const sync = async (tenant: string) => putTenantRoot(source, { root, tenant })

  if (ON_POSIX) {
    server = serve({ root, unix: socket, sourceDir, sync })
  }

  tcp = serve({
    root,
    port: 0,
    hostname: '127.0.0.1',
    sourceDir,
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

/**
 * A unix socket where there is one and loopback TCP where there is not. The
 * write path is the same code either way, and gating these tests on the
 * transport left the whole source service untested on Windows.
 */
function local(): Connection {
  return ON_POSIX
    ? open(`okf+unix://${socket}?tenant=acme`)
    : open(tcpDsn('/?token=writer-token'))
}

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${tcp?.port}/v1/acme${path}`, {
    ...init,
    headers: {
      authorization: 'Bearer writer-token',
      ...(init.headers as Record<string, string>)
    }
  })
}

function put(headers: Record<string, string>, body: string): Promise<Response> {
  return api('/source/sales/tables/orders.md', {
    method: 'PUT',
    headers,
    body
  })
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

  test('deleting a file that is not there reports it instead of throwing', async () => {
    expect(await deleteSource(source, 'sales', 'tables/ghost.md')).toBe(false)
  })
})

describe('preconditions', () => {
  test('refuses a write that names no version', async () => {
    const response = await put({}, 'nope')

    expect(response.status).toBe(428)
    expect(await readSource(source, 'sales', 'tables/orders.md')).toEqual({
      content: CONCEPT,
      hash: hashContent(CONCEPT)
    })
  })

  test('refuses a write whose hash is stale', async () => {
    const response = await put({ 'if-match': '"deadbeef"' }, 'nope')

    expect(response.status).toBe(412)
  })

  test('refuses to create over something that exists', async () => {
    await expect(
      local().writeSource('sales', 'tables/orders.md', 'nope')
    ).rejects.toThrow('412')
  })

  test('accepts a write that names the current version', async () => {
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
    const connection = local()

    await connection.writeSource('ops', 'runbooks/deploy.md', CONCEPT)

    const result = await connection.sync()

    expect(result.bundles).toContain('ops')

    await connection.deleteBundle('ops')
    await connection.sync()
  })

  test('deleting a concept needs its hash too', async () => {
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

/**
 * The embedded connection checks preconditions itself rather than leaning on the
 * server. An editor developed against a local directory would otherwise learn
 * about lost updates only once it was pointed at a server.
 */
describe('the embedded connection', () => {
  function embedded(): Connection {
    return open(`okf://${root}?tenant=acme`)
  }

  test('refuses a create over a concept that already exists', async () => {
    await expect(
      embedded().writeSource('sales', 'tables/orders.md', 'nope')
    ).rejects.toThrow('concept already exists')
  })

  test('refuses a replace of a concept that is not there', async () => {
    await expect(
      embedded().writeSource('sales', 'tables/ghost.md', 'nope', 'deadbeef')
    ).rejects.toThrow('concept does not exist')
  })

  test('refuses a replace whose hash is stale', async () => {
    await expect(
      embedded().writeSource('sales', 'tables/orders.md', 'nope', 'deadbeef')
    ).rejects.toThrow('concept changed since it was read')
  })

  test('accepts a create and then a replace that names it', async () => {
    const connection = embedded()
    const hash = await connection.writeSource(
      'sales',
      'tables/local.md',
      CONCEPT
    )
    const updated = `${CONCEPT}\nEdited locally.\n`

    await connection.writeSource('sales', 'tables/local.md', updated, hash)

    expect(
      (await connection.readSource('sales', 'tables/local.md'))?.content
    ).toBe(updated)

    await connection.deleteSource(
      'sales',
      'tables/local.md',
      hashContent(updated)
    )

    expect(await readSource(source, 'sales', 'tables/local.md')).toBeUndefined()
  })

  test('removes a bundle it created', async () => {
    const connection = embedded()

    await connection.writeSource('scratch', 'note.md', CONCEPT)

    expect(await readSource(source, 'scratch', 'note.md')).toBeDefined()

    await connection.deleteBundle('scratch')

    expect(await readSource(source, 'scratch', 'note.md')).toBeUndefined()
  })
})

describe('a write reaches the snapshot', () => {
  test('sync makes a new concept visible in the manifest', async () => {
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

describe('the source routes', () => {
  test.each([
    ['GET', '/source/sales/tables/ghost.md', 404],
    ['DELETE', '/source/sales/tables/ghost.md', 404],
    ['POST', '/source', 405],
    ['PUT', '/source/sales', 400],
    ['PATCH', '/source/sales/tables/orders.md', 405],
    ['GET', '/bundles/sales', 405],
    ['DELETE', '/bundles', 400],
    ['DELETE', '/bundles/nope', 404]
  ])('answer %s %s with a %d', async (method, path, status) => {
    expect((await api(path, { method })).status).toBe(status)
  })

  test('refuse to replace a concept that was never there', async () => {
    const response = await api('/source/sales/tables/ghost.md', {
      method: 'PUT',
      headers: { 'if-match': '"deadbeef"' },
      body: 'nope'
    })

    expect(response.status).toBe(412)
  })

  test('refuse a body larger than a concept could reasonably be', async () => {
    const response = await api('/source/sales/tables/huge.md', {
      method: 'PUT',
      headers: { 'if-none-match': '*' },
      body: 'a'.repeat(MAX_BYTES + 1)
    })

    expect(response.status).toBe(413)
    // The message proves the route answered and not the transport underneath
    // it, which is what keeps the refusal identical on every platform.
    expect(await response.text()).toContain('may not exceed')
    expect(await readSource(source, 'sales', 'tables/huge.md')).toBeUndefined()

    // The connection has to survive the refusal. Answering before the body had
    // been read left the rest of it on the socket, and the next request over
    // that connection read those bytes as its own headers and hung.
    expect((await api('/snapshot')).status).toBe(200)
  })

  /**
   * A chunked upload declares no length, so the header check cannot see it and
   * the byte count after reading is the only thing standing in the way. The
   * route is called directly because keep-alive reuse makes a streamed request
   * through the http client answer inconsistently.
   */
  test('refuse an oversized body that declared no length', async () => {
    const chunk = new TextEncoder().encode('a'.repeat(100_000))
    const request = new Request('http://langonrock/streamed', {
      method: 'PUT',
      headers: { 'if-none-match': '*' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < 11; index++) {
            controller.enqueue(chunk)
          }

          controller.close()
        }
      }),
      duplex: 'half'
    } as RequestInit)

    expect(request.headers.get('content-length')).toBeNull()

    const refusal = await sourceResponse(request, {
      dir: async () => source,
      write: true,
      bundle: 'sales',
      path: 'tables/streamed.md'
    }).catch((cause: unknown) => cause)

    expect(refusal).toMatchObject({ status: 413 })
    expect(
      await readSource(source, 'sales', 'tables/streamed.md')
    ).toBeUndefined()
  })
})

describe('loadSources', () => {
  test('an absent file leaves every tenant read only', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'lr-sources-'))

    expect((await loadSources(empty)).size).toBe(0)
    await rm(empty, { recursive: true, force: true })
  })

  test('rejects anything that is not a map of directories', async () => {
    const bad = await mkdtemp(join(tmpdir(), 'lr-sources-'))
    const file = join(bad, 'sources.json')

    await Bun.write(file, '["nope"]')
    await expect(loadSources(bad)).rejects.toThrow('must be a JSON object')

    await Bun.write(file, '{"acme": 7}')
    await expect(loadSources(bad)).rejects.toThrow('non-string directory')

    await Bun.write(file, '{"acme": ""}')
    await expect(loadSources(bad)).rejects.toThrow('non-string directory')

    await rm(bad, { recursive: true, force: true })
  })

  test('reads back the mapping the server runs on', async () => {
    expect((await loadSources(root)).get('acme')).toBe(source)
  })
})

describe('tenants without a source directory', () => {
  test('stay readable and refuse writes', async () => {
    const bare = serve({
      root,
      port: 0,
      hostname: '127.0.0.1',
      tokens: new Map([['bare-token', { tenant: 'acme', write: true }]])
    })

    try {
      const connection = open(
        `okf+http://127.0.0.1:${bare.port}/?token=bare-token`
      )

      expect(await connection.manifest()).toContain('orders')
      // The token grants writing, so the refusal can only come from the missing
      // mapping rather than from the scope.
      await expect(connection.listSource()).rejects.toThrow(
        'no source directory'
      )
    } finally {
      bare.stop(true)
    }
  })

  test('the embedded connection refuses the same way', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'lr-nosource-'))

    try {
      const connection = open(`okf://${elsewhere}?tenant=acme`)

      await expect(connection.listSource()).rejects.toThrow(
        'no source directory'
      )
    } finally {
      await rm(elsewhere, { recursive: true, force: true })
    }
  })
})

describe('bootstrapping a tenant from nothing', () => {
  let bare = ''
  let started: LangonrockServer | undefined

  const call = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`http://127.0.0.1:${started?.port}/v1/fresh${path}`, {
      ...init,
      headers: {
        authorization: 'Bearer fresh-token',
        ...(init.headers as Record<string, string>)
      }
    })

  beforeAll(async () => {
    bare = await mkdtemp(join(tmpdir(), 'lr-bootstrap-'))
    started = serve({
      root: bare,
      port: 0,
      hostname: '127.0.0.1',
      sourceDir: (tenant: string, create: boolean) =>
        create ? ensureSource(bare, tenant) : undefined,
      tokens: new Map([
        ['fresh-token', { tenant: 'fresh', write: true }],
        ['fresh-reader', { tenant: 'fresh', write: false }]
      ])
    })
  })

  afterAll(async () => {
    started?.stop(true)
    await rm(bare, { recursive: true, force: true })
  })

  test('a put creates the tenant it writes into', async () => {
    const response = await call('/source/inbox/first.md', {
      method: 'PUT',
      headers: { 'if-none-match': '*' },
      body: CONCEPT
    })

    expect(response.status).toBe(204)
  })

  test('and registers it so the next start finds it', async () => {
    expect((await loadSources(bare)).get('fresh')).toBe(`${bare}/sources/fresh`)
  })

  test('a listing does not create anything', async () => {
    const untouched = await mkdtemp(join(tmpdir(), 'lr-bootstrap-get-'))
    const other = serve({
      root: untouched,
      port: 0,
      hostname: '127.0.0.1',
      sourceDir: (tenant: string, create: boolean) =>
        create ? ensureSource(untouched, tenant) : undefined,
      tokens: new Map([['t', { tenant: 'fresh', write: true }]])
    })

    try {
      const response = await fetch(
        `http://127.0.0.1:${other.port}/v1/fresh/source`,
        { headers: { authorization: 'Bearer t' } }
      )

      expect(response.status).toBe(409)
      expect(await Bun.file(`${untouched}/sources.json`).exists()).toBe(false)
    } finally {
      other.stop(true)
      await rm(untouched, { recursive: true, force: true })
    }
  })

  test('a read only token cannot bootstrap', async () => {
    const response = await call('/source/inbox/denied.md', {
      method: 'PUT',
      headers: { authorization: 'Bearer fresh-reader', 'if-none-match': '*' },
      body: CONCEPT
    })

    expect(response.status).toBe(403)
  })

  /**
   * The tenant is created by the write that succeeds, never by one that was
   * always going to be refused. Each of these is a different reason to refuse,
   * and each is settled before the directory is resolved.
   */
  describe('a refused write leaves nothing behind', () => {
    const refuse = async (
      init: RequestInit,
      path = '/source/inbox/x.md'
    ): Promise<number> => {
      const empty = await mkdtemp(join(tmpdir(), 'lr-refused-'))
      const other = serve({
        root: empty,
        port: 0,
        hostname: '127.0.0.1',
        sourceDir: (tenant: string, create: boolean) =>
          create ? ensureSource(empty, tenant) : undefined,
        tokens: new Map([
          ['t', { tenant: 'fresh', write: true }],
          ['r', { tenant: 'fresh', write: false }]
        ])
      })

      try {
        const response = await fetch(
          `http://127.0.0.1:${other.port}/v1/fresh${path}`,
          {
            ...init,
            headers: {
              authorization: 'Bearer t',
              ...(init.headers as Record<string, string>)
            }
          }
        )

        expect(await Bun.file(`${empty}/sources.json`).exists()).toBe(false)

        return response.status
      } finally {
        other.stop(true)
        await rm(empty, { recursive: true, force: true })
      }
    }

    test('a path that is not a concept', async () => {
      await expect(
        refuse(
          { method: 'PUT', headers: { 'if-none-match': '*' }, body: CONCEPT },
          '/source/inbox/notes.txt'
        )
      ).resolves.toBe(400)
    })

    test('a body past the concept limit', async () => {
      await expect(
        refuse({
          method: 'PUT',
          headers: { 'if-none-match': '*' },
          body: 'x'.repeat(MAX_BYTES + 1)
        })
      ).resolves.toBe(413)
    })

    test('a write with no precondition at all', async () => {
      await expect(refuse({ method: 'PUT', body: CONCEPT })).resolves.toBe(428)
    })

    test('a replacement of a concept that cannot exist', async () => {
      await expect(
        refuse({
          method: 'PUT',
          headers: { 'if-match': `"${'0'.repeat(64)}"` },
          body: CONCEPT
        })
      ).resolves.toBe(409)
    })

    test('a token that may not write', async () => {
      await expect(
        refuse({
          method: 'PUT',
          headers: { authorization: 'Bearer r', 'if-none-match': '*' },
          body: CONCEPT
        })
      ).resolves.toBe(403)
    })
  })

  test('a server with no source directories still refuses', async () => {
    const closed = await mkdtemp(join(tmpdir(), 'lr-noensure-'))
    const other = serve({
      root: closed,
      port: 0,
      hostname: '127.0.0.1',
      tokens: new Map([['t', { tenant: 'fresh', write: true }]])
    })

    try {
      const response = await fetch(
        `http://127.0.0.1:${other.port}/v1/fresh/source/inbox/x.md`,
        {
          method: 'PUT',
          headers: { authorization: 'Bearer t', 'if-none-match': '*' },
          body: CONCEPT
        }
      )

      expect(response.status).toBe(409)
    } finally {
      other.stop(true)
      await rm(closed, { recursive: true, force: true })
    }
  })

  test('the embedded connection also refuses before it creates', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'lr-embedded-refused-'))

    try {
      const connection = open(`okf://${empty}?tenant=typo`)

      await expect(
        connection.writeSource('inbox', 'notes.txt', CONCEPT)
      ).rejects.toThrow('must be a .md file')
      expect(await Bun.file(`${empty}/sources.json`).exists()).toBe(false)
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })

  test('a tenant compiled from an unregistered directory is left alone', async () => {
    await expect(ensureSource(root, 'acme')).resolves.toBe(source)

    const orphan = await mkdtemp(join(tmpdir(), 'lr-orphan-'))

    try {
      await putTenantRoot(source, { root: orphan, tenant: 'acme' })
      await expect(ensureSource(orphan, 'acme')).rejects.toThrow(
        'replaced by an empty one'
      )
    } finally {
      await rm(orphan, { recursive: true, force: true })
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
