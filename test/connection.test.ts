import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { open } from '../src/client/connection.ts'
import { normalizeDsn, parseDsn } from '../src/client/dsn.ts'
import { serve } from '../src/server/http.ts'
import { loadTokens } from '../src/server/tokens.ts'
import { putBundle } from '../src/store/writer.ts'

import type { LangonrockServer } from '../src/server/http.ts'

const FIXTURE = `${import.meta.dir}/fixtures/sales`
const ON_POSIX = process.platform !== 'win32'

let scratch = ''
let root = ''
let socket = ''
let socketServer: LangonrockServer | undefined
let tcpServer: LangonrockServer | undefined

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-conn-'))
  root = join(scratch, 'data')
  socket = `/tmp/lr-${process.pid}.sock`

  await putBundle(FIXTURE, { root, tenant: 'acme', bundle: 'sales' })
  await writeFile(
    join(root, 'tokens.json'),
    JSON.stringify({ 'secret-acme': 'acme' })
  )

  if (ON_POSIX) {
    socketServer = serve({ root, unix: socket })
  }

  tcpServer = serve({
    root,
    port: 0,
    hostname: '127.0.0.1',
    tokens: await loadTokens(root)
  })
})

afterAll(async () => {
  socketServer?.stop(true)
  tcpServer?.stop(true)
  await rm(scratch, { recursive: true, force: true })
  await rm(socket, { force: true })
})

function tcpDsn(query: string): string {
  return `okf+http://127.0.0.1:${tcpServer?.port}${query}`
}

describe('parseDsn', () => {
  test('reads an embedded target', () => {
    const target = parseDsn('okf:///var/data/okf?tenant=acme')

    expect(target.transport).toBe('embedded')
    expect(target.path).toBe('/var/data/okf')
    expect(target.tenant).toBe('acme')
  })

  test('reads a unix socket target', () => {
    const target = parseDsn('okf+unix:///tmp/okf.sock?tenant=acme')

    expect(target.transport).toBe('unix')
    expect(target.path).toBe('/tmp/okf.sock')
  })

  test('builds a windows pipe path', () => {
    const target = parseDsn('okf+npipe://./pipe/okf')

    expect(target.transport).toBe('npipe')
    expect(target.path).toBe('\\\\.\\pipe\\okf')
  })

  test('keeps the scheme when choosing http or https', () => {
    expect(parseDsn('okf+https://h:7777/?token=t').origin).toBe(
      'https://h:7777'
    )
    expect(parseDsn('okf+http://h:7777/?token=t').origin).toBe('http://h:7777')
  })

  test('carries the token without putting it in the path', () => {
    const target = parseDsn('okf+https://host:7777/?token=abc')

    expect(target.token).toBe('abc')
    expect(target.tenant).toBeUndefined()
  })

  test('rejects an unknown scheme and a malformed dsn', () => {
    expect(() => parseDsn('postgres://localhost/db')).toThrow(
      'unsupported dsn scheme'
    )
    expect(() => parseDsn('not a url')).toThrow('invalid dsn')
  })

  test('rejects a tenant that could escape the data directory', () => {
    expect(() => parseDsn('okf:///data?tenant=../evil')).toThrow(
      'invalid tenant id'
    )
  })

  test('accepts a windows path written with backslashes', () => {
    const target = parseDsn('okf://C:\\Users\\me\\data?tenant=acme')

    expect(target.transport).toBe('embedded')
    expect(target.path).toBe('C:/Users/me/data')
    expect(target.tenant).toBe('acme')
  })

  test('accepts a windows path in the file-url form', () => {
    expect(parseDsn('okf:///C:/Users/me/data?tenant=acme').path).toBe(
      'C:/Users/me/data'
    )
  })

  test('does not mistake a drive letter for a host', () => {
    const target = parseDsn('okf://C:/Users/me/data?tenant=acme')

    expect(target.path).toBe('C:/Users/me/data')
    expect(target.origin).toBe('http://langonrock')
  })

  test('leaves posix paths and the query string untouched', () => {
    expect(normalizeDsn('okf:///var/data/okf?tenant=acme')).toBe(
      'okf:///var/data/okf?tenant=acme'
    )
    expect(parseDsn('okf://C:\\data?token=a\\b').token).toBe('a\\b')
  })
})

describe('open', () => {
  test('explains the windows fallback instead of failing obscurely', () => {
    expect(() => open('okf+npipe://./pipe/okf')).toThrow('loopback TCP')
  })

  test('requires a tenant for an embedded dsn', () => {
    expect(() => open('okf:///var/data')).toThrow('needs ?tenant=')
  })
})

