import {
  deleteBundle,
  deleteSource,
  hashOf,
  listSource,
  readSource,
  writeSource
} from '../store/source.ts'
import { HttpError } from './errors.ts'

/** A concept is prose. Anything this large is a mistake or an attack. */
export const MAX_BYTES = 1_000_000

export interface SourceContext {
  dir: string
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
function assertPrecondition(
  request: Request,
  current: string | undefined
): void {
  const ifNoneMatch = request.headers.get('if-none-match')

  if (ifNoneMatch === '*') {
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
 * an oversize body is a rare enough mistake to be worth reading and dropping.
 * The server caps the transport at the same number, so nothing unbounded is
 * ever buffered to get here.
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
    context.dir,
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

async function writeOne(
  request: Request,
  context: SourceContext
): Promise<Response> {
  assertWritable(context)

  const bundle = context.bundle ?? ''
  const path = context.path ?? ''

  assertPrecondition(request, await hashOf(context.dir, bundle, path))

  const hash = await writeSource(
    context.dir,
    bundle,
    path,
    await bodyOf(request)
  )

  return new Response(null, { status: 204, headers: { etag: quoted(hash) } })
}

async function deleteOne(
  request: Request,
  context: SourceContext
): Promise<Response> {
  assertWritable(context)

  const bundle = context.bundle ?? ''
  const path = context.path ?? ''
  const current = await hashOf(context.dir, bundle, path)

  if (current === undefined) {
    throw new HttpError(404, 'no such concept')
  }

  assertPrecondition(request, current)
  await deleteSource(context.dir, bundle, path)

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

    return Response.json(await listSource(context.dir))
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

  if (!(await deleteBundle(context.dir, context.bundle))) {
    throw new HttpError(404, 'no such bundle')
  }

  return new Response(null, { status: 204 })
}
