import { createSearchCache } from '../search/cache.ts'
import { searchTenant } from '../search/tenant.ts'
import { loadSources } from '../server/sources.ts'
import { createReaderCache } from '../store/cache.ts'
import { resolveDataDir } from '../store/datadir.ts'
import {
  deleteBundle,
  deleteSource,
  hashOf,
  listSource,
  readSource,
  writeSource
} from '../store/source.ts'
import { putTenantRoot } from '../store/writer.ts'
import { parseDsn } from './dsn.ts'

import type { SearchOptions } from '../search/tenant.ts'
import type { SourceEntry, SourceFile } from '../store/source.ts'
import type { Target, Transport } from './dsn.ts'

export interface SyncResult {
  snapshot: string
  concepts: number
  bundles: string[]
}

/**
 * The same four verbs for reading, plus the source side an editor needs. A
 * write names the version it replaces, or nothing at all to create, so losing
 * someone else's edit takes deliberate effort rather than a forgotten header.
 */
export interface Connection {
  readonly transport: Transport
  snapshot: () => Promise<string>
  manifest: (bundle?: string) => Promise<string>
  get: (ids: string[], section?: string) => Promise<Map<string, string>>
  search: (query: string, options?: SearchOptions) => Promise<string>
  listSource: () => Promise<SourceEntry[]>
  readSource: (bundle: string, path: string) => Promise<SourceFile | undefined>
  writeSource: (
    bundle: string,
    path: string,
    content: string,
    replaces?: string
  ) => Promise<string>
  deleteSource: (
    bundle: string,
    path: string,
    replaces: string
  ) => Promise<void>
  deleteBundle: (bundle: string) => Promise<void>
  sync: () => Promise<SyncResult>
  close: () => Promise<void>
}

function conflict(what: string): Error {
  return new Error(`${what}: re-read the concept and retry with its new hash`)
}

/**
 * Embedded and remote enforce the same rule. If only the server checked, an
 * editor developed against a local path would lose edits the moment it was
 * pointed at a server, which is exactly the bug this is meant to prevent.
 */
function assertReplaces(current: string | undefined, replaces?: string): void {
  if (replaces === undefined) {
    if (current !== undefined) {
      throw conflict('concept already exists')
    }

    return
  }

  if (current === undefined) {
    throw conflict('concept does not exist')
  }

  if (current !== replaces) {
    throw conflict('concept changed since it was read')
  }
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

  const sourceDir = async (): Promise<string> => {
    const dir = (await loadSources(root)).get(tenant)

    if (dir === undefined) {
      throw new Error(
        `tenant "${tenant}" has no source directory: add it to ${root}/sources.json to make it writable`
      )
    }

    return dir
  }

  return {
    transport: 'embedded',
    snapshot: async () => (await cache(tenant)).snapshot,
    manifest: async bundle => (await cache(tenant)).manifest(bundle),
    get: async (ids, section) => (await cache(tenant)).get(ids, section),
    search: async (query, options) =>
      searchTenant(await indexes(tenant), query, options ?? {}),
    listSource: async () => listSource(await sourceDir()),
    readSource: async (bundle, path) =>
      readSource(await sourceDir(), bundle, path),
    writeSource: async (bundle, path, content, replaces) => {
      const dir = await sourceDir()

      assertReplaces(await hashOf(dir, bundle, path), replaces)

      return writeSource(dir, bundle, path, content)
    },
    deleteSource: async (bundle, path, replaces) => {
      const dir = await sourceDir()

      assertReplaces(await hashOf(dir, bundle, path), replaces)
      await deleteSource(dir, bundle, path)
    },
    deleteBundle: async bundle => {
      await deleteBundle(await sourceDir(), bundle)
    },
    sync: async () => {
      const result = await putTenantRoot(await sourceDir(), { root, tenant })

      return {
        snapshot: result.snapshot,
        concepts: result.concepts,
        bundles: result.bundles
      }
    },
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
    ...sourceOf(call, prefix),
    close: async () => undefined
  }
}

function segments(bundle: string, path: string): string {
  return [bundle, ...path.split('/')]
    .map(part => encodeURIComponent(part))
    .join('/')
}

function unquote(etag: string | null): string {
  return (etag ?? '').replaceAll('"', '')
}

/**
 * `replaces` becomes the precondition the server demands: its hash to overwrite
 * a concept, or `*` to insist the concept is new.
 */
function preconditionOf(replaces?: string): Record<string, string> {
  return replaces === undefined
    ? { 'if-none-match': '*' }
    : { 'if-match': `"${replaces}"` }
}

type SourceMethods = Pick<
  Connection,
  | 'listSource'
  | 'readSource'
  | 'writeSource'
  | 'deleteSource'
  | 'deleteBundle'
  | 'sync'
>

function sourceOf(call: Call, prefix: string): SourceMethods {
  return {
    listSource: async () => {
      const response = await assertOk(await call(`${prefix}/source`))

      return (await response.json()) as SourceEntry[]
    },
    readSource: async (bundle, path) => {
      const response = await call(`${prefix}/source/${segments(bundle, path)}`)

      if (response.status === 404) {
        return undefined
      }

      await assertOk(response)

      return {
        content: await response.text(),
        hash: unquote(response.headers.get('etag'))
      }
    },
    writeSource: async (bundle, path, content, replaces) => {
      const response = await assertOk(
        await call(`${prefix}/source/${segments(bundle, path)}`, {
          method: 'PUT',
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            ...preconditionOf(replaces)
          },
          body: content
        })
      )

      return unquote(response.headers.get('etag'))
    },
    deleteSource: async (bundle, path, replaces) => {
      await assertOk(
        await call(`${prefix}/source/${segments(bundle, path)}`, {
          method: 'DELETE',
          headers: preconditionOf(replaces)
        })
      )
    },
    deleteBundle: async bundle => {
      await assertOk(
        await call(`${prefix}/bundles/${encodeURIComponent(bundle)}`, {
          method: 'DELETE'
        })
      )
    },
    sync: async () => {
      const response = await assertOk(
        await call(`${prefix}/sync`, { method: 'POST' })
      )

      return (await response.json()) as SyncResult
    }
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
