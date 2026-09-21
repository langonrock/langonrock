import {
  ConflictError,
  InvalidRequestError,
  MissingDatabaseError,
  corruption
} from './errors.ts'
import { assertHash } from './format.ts'
import { directory, readHead } from './head.ts'
import { lock } from './platform.ts'
import { readRevision } from './revision.ts'

import type { HistoryOptions, RevisionInfo, RevisionPage } from '../types.ts'
import type { DatabaseTarget, Head, Revision } from './types.ts'

async function retentionLock(target: DatabaseTarget): Promise<() => void> {
  try {
    return await lock(`${directory(target)}/retention.lock`, true)
  } catch (cause) {
    if ((await readHead(target)) === undefined) {
      throw new MissingDatabaseError()
    }

    throw cause
  }
}

export async function withHead<T>(
  target: DatabaseTarget,
  action: (head: Head) => Promise<T>
): Promise<T> {
  const release = await retentionLock(target)

  try {
    const head = await readHead(target)

    if (head === undefined) {
      throw new MissingDatabaseError()
    }

    return await action(head)
  } finally {
    release()
  }
}

function checkRoot(head: Head, revision: Revision): void {
  if (
    head.snapshot !== revision.snapshot ||
    head.archive !== revision.archive ||
    head.checksums.header !== revision.checksums.header ||
    head.checksums.directory !== revision.checksums.directory ||
    head.checksums.manifest !== revision.checksums.manifest
  ) {
    throw corruption('head differs from its revision')
  }
}

export async function* committed(
  target: DatabaseTarget,
  head: Head
): AsyncGenerator<{ digest: string; revision: Revision }> {
  const retained =
    head.retained === undefined ? undefined : new Set(head.retained)
  let digest: string | null = head.revision

  while (digest !== null && (retained === undefined || retained.has(digest))) {
    const revision = await readRevision(target, digest)

    if (digest === head.revision) {
      checkRoot(head, revision)
    }

    yield { digest, revision }
    digest = revision.parent
  }
}

export async function findCommitted(
  target: DatabaseTarget,
  head: Head,
  wanted: string
): Promise<Revision> {
  assertHash(wanted)

  for await (const { digest, revision } of committed(target, head)) {
    if (digest === wanted) {
      return revision
    }
  }

  throw new ConflictError('revision is not in retained committed history')
}

function decodeCursor(cursor: string, tenant: string): string {
  if (cursor.length > 512) {
    throw new InvalidRequestError('invalid history cursor')
  }

  try {
    const value = JSON.parse(
      Buffer.from(cursor, 'base64url').toString()
    ) as Record<string, unknown>

    if (value.version !== 1 || value.tenant !== tenant) {
      throw new InvalidRequestError('invalid history cursor')
    }

    assertHash(value.before)

    return value.before
  } catch {
    throw new InvalidRequestError('invalid history cursor')
  }
}

function info(digest: string, revision: Revision): RevisionInfo {
  return {
    revision: digest,
    parent: revision.parent,
    snapshot: revision.snapshot,
    created: revision.created,
    concepts: revision.concepts,
    bundles: revision.bundles
  }
}

async function page(
  target: DatabaseTarget,
  head: Head,
  options: { before: string | undefined; limit: number }
): Promise<RevisionPage> {
  const revisions: RevisionInfo[] = []
  let found = options.before === undefined

  for await (const { digest, revision } of committed(target, head)) {
    if (!found) {
      found = digest === options.before
      continue
    }

    if (revisions.length === options.limit) {
      const before = revisions.at(-1)?.revision
      const next = Buffer.from(
        JSON.stringify({ version: 1, tenant: target.tenant, before })
      ).toString('base64url')

      return { revisions, next }
    }

    revisions.push(info(digest, revision))
  }

  if (!found) {
    throw new ConflictError(
      'history cursor expired or is not committed; restart history pagination'
    )
  }

  return { revisions }
}

export async function history(
  target: DatabaseTarget,
  options: HistoryOptions = {}
): Promise<RevisionPage> {
  const limit = options.limit ?? 20

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new InvalidRequestError(
      'history limit must be an integer from 1 to 100'
    )
  }

  const before =
    options.before === undefined
      ? undefined
      : decodeCursor(options.before, target.tenant)

  return withHead(target, head => page(target, head, { before, limit }))
}
