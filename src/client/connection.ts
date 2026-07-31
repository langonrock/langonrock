import { createSearchCache } from '../search/cache.ts'
import { searchTenant } from '../search/tenant.ts'
import { createReaderCache } from '../store/cache.ts'
import { resolveDataDir } from '../store/datadir.ts'
import { parseDsn } from './dsn.ts'

import type { SearchOptions } from '../search/tenant.ts'
import type { Target, Transport } from './dsn.ts'

export interface Connection {
  readonly transport: Transport
  snapshot: () => Promise<string>
  manifest: (bundle?: string) => Promise<string>
  get: (ids: string[], section?: string) => Promise<Map<string, string>>
  search: (query: string, options?: SearchOptions) => Promise<string>
  close: () => Promise<void>
}

const NPIPE_UNSUPPORTED =
  'npipe transport is unavailable: Bun.serve has no Windows named pipe support. ' +
  'On Windows run the daemon on loopback TCP and connect with okf+http://127.0.0.1:PORT?token=...'

function required(value: string | undefined, message: string): string {
  if (value === undefined) {
    throw new Error(message)
  }

  return value
}

function embeddedConnection(target: Target): Connection {
  // An embedded dsn with no path means the default store, so `okf://?tenant=x`
  // works the same way `--data` being absent does.
  const root = resolveDataDir(target.path)
  const tenant = required(target.tenant, 'embedded dsn needs ?tenant=')
  const cache = createReaderCache(root)
  const indexes = createSearchCache(root)

  return {
    transport: 'embedded',
    snapshot: async () => (await cache(tenant)).snapshot,
    manifest: async bundle => (await cache(tenant)).manifest(bundle),
    get: async (ids, section) => (await cache(tenant)).get(ids, section),
    search: async (query, options) =>
      searchTenant(await indexes(tenant), query, options ?? {}),
    close: async () => undefined
  }
}

type Call = (path: string, init?: RequestInit) => Promise<Response>

function makeCall(target: Target): Call {
  const origin = target.origin ?? 'http://langonrock'
  const auth =
    target.token === undefined
      ? {}
      : { authorization: `Bearer ${target.token}` }
  const socket = target.transport === 'unix' ? { unix: target.path } : {}

  return (path, init = {}) =>
    fetch(`${origin}${path}`, {
      ...init,
      ...socket,
      headers: { ...auth, ...(init.headers as Record<string, string>) }
    })
}

async function assertOk(response: Response): Promise<Response> {
  if (response.ok) {
    return response
  }

  throw new Error(
    `langonrock server returned ${response.status}: ${(await response.text()).trim()}`
  )
}

interface Cached {
  etag: string | undefined
  body: string
}

function remoteConnection(target: Target): Connection {
  const call = makeCall(target)
  const prefix = target.tenant === undefined ? '/v1' : `/v1/${target.tenant}`
  // Keyed by bundle: a filtered manifest and the whole one are different
  // documents, and reusing one etag for both would serve the wrong bytes.
  const cache = new Map<string, Cached>()

  const manifest = async (bundle?: string): Promise<string> => {
    const key = bundle ?? ''
    const previous = cache.get(key)
    const query =
      bundle === undefined ? '' : `?bundle=${encodeURIComponent(bundle)}`
    const headers =
      previous?.etag === undefined ? {} : { 'if-none-match': previous.etag }
    const response = await call(`${prefix}/manifest${query}`, { headers })

    if (response.status === 304 && previous !== undefined) {
      return previous.body
    }

    await assertOk(response)

    const body = await response.text()

    cache.set(key, {
      etag: response.headers.get('etag') ?? undefined,
      body
    })

    return body
  }

  return {
    transport: target.transport,
    snapshot: snapshotOf(call, prefix),
    manifest,
    get: getOf(call, prefix),
    search: searchOf(call, prefix),
    close: async () => undefined
  }
}

function searchOf(
  call: Call,
  prefix: string
): (query: string, options?: SearchOptions) => Promise<string> {
  return async (query, options = {}) => {
    const response = await assertOk(
      await call(`${prefix}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: query, ...options })
      })
    )

    return response.text()
  }
}

function snapshotOf(call: Call, prefix: string): () => Promise<string> {
  return async () => {
    const response = await assertOk(await call(`${prefix}/snapshot`))
    const body = (await response.json()) as { snapshot: string }

    return body.snapshot
  }
}

function getOf(
  call: Call,
  prefix: string
): (ids: string[], section?: string) => Promise<Map<string, string>> {
  return async (ids, section) => {
    const payload = section === undefined ? { ids } : { ids, section }
    const response = await assertOk(
      await call(`${prefix}/get`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      })
    )
    const body = (await response.json()) as Record<string, string>

    return new Map(Object.entries(body))
  }
}

/**
 * One interface across every transport. Develop against a local directory,
 * deploy against a remote server, and the calling code does not change.
 */
export function open(dsn: string): Connection {
  const target = parseDsn(dsn)

  if (target.transport === 'npipe') {
    throw new Error(NPIPE_UNSUPPORTED)
  }

  return target.transport === 'embedded'
    ? embeddedConnection(target)
    : remoteConnection(target)
}
