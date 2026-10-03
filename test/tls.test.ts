import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { serve } from '../src/server/http.ts'
import { putBundle } from '../src/store/writer.ts'

import type { LangonrockServer } from '../src/server/http.ts'
import type { Grant } from '../src/server/tokens.ts'

const FIXTURE = `${import.meta.dir}/fixtures/sales`
const TLS_DIR = `${import.meta.dir}/fixtures/tls`

let scratch = ''
let root = ''
let tls: { cert: string; key: string }

const tokens = new Map<string, Grant>([
  ['secret-acme', { tenant: 'acme', write: false }]
])

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-tls-'))
  root = join(scratch, 'data')
  tls = {
    cert: await Bun.file(`${TLS_DIR}/localhost-cert.pem`).text(),
    key: await Bun.file(`${TLS_DIR}/localhost-key.pem`).text()
  }

  await putBundle(FIXTURE, { root, tenant: 'acme', bundle: 'sales' })
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

/** The fixture signs itself, so verification is off for the test only. */
function insecure(url: string): Promise<Response> {
  return fetch(url, {
    headers: { authorization: 'Bearer secret-acme' },
    tls: { rejectUnauthorized: false }
  } as RequestInit)
}

describe('serving over tls', () => {
  let server: LangonrockServer | undefined

  afterAll(() => server?.stop(true))

  test('answers https and refuses the same request over http', async () => {
    server = serve({ root, hostname: '127.0.0.1', port: 0, tokens, tls })

    const body = await (
      await insecure(`https://127.0.0.1:${server.port}/v1/manifest`)
    ).text()

    expect(body).toContain('# tenant: acme')

    // Plaintext against a tls listener must not quietly succeed, which is what
    // would happen if the tls option were dropped somewhere on the way.
    await expect(
      fetch(`http://127.0.0.1:${server.port}/v1/manifest`, {
        headers: { authorization: 'Bearer secret-acme' }
      })
    ).rejects.toThrow()
  })

  test('a client that verifies certificates rejects this one', async () => {
    await expect(
      fetch(`https://127.0.0.1:${server?.port}/v1/manifest`, {
        headers: { authorization: 'Bearer secret-acme' }
      })
    ).rejects.toThrow()
  })
})

/**
 * A bearer token is only as private as the connection under it, so the address
 * the server binds decides whether cleartext is acceptable. Loopback and a
 * proxy in front are the two safe shapes, and both bind loopback.
 */
describe('binding refuses the shapes that leak a token', () => {
  test.each(['0.0.0.0', '::', 'example.internal'])(
    'refuses %p without tls',
    hostname => {
      expect(() => serve({ root, hostname, port: 0, tokens })).toThrow(
        'without tls'
      )
    }
  )

  test.each(['127.0.0.1', '::1', 'localhost'])(
    'allows cleartext on %p',
    async hostname => {
      const local = serve({ root, hostname, port: 0, tokens })

      expect(local.port).toBeGreaterThan(0)
      await local.stop(true)
    }
  )

  test('allows any address once tls is on', async () => {
    const exposed = serve({ root, hostname: '0.0.0.0', port: 0, tokens, tls })

    expect(exposed.port).toBeGreaterThan(0)
    await exposed.stop(true)
  })

  /**
   * With no unix socket and no address the defaults still bind TCP, and
   * deciding from whichever of port and hostname happened to be set left this
   * one case serving every tenant to any process that could reach the port.
   */
  test('refuses the bare call that used to bind tcp unauthenticated', () => {
    expect(() => serve({ root })).toThrow('without tokens')
  })

  test('a unix socket still needs neither tokens nor tls', async () => {
    if (process.platform === 'win32') {
      return
    }

    const socket = join(scratch, 'plain.sock')
    const local = serve({ root, unix: socket })

    expect(
      await (
        await fetch('http://langonrock/v1/acme/manifest', { unix: socket })
      ).text()
    ).toContain('# tenant: acme')

    await local.stop(true)
    await rm(socket, { force: true })
  })
})
