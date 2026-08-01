import { createSearchCache } from '../search/cache.ts'
import { searchTenant } from '../search/tenant.ts'
import { createReaderCache } from '../store/cache.ts'
import { HttpError } from './errors.ts'
import {
  MAX_UPLOAD_BYTES,
  bundlesResponse,
  sourceResponse
} from './sourceroutes.ts'

import type { SearchCache } from '../search/cache.ts'
import type { SearchOptions, TenantIndex } from '../search/tenant.ts'
import type { TenantReader } from '../store/reader.ts'
import type { PutResult } from '../store/writer.ts'
import type { Grant } from './tokens.ts'

export type LangonrockServer = ReturnType<typeof Bun.serve>

const READ_VERBS = new Set(['manifest', 'get', 'snapshot', 'search'])

const WRITE_VERBS = new Set(['source', 'bundles', 'sync'])

const VERBS = new Set([...READ_VERBS, ...WRITE_VERBS])

const DEFAULT_HOSTNAME = '127.0.0.1'

const DEFAULT_PORT = 7777

/** Addresses no other machine can reach, so a token on them stays local. */
const LOOPBACK = new Set([DEFAULT_HOSTNAME, '::1', 'localhost'])

interface Resolved {
  reader: TenantReader
  index: () => Promise<TenantIndex>
}

/** PEM contents, not paths, so this module never touches the filesystem. */
export interface Tls {
  cert: string
  key: string
}

export interface ServeOptions {
  root: string
  tokens?: Map<string, Grant>
  /** Tenant to the directory holding its OKF Markdown. Absent means read only. */
  sources?: Map<string, string>
  /** Recompiles a tenant now, so a client can make its write visible. */
  sync?: (tenant: string) => Promise<PutResult>
  /**
   * Share the search cache with the caller, so a watcher can rebuild an index
   * right after a sync instead of leaving the cost on the first search.
   */
  indexes?: SearchCache
  unix?: string
  hostname?: string
  port?: number
  /** Absent serves plain HTTP, which is only allowed on loopback. */
  tls?: Tls
}

interface Route {
  tenant?: string
  verb: string
  bundle?: string
  path?: string
}

function toRoute(parts: string[], tenant?: string): Route | undefined {
  const [verb, ...rest] = parts

  if (verb === undefined || !VERBS.has(verb)) {
    return undefined
  }

  const route: Route = tenant === undefined ? { verb } : { tenant, verb }

  if (verb !== 'source' && verb !== 'bundles') {
    return rest.length === 0 ? route : undefined
  }

  const [bundle, ...segments] = rest

  if (bundle !== undefined) {
    route.bundle = bundle
  }

  if (segments.length > 0) {
    route.path = segments.join('/')
  }

  return route
}

function route(pathname: string): Route | undefined {
  const parts = pathname
    .split('/')
    .filter(part => part !== '')
    .map(part => decodeURIComponent(part))

  if (parts[0] !== 'v1') {
    return undefined
  }

  const rest = parts.slice(1)

  return VERBS.has(rest[0] ?? '')
    ? toRoute(rest)
    : toRoute(rest.slice(1), rest[0])
}

