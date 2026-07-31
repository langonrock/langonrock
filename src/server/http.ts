import { createSearchCache } from '../search/cache.ts'
import { searchTenant } from '../search/tenant.ts'
import { createReaderCache } from '../store/cache.ts'

import type { SearchOptions, TenantIndex } from '../search/tenant.ts'
import type { TenantReader } from '../store/reader.ts'

export type LangonrockServer = ReturnType<typeof Bun.serve>

const VERBS = new Set(['manifest', 'get', 'snapshot', 'search'])

interface Resolved {
  reader: TenantReader
  index: () => Promise<TenantIndex>
}

export interface ServeOptions {
  root: string
  tokens?: Map<string, string>
  unix?: string
  hostname?: string
  port?: number
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

interface Route {
  tenant?: string
  verb: string
}

function route(pathname: string): Route | undefined {
  const parts = pathname.split('/').filter(part => part !== '')

  if (parts[0] !== 'v1') {
    return undefined
  }

  if (parts.length === 2 && VERBS.has(parts[1] ?? '')) {
    return { verb: parts[1] ?? '' }
  }

  if (parts.length === 3 && VERBS.has(parts[2] ?? '')) {
    return { tenant: parts[1] ?? '', verb: parts[2] ?? '' }
  }

  return undefined
}

function bearer(request: Request): string {
  const header = request.headers.get('authorization') ?? ''

  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

/**
 * The token decides the tenant. A tenant in the path is only ever a convenience
 * that must agree with the token, never a way to reach another tenant's data.
 */
function resolveTenant(
  request: Request,
  pathTenant: string | undefined,
  tokens: Map<string, string>
): string {
  if (tokens.size === 0) {
    if (pathTenant === undefined) {
      throw new HttpError(401, 'tenant required in path when no tokens exist')
    }

    return pathTenant
  }

  const tenant = tokens.get(bearer(request))

  if (tenant === undefined) {
    throw new HttpError(401, 'invalid or missing bearer token')
  }

  if (pathTenant !== undefined && pathTenant !== tenant) {
    throw new HttpError(403, 'token does not grant access to that tenant')
  }

  return tenant
}

function manifestResponse(
  request: Request,
  reader: TenantReader
): Promise<Response> | Response {
  const bundle = new URL(request.url).searchParams.get('bundle') ?? undefined
  const etag = `"${reader.snapshot}${bundle === undefined ? '' : `:${bundle}`}"`

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } })
  }

  return reader.manifest(bundle).then(
    body =>
      new Response(body, {
        headers: { etag, 'content-type': 'text/tab-separated-values' }
      })
  )
}

interface GetPayload {
  ids?: unknown
  section?: unknown
}

async function getResponse(
  request: Request,
  reader: TenantReader
): Promise<Response> {
  const payload = (await request.json().catch(() => ({}))) as GetPayload

  if (!Array.isArray(payload.ids)) {
    throw new HttpError(400, 'body must be {"ids": [...], "section"?: "..."}')
  }

  const ids = payload.ids.filter((id): id is string => typeof id === 'string')
  const section =
    typeof payload.section === 'string' ? payload.section : undefined
  const found = await reader.get(ids, section)

  return Response.json(Object.fromEntries(found))
}

interface SearchPayload {
  q?: unknown
  k?: unknown
  expand?: unknown
  bundle?: unknown
}

async function searchResponse(
  request: Request,
  resolved: Resolved
): Promise<Response> {
  const payload = (await request.json().catch(() => ({}))) as SearchPayload

  if (typeof payload.q !== 'string' || payload.q === '') {
    throw new HttpError(400, 'body must be {"q": "...", "k"?: n}')
  }

  const options: SearchOptions = {}

  if (typeof payload.k === 'number') {
    options.k = payload.k
  }

  if (typeof payload.expand === 'boolean') {
    options.expand = payload.expand
  }

  if (typeof payload.bundle === 'string') {
    options.bundle = payload.bundle
  }

  const body = searchTenant(await resolved.index(), payload.q, options)

  return new Response(body, {
    headers: { 'content-type': 'text/tab-separated-values' }
  })
}

async function dispatch(
  request: Request,
  verb: string,
  resolved: Resolved
): Promise<Response> {
  if (verb === 'snapshot') {
    return Response.json({
      snapshot: resolved.reader.snapshot,
      concepts: resolved.reader.ids.length
    })
  }

  if (verb === 'manifest') {
    return manifestResponse(request, resolved.reader)
  }

  if (request.method !== 'POST') {
    throw new HttpError(405, `${verb} requires POST`)
  }

  return verb === 'search'
    ? searchResponse(request, resolved)
    : getResponse(request, resolved.reader)
}

function toResponse(cause: unknown): Response {
  if (cause instanceof HttpError) {
    return new Response(cause.message, { status: cause.status })
  }

  const message = cause instanceof Error ? cause.message : String(cause)

  return new Response(message, { status: 404 })
}

/**
 * Binding to TCP without tokens would expose every tenant to any process that
 * can reach the port. A unix socket is already guarded by file permissions, so
 * it is the only transport allowed to run unauthenticated.
 */
export function serve(options: ServeOptions): LangonrockServer {
  const tokens = options.tokens ?? new Map<string, string>()
  const listensOnTcp =
    options.port !== undefined || options.hostname !== undefined

  if (listensOnTcp && tokens.size === 0) {
    throw new Error(
      'refusing to listen on TCP without tokens: pass tokens or use a unix socket'
    )
  }

  const cache = createReaderCache(options.root)
  const indexes = createSearchCache(options.root)
  const listener =
    options.unix === undefined
      ? {
          hostname: options.hostname ?? '127.0.0.1',
          port: options.port ?? 7777
        }
      : { unix: options.unix }

  return Bun.serve({
    ...listener,
    fetch: async request => {
      try {
        const matched = route(new URL(request.url).pathname)

        if (matched === undefined) {
          throw new HttpError(404, 'no such route')
        }

        const tenant = resolveTenant(request, matched.tenant, tokens)

        return await dispatch(request, matched.verb, {
          reader: await cache(tenant),
          index: () => indexes(tenant)
        })
      } catch (cause) {
        return toResponse(cause)
      }
    }
  })
}
