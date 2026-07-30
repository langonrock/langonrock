import { createReaderCache } from '../store/cache.ts'

import type { TenantReader } from '../store/reader.ts'

export type LangonrockServer = ReturnType<typeof Bun.serve>

const VERBS = new Set(['manifest', 'get', 'snapshot'])

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
  const etag = `"${reader.snapshot}"`

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } })
  }

  return reader.manifest().then(
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

async function dispatch(
  request: Request,
  reader: TenantReader,
  verb: string
): Promise<Response> {
  if (verb === 'snapshot') {
    return Response.json({
      snapshot: reader.snapshot,
      concepts: reader.ids.length
    })
  }

  if (verb === 'manifest') {
    return manifestResponse(request, reader)
  }

  if (request.method !== 'POST') {
    throw new HttpError(405, 'get requires POST')
  }

  return getResponse(request, reader)
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

        return await dispatch(request, await cache(tenant), matched.verb)
      } catch (cause) {
        return toResponse(cause)
      }
    }
  })
}
