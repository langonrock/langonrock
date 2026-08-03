import {
  deleteBundle,
  deleteSource,
  hashOf,
  listSource,
  readSource,
  writeSource
} from '../store/source.ts'
import { assertBundleName, assertConceptPath } from '../store/sourcepaths.ts'
import { HttpError } from './errors.ts'

/** A concept is prose. Anything this large is a mistake or an attack. */
export const MAX_BYTES = 1_000_000

/**
 * What the transport will hold before refusing, deliberately well above the
 * concept limit. The two do different jobs: this one bounds memory, and the
 * one above states a rule about concepts. Keeping them apart means an
 * ordinary oversize write is answered by the check below, with the same
 * status and the same message on every platform, rather than by whatever the
 * runtime happens to do when a body outgrows its own cap.
 */
export const MAX_UPLOAD_BYTES = MAX_BYTES * 8

export interface SourceContext {
  /**
   * Resolved late, and with `create` only from the one call that has already
   * validated everything else, so a refused write leaves no tenant behind.
   */
  dir: (create: boolean) => Promise<string>
  write: boolean
  bundle: string | undefined
  path: string | undefined
}

function assertWritable(context: SourceContext): void {
  if (!context.write) {
    throw new HttpError(403, 'this token may read but not write')
  }
}

function quoted(hash: string): string {
  return `"${hash}"`
}

/**
 * A write must say which version it replaces. Without that, two editors saving
 * the same concept silently lose one of the edits, and no status code ever
 * reveals it. Requiring the header makes the unsafe call impossible rather than
 * merely discouraged, which is the same choice the server makes by refusing to
 * bind TCP without tokens.
 */
/**
 * `If-None-Match: *` is the write that asserts its concept is new. It is also
 * the only write that may bring a tenant into existence, which is why the
 * question is asked once and answered here rather than from the method.
 */
function creates(request: Request): boolean {
  return request.headers.get('if-none-match') === '*'
}

function assertPrecondition(
  request: Request,
  current: string | undefined
): void {
  if (creates(request)) {
    if (current !== undefined) {
      throw new HttpError(412, 'concept already exists')
    }

    return
  }

  const ifMatch = request.headers.get('if-match')

  if (ifMatch === null) {
    throw new HttpError(
      428,
      'a write needs If-Match: "<hash>" to replace, or If-None-Match: * to create'
    )
  }

  if (current === undefined) {
    throw new HttpError(412, 'concept does not exist')
  }

  if (ifMatch.replaceAll('"', '') !== current) {
    throw new HttpError(412, 'concept changed since it was read')
  }
}

/**
 * The size is checked after reading, not from `content-length` before it.
 * Answering while the body is still arriving leaves it on a keep-alive
 * connection, where the next request reads it as its own headers and hangs, and
 * an oversize write is a rare enough mistake to be worth reading and dropping.
 * `MAX_UPLOAD_BYTES` keeps what gets buffered here bounded.
 */
async function bodyOf(request: Request): Promise<string> {
  const content = await request.text()

  if (Buffer.byteLength(content) > MAX_BYTES) {
    throw new HttpError(413, `a concept may not exceed ${MAX_BYTES} bytes`)
  }

  return content
}

async function readOne(context: SourceContext): Promise<Response> {
  const found = await readSource(
    await context.dir(false),
    context.bundle ?? '',
    context.path ?? ''
  )

  if (found === undefined) {
    throw new HttpError(404, 'no such concept')
  }

  return new Response(found.content, {
    headers: {
      etag: quoted(found.hash),
      'content-type': 'text/markdown; charset=utf-8'
    }
  })
}

/**
 * Everything that can refuse this write is settled before the directory is
 * resolved: the token's scope, the shape of the path, and the size of the body.
 * Only then may a tenant be created, so a refusal never leaves one behind.
 */
async function writeOne(
  request: Request,
  context: SourceContext
): Promise<Response> {
  assertWritable(context)

  const bundle = assertBundleName(context.bundle ?? '')
  const path = assertConceptPath(context.path ?? '')
  const content = await bodyOf(request)
  const dir = await context.dir(creates(request))

  assertPrecondition(request, await hashOf(dir, bundle, path))

  const hash = await writeSource(dir, bundle, path, content)

  return new Response(null, { status: 204, headers: { etag: quoted(hash) } })
}

async function deleteOne(
  request: Request,
  context: SourceContext
): Promise<Response> {
  assertWritable(context)

  const dir = await context.dir(false)
  const bundle = context.bundle ?? ''
  const path = context.path ?? ''
  const current = await hashOf(dir, bundle, path)

  if (current === undefined) {
    throw new HttpError(404, 'no such concept')
  }

  assertPrecondition(request, current)
  await deleteSource(dir, bundle, path)

  return new Response(null, { status: 204 })
}

export async function sourceResponse(
  request: Request,
  context: SourceContext
): Promise<Response> {
  if (context.bundle === undefined) {
    if (request.method !== 'GET') {
      throw new HttpError(405, 'the source listing is read only')
    }

    return Response.json(await listSource(await context.dir(false)))
  }

  if (context.path === undefined || context.path === '') {
    throw new HttpError(400, 'a concept path is required')
  }

  if (request.method === 'GET') {
    return readOne(context)
  }

  if (request.method === 'PUT') {
    return writeOne(request, context)
  }

  if (request.method === 'DELETE') {
    return deleteOne(request, context)
  }

  throw new HttpError(405, `${request.method} is not allowed on a concept`)
}

/**
 * Removing a bundle is a directory removal, the mirror of creating one by
 * writing the first file into it. It carries no precondition: the previous
 * snapshot still holds every concept until the collector runs, so a mistake is
 * recoverable from the store's own history.
 */
export async function bundlesResponse(
  request: Request,
  context: SourceContext
): Promise<Response> {
  assertWritable(context)

  if (request.method !== 'DELETE') {
    throw new HttpError(405, 'only DELETE is allowed on a bundle')
  }

  if (context.bundle === undefined) {
    throw new HttpError(400, 'a bundle name is required')
  }

  if (!(await deleteBundle(await context.dir(false), context.bundle))) {
    throw new HttpError(404, 'no such bundle')
  }

  return new Response(null, { status: 204 })
}