function bearer(request: Request): string {
  const header = request.headers.get('authorization') ?? ''

  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

interface Access {
  tenant: string
  write: boolean
}

/**
 * The token decides the tenant. A tenant in the path is only ever a convenience
 * that must agree with the token, never a way to reach another tenant's data.
 *
 * With no tokens the server is on a unix socket, where file permissions already
 * decide who may connect, so that caller may write. Over TCP a write needs a
 * token that says so.
 */
function resolveAccess(
  request: Request,
  pathTenant: string | undefined,
  tokens: Map<string, Grant>
): Access {
  if (tokens.size === 0) {
    if (pathTenant === undefined) {
      throw new HttpError(401, 'tenant required in path when no tokens exist')
    }

    return { tenant: pathTenant, write: true }
  }

  const grant = tokens.get(bearer(request))

  if (grant === undefined) {
    throw new HttpError(401, 'invalid or missing bearer token')
  }

  if (pathTenant !== undefined && pathTenant !== grant.tenant) {
    throw new HttpError(403, 'token does not grant access to that tenant')
  }

  return { tenant: grant.tenant, write: grant.write }
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

/**
 * A rejection that never read the body — a bad precondition, a token without
 * write scope, a path that would escape the bundle — leaves those bytes on the
 * socket, where the next request over that keep-alive connection reads them as
 * its own headers and hangs instead of being told what went wrong.
 */
async function toResponse(request: Request, cause: unknown): Promise<Response> {
  if (!request.bodyUsed) {
    await request.body?.cancel().catch(() => undefined)
  }

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
/**
 * Write routes never touch the reader. A tenant whose first concept is being
 * created has no snapshot yet, and opening one would fail before the write ever
 * happened.
 */
async function dispatchWrite(
  request: Request,
  matched: Route,
  access: Access,
  options: ServeOptions
): Promise<Response> {
  const dir = options.sources?.get(access.tenant)

  if (dir === undefined) {
    throw new HttpError(
      409,
      `tenant "${access.tenant}" has no source directory: add it to sources.json to make it writable`
    )
  }

  if (matched.verb === 'sync') {
    if (options.sync === undefined) {
      throw new HttpError(409, 'this server cannot recompile on request')
    }

    const result = await options.sync(access.tenant)

    return Response.json({
      snapshot: result.snapshot,
      concepts: result.concepts,
      bundles: result.bundles,
      diagnostics: result.diagnostics
    })
  }

  const context = {
    dir,
    write: access.write,
    bundle: matched.bundle,
    path: matched.path
  }

  return matched.verb === 'bundles'
    ? bundlesResponse(request, context)
    : sourceResponse(request, context)
}

/**
 * Read from `unix` rather than from `port` and `hostname`: with all three
 * absent this still binds TCP on the defaults, and deciding from the ones that
 * happen to be set left that case unguarded.
 */
function listensOnTcp(options: ServeOptions): boolean {
  return options.unix === undefined
}

/**
 * A unix socket is guarded by file permissions, so it is the only transport
 * allowed to run unauthenticated. Over TCP a token is the only thing standing
 * between a caller and someone else's knowledge, and it is only as private as
 * the connection carrying it. Loopback keeps it on the machine and a proxy
 * terminating tls in front binds loopback too, so both stay allowed. Any other
 * address in cleartext puts the token on the wire for whoever is in the path.
 */
function assertSafeToBind(
  options: ServeOptions,
  tokens: Map<string, Grant>
): void {
  if (!listensOnTcp(options)) {
    return
  }

  if (tokens.size === 0) {
    throw new Error(
      'refusing to listen on TCP without tokens: pass tokens or use a unix socket'
    )
  }

  const hostname = options.hostname ?? DEFAULT_HOSTNAME

  if (options.tls === undefined && !LOOPBACK.has(hostname)) {
    throw new Error(
      `refusing to serve ${hostname} without tls: every request would carry ` +
        'its token in cleartext. Pass tls, or bind 127.0.0.1 and terminate ' +
        'tls in a proxy in front'
    )
  }
}

function listenerFor(options: ServeOptions): Record<string, unknown> {
  if (!listensOnTcp(options)) {
    return { unix: options.unix }
  }

  const listener: Record<string, unknown> = {
    hostname: options.hostname ?? DEFAULT_HOSTNAME,
    port: options.port ?? DEFAULT_PORT
  }

  if (options.tls !== undefined) {
    listener.tls = options.tls
  }

  return listener
}

export function serve(options: ServeOptions): LangonrockServer {
  const tokens = options.tokens ?? new Map<string, Grant>()

  assertSafeToBind(options, tokens)

  const cache = createReaderCache(options.root)
  const indexes = options.indexes ?? createSearchCache(options.root)

  return Bun.serve({
    ...listenerFor(options),
    // A backstop against something absurd, not the concept limit. The route
    // reads the body and answers 413 itself, which keeps the status and the
    // message the same everywhere and leaves nothing unread on the socket.
    maxRequestBodySize: MAX_UPLOAD_BYTES,
    fetch: async request => {
      try {
        const matched = route(new URL(request.url).pathname)

        if (matched === undefined) {
          throw new HttpError(404, 'no such route')
        }

        const access = resolveAccess(request, matched.tenant, tokens)

        if (WRITE_VERBS.has(matched.verb)) {
          return await dispatchWrite(request, matched, access, options)
        }

        return await dispatch(request, matched.verb, {
          reader: await cache(access.tenant),
          index: () => indexes(access.tenant)
        })
      } catch (cause) {
        return await toResponse(request, cause)
      }
    }
  })
}
