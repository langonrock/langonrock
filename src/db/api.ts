import { applyChanges, validateRequest } from './changes.ts'
import { readBase } from './base.ts'
import { releaseBuffer } from '../buffers.ts'
import { prepare, prepareFolder } from './documents.ts'
import { ConflictError } from './errors.ts'
import { readHead } from './head.ts'
import { withHead } from './history.ts'
import { publish } from './publish.ts'
import { prepareChanges } from './transaction.ts'
import { listStoredSources, readStoredSource } from './sourceio.ts'
import { readRevision, revisionResult } from './revision.ts'
import { rememberMetadata } from './writecache.ts'
import { currentFile } from '../store/paths.ts'
import { assertBundleName, assertConceptPath } from '../store/sourcepaths.ts'

import type {
  RevisionResult,
  SourceEntry,
  SourceFile,
  TransactionRequest
} from '../types.ts'
import type { CommitObserver } from './publish.ts'
import type { DatabaseTarget } from './types.ts'
import type { Head, Prepared } from './types.ts'

export async function requireNative(target: DatabaseTarget): Promise<void> {
  if (
    (await readHead(target)) === undefined &&
    (await Bun.file(currentFile(target.root, target.tenant)).exists())
  ) {
    throw new Error(
      'legacy tenant: migrate with original sources before using database transactions'
    )
  }
}

async function prepareRequest(
  target: DatabaseTarget,
  request: TransactionRequest
): Promise<{ base: Head | undefined; prepared: Prepared }> {
  const data =
    (await readHead(target)) === undefined ? undefined : await readBase(target)
  const base = data?.head

  try {
    if (
      request.expectedRevision !== undefined &&
      request.expectedRevision !== base?.revision
    ) {
      throw new ConflictError()
    }

    const prepared =
      data === undefined
        ? prepare(applyChanges([], request.changes), target.tenant)
        : prepareChanges(data, request.changes, target.tenant)

    return { base, prepared }
  } finally {
    data?.release()
  }
}

export async function commit(
  target: DatabaseTarget,
  candidate: { base: Head | undefined; prepared: Prepared },
  observe?: CommitObserver
): Promise<RevisionResult> {
  let retained = false

  try {
    const result = await publish(target, {
      ...candidate,
      ...(observe === undefined ? {} : { observe })
    })

    if (candidate.prepared.metadata !== undefined) {
      retained = rememberMetadata(
        target,
        {
          revision: result.revision,
          snapshot: result.snapshot,
          archive: candidate.prepared.archive,
          checksums: candidate.prepared.checksums
        },
        candidate.prepared.metadata
      )
    }

    return result
  } finally {
    releaseBuffer(candidate.prepared.snapshotBytes)

    for (const imported of candidate.prepared.imports ?? []) {
      releaseBuffer(imported.bytes)
    }

    if (!retained) {
      releaseBuffer(candidate.prepared.archiveBytes)
    }
  }
}

export async function transact(
  target: DatabaseTarget,
  request: TransactionRequest,
  observe?: CommitObserver
): Promise<RevisionResult> {
  validateRequest(request)
  await requireNative(target)

  return commit(target, await prepareRequest(target, request), observe)
}

export async function importInitial(
  target: DatabaseTarget,
  source: string,
  summaryWidth = 120,
  observe?: CommitObserver
): Promise<RevisionResult> {
  await requireNative(target)

  if ((await readHead(target)) !== undefined) {
    throw new ConflictError(
      'database already exists; use conflict-aware import'
    )
  }

  const prepared = await prepareFolder(source, target.tenant, summaryWidth)

  return commit(target, { base: undefined, prepared }, observe)
}

export async function sync(target: DatabaseTarget): Promise<RevisionResult> {
  return withHead(target, async head =>
    revisionResult(await readRevision(target, head.revision), head.revision)
  )
}

export async function listSource(
  target: DatabaseTarget
): Promise<SourceEntry[]> {
  return listStoredSources(target)
}

export async function readSource(
  target: DatabaseTarget,
  bundle: string,
  path: string
): Promise<SourceFile | undefined> {
  assertBundleName(bundle)
  assertConceptPath(path)

  return readStoredSource(target, bundle, path)
}

export async function deleteBundle(
  target: DatabaseTarget,
  bundle: string
): Promise<boolean> {
  assertBundleName(bundle)
  await requireNative(target)

  const data = await readBase(target)
  let candidate: { base: Head; prepared: Prepared }

  try {
    if (!data.revision.bundles.includes(bundle)) {
      return false
    }

    candidate = {
      base: data.head,
      prepared: prepareChanges(
        data,
        [],
        target.tenant,
        data.revision.bundles.filter(name => name !== bundle)
      )
    }
  } finally {
    data.release()
  }

  await commit(target, candidate)

  return true
}