describe('transport parity', () => {
  test('embedded and socket return the same manifest', async () => {
    const embedded = open(`okf://${root}?tenant=acme`)

    expect((await embedded.manifest()).startsWith('# tenant: acme')).toBe(true)

    if (!ON_POSIX) {
      return
    }

    const remote = open(`okf+unix://${socket}?tenant=acme`)

    expect(await remote.manifest()).toBe(await embedded.manifest())
    expect(await remote.snapshot()).toBe(await embedded.snapshot())
  })

  test('embedded and socket return the same concepts', async () => {
    if (!ON_POSIX) {
      return
    }

    const ids = ['customers', 'tables/orders']
    const embedded = await open(`okf://${root}?tenant=acme`).get(ids)
    const remote = await open(`okf+unix://${socket}?tenant=acme`).get(ids)

    expect([...remote.keys()].sort()).toEqual([...embedded.keys()].sort())
    expect(remote.get('customers')).toBe(embedded.get('customers'))
  })

  test('embedded and socket rank identically', async () => {
    const embedded = await open(`okf://${root}?tenant=acme`).search('churned')

    expect(embedded).toContain('# query: churned')

    if (!ON_POSIX) {
      return
    }

    const remote = await open(`okf+unix://${socket}?tenant=acme`).search(
      'churned'
    )

    expect(remote).toBe(embedded)
  })

  test('a section filter survives the wire', async () => {
    if (!ON_POSIX) {
      return
    }

    const remote = open(`okf+unix://${socket}?tenant=acme`)
    const found = await remote.get(['tables/orders'], 'no_such_section')

    expect(found.size).toBe(0)
  })

  test('a bundle filter survives the wire', async () => {
    if (!ON_POSIX) {
      return
    }

    const remote = open(`okf+unix://${socket}?tenant=acme`)

    expect(await remote.manifest('sales')).toBe(
      await open(`okf://${root}?tenant=acme`).manifest('sales')
    )
  })

  test('reports an unknown bundle instead of returning nothing', async () => {
    if (!ON_POSIX) {
      return
    }

    const remote = open(`okf+unix://${socket}?tenant=acme`)

    expect(remote.manifest('nope')).rejects.toThrow(/no bundle "nope"/)
  })
})

describe('authentication', () => {
  test('refuses to bind TCP without tokens', () => {
    expect(() => serve({ root, port: 9999, tokens: new Map() })).toThrow(
      'refusing to listen on TCP without tokens'
    )
  })

  test('resolves the tenant from the token with no tenant in the path', async () => {
    const connection = open(tcpDsn('/?token=secret-acme'))

    expect((await connection.manifest()).startsWith('# tenant: acme')).toBe(
      true
    )
  })

  test('rejects a bad token', async () => {
    const connection = open(tcpDsn('/?token=wrong'))

    await expect(connection.manifest()).rejects.toThrow('401')
  })

  test('rejects a token used against another tenant', async () => {
    const connection = open(tcpDsn('/?tenant=other&token=secret-acme'))

    await expect(connection.manifest()).rejects.toThrow('403')
  })

  test('accepts a path tenant that agrees with the token', async () => {
    const connection = open(tcpDsn('/?tenant=acme&token=secret-acme'))

    expect(await connection.snapshot()).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('etag revalidation', () => {
  test('a repeat manifest call is served from cache after a 304', async () => {
    const connection = open(tcpDsn('/?token=secret-acme'))
    const first = await connection.manifest()
    const second = await connection.manifest()

    expect(second).toBe(first)
  })

  test('the server answers 304 when the etag matches', async () => {
    const base = `http://127.0.0.1:${tcpServer?.port}/v1/manifest`
    const auth = { authorization: 'Bearer secret-acme' }
    const first = await fetch(base, { headers: auth })
    const etag = first.headers.get('etag') ?? ''

    expect(etag).toMatch(/^"[0-9a-f]{64}"$/)

    const second = await fetch(base, {
      headers: { ...auth, 'if-none-match': etag }
    })

    expect(second.status).toBe(304)
    expect(await second.text()).toBe('')
  })
})

describe('routing', () => {
  test('unknown routes are a 404', async () => {
    const response = await fetch(
      `http://127.0.0.1:${tcpServer?.port}/v1/acme/nope`,
      { headers: { authorization: 'Bearer secret-acme' } }
    )

    expect(response.status).toBe(404)
  })

  test('get requires POST', async () => {
    const response = await fetch(`http://127.0.0.1:${tcpServer?.port}/v1/get`, {
      headers: { authorization: 'Bearer secret-acme' }
    })

    expect(response.status).toBe(405)
  })

  test('search rejects a body without a query', async () => {
    const response = await fetch(
      `http://127.0.0.1:${tcpServer?.port}/v1/search`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret-acme',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ k: 3 })
      }
    )

    expect(response.status).toBe(400)
  })

  test('search requires POST', async () => {
    const response = await fetch(
      `http://127.0.0.1:${tcpServer?.port}/v1/search`,
      { headers: { authorization: 'Bearer secret-acme' } }
    )

    expect(response.status).toBe(405)
  })

  test('get rejects a body without an ids array', async () => {
    const response = await fetch(`http://127.0.0.1:${tcpServer?.port}/v1/get`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret-acme',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ nope: true })
    })

    expect(response.status).toBe(400)
  })
})

describe('loadTokens', () => {
  test('returns an empty map when no tokens file exists', async () => {
    expect((await loadTokens(scratch)).size).toBe(0)
  })

  test('rejects a tokens file that is not an object of strings', async () => {
    const bad = await mkdtemp(join(tmpdir(), 'lr-bad-'))

    await Bun.write(join(bad, 'tokens.json'), '["nope"]')
    await expect(loadTokens(bad)).rejects.toThrow('must be a JSON object')
    await rm(bad, { recursive: true, force: true })
  })
})
