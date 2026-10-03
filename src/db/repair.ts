import { mkdir } from 'node:fs/promises'

import { ConflictError, corruption } from './errors.ts'
import { assertHash, hash } from './format.ts'
import { directory } from './head.ts'
import { flushDirectory, flushFile, lock } from './platform.ts'
import { replaceHead } from './publish.ts'
import { readRevision, revisionResult } from './revision.ts'
import { writeStage } from './staging.ts'
import { rawHead } from './verify.ts'
import { releasePrepared, verifiedArtifacts } from './verified.ts'

import type { RevisionResult } from '../types.ts'
import type { DatabaseTarget } from './types.ts'

export interface RepairRequest {
  revision: string
  expectedHeadHash: string | null
}

async function preserveHead(
  target: DatabaseTarget,
  bytes: Uint8Array
): Promise<void> {
  const folder = `${directory(target)}/recovery`
  const path = `${folder}/${hash(bytes)}.head`

  await mkdir(folder, { recursive: true })
  flushDirectory(directory(target))

  if (await Bun.file(path).exists()) {
    if (
      hash(new Uint8Array(await Bun.file(path).arrayBuffer())) !== hash(bytes)
    ) {
      throw corruption('saved repair head differs from its filename')
    }
  } else {
    await writeStage(path, bytes)
    flushDirectory(folder)
  }

  flushFile(path)
}

async function repairLocked(
  target: DatabaseTarget,
  request: RepairRequest
): Promise<RevisionResult> {
  const previous = await rawHead(target)
  const previousHash = previous === undefined ? null : hash(previous)

  if (previousHash !== request.expectedHeadHash) {
    throw new ConflictError(
      'head changed since verification; run verify again before repair'
    )
  }

  const revision = await readRevision(target, request.revision)

  releasePrepared(await verifiedArtifacts(target, revision))

  if (previous !== undefined) {
    await preserveHead(target, previous)
  }

  await replaceHead(target, {
    version: 1,
    revision: request.revision,
    snapshot: revision.snapshot,
    archive: revision.archive,
    checksums: revision.checksums,
    retained: [request.revision]
  })

  return revisionResult(revision, request.revision)
}

export async function repair(
  target: DatabaseTarget,
  request: RepairRequest
): Promise<RevisionResult> {
  assertHash(request.revision)

  if (request.expectedHeadHash !== null) {
    assertHash(request.expectedHeadHash)
  }

  const releaseWriter = await lock(`${directory(target)}/writer.lock`)

  try {
    const releaseReaders = await lock(`${directory(target)}/retention.lock`)

    try {
      return await repairLocked(target, request)
    } finally {
      releaseReaders()
    }
  } finally {
    releaseWriter()
  }
}
