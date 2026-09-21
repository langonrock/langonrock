import { deleteBundle, listSource, readSource, transact } from '../db/api.ts'
import { ConflictError } from '../db/errors.ts'
import { assertHash, hash } from '../db/format.ts'
import { assertBundleName, assertConceptPath } from '../store/sourcepaths.ts'
import { requireWrite, validate } from './dbmsroutes.ts'
import { HttpError } from './errors.ts'
import { MAX_BYTES } from './sourceroutes.ts'
import { decodeText } from '../text.ts'

import type { DatabaseContext } from './dbmsroutes.ts'

interface SourceContext extends DatabaseContext {
  bundle?: string
  path?: string
}

function replaces(request: Request): string | undefined {
  if (request.headers.get('if-none-match') === '*') {
    return undefined
  }

  const header = request.headers.get('if-match')

  if (header === null) {
    throw new HttpError(
      428,
      'a write needs If-Match: "<hash>" to replace, or If-None-Match: * to create'
    )
  }

  const digest = header.replaceAll('"', '')

  validate(() => assertHash(digest))

  return digest
}

async function change(
  request: Request,
  context: SourceContext,
  document: { bundle: string; path: string }
): Promise<Response> {
  requireWrite(context)

  const previous = replaces(request)

  if (request.method === 'DELETE') {
    if (previous === undefined) {
      throw new HttpError(428, 'deleting needs If-Match: "<hash>"')
    }

    await context.authorize(false)
    await transact(context.target, {
      changes: [{ operation: 'delete', ...document, replaces: previous }]
    })

    return new Response(null, { status: 204 })
  }

  const bytes = await request.arrayBuffer()

  if (bytes.byteLength > MAX_BYTES) {
    throw new HttpError(413, `a concept may not exceed ${MAX_BYTES} bytes`)
  }

  const content = validate(() => decodeText(bytes))

  await context.authorize(previous === undefined)
  await transact(context.target, {
    changes: [
      {
        operation: 'write',
        ...document,
        content,
        ...(previous === undefined ? {} : { replaces: previous })
      }
    ]
  })

  return new Response(null, {
    status: 204,
    headers: { etag: `"${hash(content)}"` }
  })
}

export async function databaseSource(
  request: Request,
  context: SourceContext
): Promise<Response> {
  if (context.bundle === undefined) {
    if (request.method !== 'GET') {
      throw new HttpError(405, 'the source listing is read only')
    }

    return Response.json(await listSource(context.target))
  }

  const bundle = validate(() => assertBundleName(context.bundle ?? ''))
  const path = validate(() => assertConceptPath(context.path ?? ''))

  if (request.method === 'GET') {
    const file = await readSource(context.target, bundle, path)

    if (file === undefined) {
      throw new HttpError(404, 'no such concept')
    }

    return new Response(file.content, {
      headers: {
        etag: `"${file.hash}"`,
        'content-type': 'text/markdown; charset=utf-8'
      }
    })
  }

  if (request.method !== 'PUT' && request.method !== 'DELETE') {
    throw new HttpError(405, `${request.method} is not allowed on a concept`)
  }

  try {
    return await change(request, context, { bundle, path })
  } catch (cause) {
    if (cause instanceof ConflictError) {
      throw new HttpError(412, cause.message)
    }

    throw cause
  }
}

export async function databaseBundle(
  request: Request,
  context: SourceContext
): Promise<Response> {
  requireWrite(context)

  if (request.method !== 'DELETE') {
    throw new HttpError(405, 'only DELETE is allowed on a bundle')
  }

  const bundle = validate(() => assertBundleName(context.bundle ?? ''))

  await context.authorize(false)

  if (!(await deleteBundle(context.target, bundle))) {
    throw new HttpError(404, 'no such bundle')
  }

  return new Response(null, { status: 204 })
}
