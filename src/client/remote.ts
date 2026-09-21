import { assertSourceText, decodeText } from '../text.ts'

import type {
  ConceptSlice,
  DatabaseConnection,
  GetOptions,
  SearchOptions,
  SourceEntry,
  SyncResult,
  TransactionRequest,
  HistoryOptions,
  RestoreRequest,
  RevisionResult,
  RevisionPage
} from '../types.ts'
import type { Target } from './dsn.ts'

/**
 * Everything here is `fetch` and string handling, with no import that reaches
 * the filesystem. That is what lets an editor built on Node, Electron, Tauri or
 * a browser talk to a langonrock server without shipping the store or Bun.
 */
type Call = (path: string, init?: RequestInit) => Promise<Response>

interface Cached {
  etag: string | undefined
  body: string
}

function makeCall(target: Target): Call {
  const origin = target.origin ?? 'http://langonrock'
  const auth =
    target.token === undefined
      ? {}
      : { authorization: `Bearer ${target.token}` }
  // `unix` is a Bun and Node fetch extension. Elsewhere it is ignored, which is
  // correct: a browser has no unix socket to reach anyway.
  const socket = target.transport === 'unix' ? { unix: target.path } : {}

  return (path, init = {}) =>
    fetch(`${origin}${path}`, {
      ...init,
      ...socket,
      headers: { ...auth, ...(init.headers as Record<string, string>) }
    } as RequestInit)
}

function errorDetails(body: string): { code?: unknown; revision?: unknown } {
  try {
    const value = JSON.parse(body) as unknown

    return typeof value === 'object' && value !== null ? value : {}
  } catch {
    return {}
  }
}

async function assertOk(response: Response): Promise<Response> {
  if (response.ok) {
    return response
  }

  const body = (await response.text()).trim()
  const failure = new Error(
    `langonrock server returned ${response.status}: ${body}`
  )

  if (response.headers.get('content-type')?.includes('application/json')) {
    const details = errorDetails(body)

    if (typeof details.code === 'string') {
      Object.assign(failure, { code: details.code })
    }

    if (typeof details.revision === 'string') {
      Object.assign(failure, { revision: details.revision })
    }
  }

  throw failure
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

function manifestOf(call: Call, prefix: string) {
  // Keyed by bundle: a filtered manifest and the whole one are different
  // documents, and reusing one etag for both would serve the wrong bytes.
  const cache = new Map<string, Cached>()

  return async (bundle?: string): Promise<string> => {
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

    cache.set(key, { etag: response.headers.get('etag') ?? undefined, body })

    return body
  }
}

function readingOf(call: Call, prefix: string) {
  return {
    snapshot: async (): Promise<string> => {
      const response = await assertOk(await call(`${prefix}/snapshot`))
      const body = (await response.json()) as { snapshot: string }

      return body.snapshot
    },
    get: async (
      ids: string[],
      options: GetOptions = {}
    ): Promise<Map<string, ConceptSlice>> => {
      const response = await assertOk(
        await call(`${prefix}/get`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids, ...options })
        })
      )

      return new Map(
        Object.entries((await response.json()) as Record<string, ConceptSlice>)
      )
    },
    search: async (
      query: string,
      options: SearchOptions = {}
    ): Promise<string> => {
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
}

function writingOf(call: Call, prefix: string) {
  return {
    listSource: async (): Promise<SourceEntry[]> => {
      const response = await assertOk(await call(`${prefix}/source`))

      return (await response.json()) as SourceEntry[]
    },
    readSource: async (bundle: string, path: string) => {
      const response = await call(`${prefix}/source/${segments(bundle, path)}`)

      if (response.status === 404) {
        return undefined
      }

      await assertOk(response)

      return {
        content: decodeText(await response.arrayBuffer()),
        hash: unquote(response.headers.get('etag'))
      }
    },
    writeSource: async (
      bundle: string,
      path: string,
      content: string,
      replaces?: string
    ): Promise<string> => {
      assertSourceText(content)

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
    deleteSource: async (
      bundle: string,
      path: string,
      replaces: string
    ): Promise<void> => {
      await assertOk(
        await call(`${prefix}/source/${segments(bundle, path)}`, {
          method: 'DELETE',
          headers: preconditionOf(replaces)
        })
      )
    },
    deleteBundle: async (bundle: string): Promise<void> => {
      await assertOk(
        await call(`${prefix}/bundles/${encodeURIComponent(bundle)}`, {
          method: 'DELETE'
        })
      )
    },
    sync: async (): Promise<SyncResult> => {
      const response = await assertOk(
        await call(`${prefix}/sync`, { method: 'POST' })
      )

      return (await response.json()) as SyncResult
    }
  }
}

function databaseOf(call: Call, prefix: string) {
  const post = async (verb: string, body: unknown): Promise<RevisionResult> => {
    const response = await assertOk(
      await call(`${prefix}/${verb}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
    )

    return (await response.json()) as RevisionResult
  }

  return {
    transact: (request: TransactionRequest) => post('transact', request),
    restore: (request: RestoreRequest) => post('restore', request),
    history: async (options: HistoryOptions = {}): Promise<RevisionPage> => {
      const query = new URLSearchParams()

      if (options.before !== undefined) {
        query.set('before', options.before)
      }

      if (options.limit !== undefined) {
        query.set('limit', String(options.limit))
      }

      const response = await assertOk(await call(`${prefix}/history?${query}`))

      return (await response.json()) as RevisionPage
    }
  }
}

export function remoteConnection(target: Target): DatabaseConnection {
  const call = makeCall(target)
  const prefix = target.tenant === undefined ? '/v1' : `/v1/${target.tenant}`

  return {
    transport: target.transport,
    manifest: manifestOf(call, prefix),
    ...readingOf(call, prefix),
    ...writingOf(call, prefix),
    ...databaseOf(call, prefix),
    close: async () => undefined
  }
}
