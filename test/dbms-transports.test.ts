import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { open } from '../src/client/connection.ts'
import { connect } from '../src/client/client.ts'
import { hash } from '../src/db/format.ts'
import { collect } from '../src/db/gc.ts'
import { createReadCache } from '../src/db/readcache.ts'
import { createMcpServer } from '../src/mcp/lazy.ts'
import { searchTenant } from '../src/search/tenant.ts'
import { serve } from '../src/server/http.ts'

import type {
  DatabaseConnection,
  RevisionPage,
  RevisionResult
} from '../src/types.ts'
import type { VerifyResult } from '../src/db/verify.ts'

let root: string
let server: ReturnType<typeof serve>
let local: DatabaseConnection
let remote: DatabaseConnection

beforeEach(async () => {
  root = await mkdtemp(`${tmpdir()}/langonrock-transports-`)
  server = serve({
    root,
    port: 0,
    writable: true,
    tokens: new Map([
      ['writer', { tenant: 'test', write: true }],
      ['reader', { tenant: 'test', write: false }],
      ['other', { tenant: 'other', write: true }]
    ])
  })
  local = open(`okf://${root}?tenant=test`)
  remote = connect(`okf+http://127.0.0.1:${server.port}?token=writer`)
})
afterEach(async () => {
  await local.close()
  await remote.close()
  await server.stop(true)
  await rm(root, { recursive: true, force: true })
})

const write = (path: string, content: string) => ({
  operation: 'write' as const,
  bundle: 'docs',
  path,
  content
})

function call(verb: string, body?: unknown, token = 'writer') {
  return fetch(`http://127.0.0.1:${server.port}/v1/${verb}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
}

test('native HTTP source writes and reads preserve BOMs and reject invalid UTF-8', async () => {
  const content = '\uFEFF---\ntype: concept\n---\n# Exact HTTP source\n'

  expect(await remote.writeSource('docs', 'bom.md', content)).toBe(
    hash(content)
  )
  expect((await local.readSource('docs', 'bom.md'))?.content).toBe(content)
  expect((await remote.readSource('docs', 'bom.md'))?.content).toBe(content)
  await expect(
    remote.writeSource('docs', 'invalid.md', '# Bad \uD800')
  ).rejects.toThrow('Unicode')
  const invalid = await fetch(
    `http://127.0.0.1:${server.port}/v1/source/docs/invalid.md`,
    {
      method: 'PUT',
      headers: { authorization: 'Bearer writer', 'if-none-match': '*' },
      body: new Uint8Array([35, 32, 0xff])
    }
  )

  expect(invalid.status).toBe(400)
  expect(await local.readSource('docs', 'invalid.md')).toBeUndefined()
})

test('CLI source input preserves a leading BOM', async () => {
  const content = '\uFEFF# Exact CLI source\n'
  const path = `${root}/input.md`

  await Bun.write(path, content)
  const child = Bun.spawn(
    [
      process.execPath,
      `${import.meta.dir}/../src/cli.ts`,
      'query',
      `okf://${root}?tenant=test`,
      'write',
      'docs',
      'cli.md',
      '--create',
      '--from',
      path
    ],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  const [, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ])

  expect(error).not.toContain('Error')
  expect(code).toBe(0)
  expect((await local.readSource('docs', 'cli.md'))?.content).toBe(content)
})

