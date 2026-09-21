import { requireNative, sync, transact } from '../db/api.ts'
import { validateRequest } from '../db/changes.ts'
import { assertHash } from '../db/format.ts'
import { history } from '../db/history.ts'
import { restore } from '../db/restore.ts'
import { HttpError } from './errors.ts'

import type { DatabaseTarget } from '../db/types.ts'
import type {
  HistoryOptions,
  RestoreRequest,
  TransactionRequest
} from '../types.ts'

export interface DatabaseContext {
  target: DatabaseTarget
  write: boolean
  authorize: (create: boolean) => Promise<void>
}

export function requireWrite(context: DatabaseContext): void {
  if (!context.write) {
    throw new HttpError(403, 'this token may read but not write')
  }
}

export function validate<T>(action: () => T): T {
  try {
    return action()
  } catch (cause) {
    throw new HttpError(
      400,
      cause instanceof Error ? cause.message : String(cause)
    )
  }
}

async function json(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new HttpError(400, 'body must be valid JSON')
  }
}

async function historyResponse(
  request: Request,
  target: DatabaseTarget
): Promise<Response> {
  if (request.method !== 'GET') {
    throw new HttpError(405, 'history requires GET')
  }

  const params = new URL(request.url).searchParams
  const options: HistoryOptions = {}

  if (params.has('before')) {
    options.before = params.get('before') ?? ''
  }

  if (params.has('limit')) {
    options.limit = Number(params.get('limit'))

    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 100
    ) {
      throw new HttpError(400, 'history limit must be an integer from 1 to 100')
    }
  }

  await requireNative(target)

  return Response.json(await history(target, options))
}

function restoreRequest(value: unknown): RestoreRequest {
  if (
    !value ||
    typeof value !== 'object' ||
    !('revision' in value) ||
    !('expectedRevision' in value) ||
    'tenant' in value
  ) {
    throw new Error(
      'restore needs revision and expectedRevision in the connected tenant'
    )
  }

  assertHash(value.revision)
  assertHash(value.expectedRevision)

  return {
    revision: value.revision,
    expectedRevision: value.expectedRevision
  }
}

export async function databaseResponse(
  request: Request,
  verb: string,
  context: DatabaseContext
): Promise<Response> {
  if (verb === 'history') {
    return historyResponse(request, context.target)
  }

  requireWrite(context)

  if (request.method !== 'POST') {
    throw new HttpError(405, `${verb} requires POST`)
  }

  if (verb === 'sync') {
    await context.authorize(false)

    return Response.json(await sync(context.target))
  }

  const payload = await json(request)

  if (verb === 'restore') {
    const operation = validate(() => restoreRequest(payload))

    await context.authorize(false)
    await requireNative(context.target)

    return Response.json(await restore(context.target, operation))
  }

  const operation = payload as TransactionRequest

  validate(() => validateRequest(operation))
  await context.authorize(
    operation.changes.some(
      change => change.operation === 'write' && change.replaces === undefined
    )
  )

  return Response.json(await transact(context.target, operation))
}