test('embedded and HTTP transactions publish immediate identical reads, history, and restore', async () => {
  const first = await remote.transact({
    changes: [
      write('a.md', '# Original\nneedle'),
      write('index.md', 'navigation')
    ]
  })

  expect(await local.manifest()).toBe(await remote.manifest())
  expect(await local.get(['a'])).toEqual(await remote.get(['a']))
  expect(await local.search('needle')).toBe(await remote.search('needle'))
  expect(await local.history()).toEqual(await remote.history())
  expect(await remote.sync()).toMatchObject(first)
  expect((await remote.history()).revisions).toHaveLength(1)
  await local.writeSource(
    'docs',
    'a.md',
    '# New\nuniqueMarker',
    hash('# Original\nneedle')
  )
  expect(await remote.search('uniqueMarker')).toContain('a\tdocs')
  expect(await remote.readSource('docs', 'a.md')).toEqual({
    content: '# New\nuniqueMarker',
    hash: hash('# New\nuniqueMarker')
  })

  const current = (await remote.history()).revisions[0]?.revision ?? ''
  const restored = await remote.restore({
    revision: first.revision,
    expectedRevision: current
  })

  expect(await local.snapshot()).toBe(first.snapshot)
  expect(restored.revision).not.toBe(first.revision)
  expect((await local.history()).revisions[0]?.parent).toBe(current)
  await expect(
    remote.restore({ revision: first.revision, expectedRevision: current })
  ).rejects.toMatchObject({ code: 'CONFLICT' })
})

test('HTTP rejects unauthorized, malformed, oversized, and cross-tenant batches without partial commits', async () => {
  const first = await local.transact({ changes: [write('a.md', 'old')] })

  expect(
    (await call('transact', { changes: [write('new.md', 'no')] }, 'reader'))
      .status
  ).toBe(403)
  expect(
    (await call('test/transact', { changes: [write('new.md', 'no')] }, 'other'))
      .status
  ).toBe(403)
  expect((await call('transact', null)).status).toBe(400)
  expect((await call('transact', { changes: [null] })).status).toBe(400)
  expect(
    (
      await call('transact', {
        changes: [{ ...write('b.md', 'no'), tenant: 'other' }]
      })
    ).status
  ).toBe(400)
  expect(
    (
      await call('transact', {
        changes: Array.from({ length: 1001 }, (_, index) =>
          write(`${index}.md`, 'no')
        )
      })
    ).status
  ).toBe(400)
  expect(
    (
      await call('transact', {
        changes: [write('new.md', 'no'), write('a.md', 'conflict')]
      })
    ).status
  ).toBe(409)
  expect((await local.history()).revisions[0]?.revision).toBe(first.revision)
  expect(await local.readSource('docs', 'new.md')).toBeUndefined()
  expect((await call('history', undefined, 'reader')).status).toBe(200)
  expect((await call('history?limit=101')).status).toBe(400)
  expect((await call('history?before=not-a-cursor')).status).toBe(400)
})

test('a read-only server permits history but rejects native changes even with a write token', async () => {
  await local.transact({ changes: [write('a.md', 'old')] })
  const readonly = serve({
    root,
    port: 0,
    tokens: new Map([['writer', { tenant: 'test', write: true }]])
  })
  const connection = connect(
    `okf+http://127.0.0.1:${readonly.port}?token=writer`
  )

  try {
    expect((await connection.history()).revisions).toHaveLength(1)
    expect((await connection.readSource('docs', 'a.md'))?.content).toBe('old')
    await expect(
      connection.transact({ changes: [write('b.md', 'denied')] })
    ).rejects.toThrow('409')
  } finally {
    await connection.close()
    await readonly.stop(true)
  }
})

test('native source routes commit writes and deletions with atomic hash preconditions', async () => {
  const original = await remote.writeSource('docs', 'a.md', '# HTTP original')

  expect((await local.get(['a'])).get('a')?.text).toBe('# HTTP original')
  await expect(remote.writeSource('docs', 'a.md', 'conflict')).rejects.toThrow(
    '412'
  )
  await remote.writeSource('docs', 'a.md', '# HTTP replacement', original)
  expect((await remote.listSource()).map(entry => entry.path)).toEqual(['a.md'])
  await expect(remote.deleteSource('docs', 'a.md', original)).rejects.toThrow(
    '412'
  )
  await remote.deleteSource('docs', 'a.md', hash('# HTTP replacement'))
  expect(await local.readSource('docs', 'a.md')).toBeUndefined()
  await remote.writeSource('docs', 'b.md', '# B')
  await remote.writeSource('docs', 'index.md', 'navigation')
  await remote.deleteBundle('docs')
  expect(await local.listSource()).toEqual([])
  expect((await local.history()).revisions).toHaveLength(6)
})

test('an entire search holds its old reader through publication, eviction, and collection', async () => {
  await local.transact({ changes: [write('a.md', '# Original\noldneedle')] })
  const cache = createReadCache(root, 1)
  const pinned = await cache.acquire('test')
  const index = await pinned.index()

  await local.writeSource(
    'docs',
    'a.md',
    '# Current\nnewneedle',
    hash('# Original\noldneedle')
  )
  const current = await cache.acquire('test')

  current.release()
  await collect({ root, tenant: 'test', keep: 1 })
  cache.close()
  expect(
    await searchTenant(index, 'oldneedle', {}, pinned.reader.get)
  ).toContain('a\tdocs')
  expect((await pinned.reader.get(['a'])).get('a')?.text).toBe(
    '# Original\noldneedle'
  )
  pinned.release()
  expect(() => pinned.reader.get(['a'])).toThrow('closed')
})

test('MCP retains six default tools and exposes working transactions only with explicit opt-in', async () => {
  const defaults = createMcpServer(local)
  const enabled = createMcpServer(local, undefined, { databaseTools: true })
  const normal = new Client({ name: 'default', version: '1' })
  const database = new Client({ name: 'database', version: '1' })
  const [normalClient, normalServer] = InMemoryTransport.createLinkedPair()
  const [dbClient, dbServer] = InMemoryTransport.createLinkedPair()

  await Promise.all([
    defaults.connect(normalServer),
    normal.connect(normalClient),
    enabled.connect(dbServer),
    database.connect(dbClient)
  ])

  try {
    expect(
      (await normal.listTools()).tools.map(tool => tool.name).sort()
    ).toEqual(['delete', 'get', 'manifest', 'search', 'snapshot', 'write'])
    expect(
      (await database.listTools()).tools.map(tool => tool.name).sort()
    ).toEqual([
      'delete',
      'get',
      'history',
      'manifest',
      'restore',
      'search',
      'snapshot',
      'transact',
      'write'
    ])
    const result = await database.callTool({
      name: 'transact',
      arguments: {
        changes: [write('a.md', 'MCP body'), write('b.md', 'atomic second')]
      }
    })

    expect(result.isError).not.toBe(true)
    expect((await remote.get(['a', 'b'])).size).toBe(2)
    const history = await database.callTool({ name: 'history', arguments: {} })

    expect(history.isError).not.toBe(true)
    expect(JSON.stringify(history)).toContain(
      (await local.history()).revisions[0]?.revision ?? 'missing'
    )
  } finally {
    await normal.close()
    await database.close()
    await defaults.close()
    await enabled.close()
  }
})

test('CLI commits JSON batches, paginates history, restores, and verifies native stores', async () => {
  const batch = `${root}/batch.json`

  await Bun.write(
    batch,
    JSON.stringify({ changes: [write('a.md', '# CLI body')] })
  )

  const run = async <T>(args: string[]): Promise<T> => {
    const child = Bun.spawn(
      [
        process.execPath,
        `${import.meta.dir}/../src/cli.ts`,
        ...args,
        '--data',
        root,
        '--tenant',
        'test'
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    const output = await new Response(child.stdout).text()
    const error = await new Response(child.stderr).text()

    expect(error).toBe('')
    expect(await child.exited).toBe(0)

    return JSON.parse(output) as T
  }

  const first = await run<RevisionResult>(['transact', '--from', batch])
  const page = await run<RevisionPage>(['history', '--limit', '1'])

  expect(page.revisions[0]?.revision).toBe(first.revision)
  expect(
    (
      await run<RevisionResult>([
        'restore',
        first.revision,
        '--expected-revision',
        first.revision
      ])
    ).snapshot
  ).toBe(first.snapshot)
  expect((await run<VerifyResult>(['verify'])).ok).toBe(true)
})
