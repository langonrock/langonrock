import { corruption } from './errors.ts'
import { assertHash, frame, hash, unframe } from './format.ts'
import { artifact } from './head.ts'
import { releaseBuffer } from '../buffers.ts'
import { METADATA_RECORD_LIMIT, readBounded } from './recordio.ts'
import {
  validateBundles,
  validateChecksums,
  validateDiagnostics
} from './validation.ts'

import type { RevisionResult } from '../types.ts'
import type { DatabaseTarget, Revision } from './types.ts'

export function encodeRevision(revision: Revision): Uint8Array {
  return frame('LRR1', revision)
}

export function decodeRevision(bytes: Uint8Array, digest: string): Revision {
  if (hash(bytes) !== digest) {
    throw corruption('revision digest mismatch')
  }

  const { metadata, payload } = unframe(bytes, 'LRR1')
  const revision = metadata as Revision

  if (!revision || revision.version !== 1 || payload.length !== 0) {
    throw corruption('invalid revision record')
  }

  assertHash(revision.snapshot)
  assertHash(revision.archive)

  if (revision.parent !== null) {
    assertHash(revision.parent)
  }

  validateRevisionMetadata(revision)

  return revision
}

function validateRevisionMetadata(revision: Revision): void {
  if (
    !Array.isArray(revision.bundles) ||
    !Array.isArray(revision.diagnostics) ||
    !Number.isSafeInteger(revision.concepts) ||
    revision.concepts < 0 ||
    !Number.isSafeInteger(revision.summaryWidth) ||
    revision.summaryWidth < 0 ||
    typeof revision.created !== 'string' ||
    !Number.isFinite(Date.parse(revision.created))
  ) {
    throw corruption('invalid revision metadata')
  }

  validateChecksums(revision.checksums)
  validateBundles(revision.bundles)
  validateDiagnostics(revision.diagnostics)
}

export async function readRevision(
  target: DatabaseTarget,
  digest: string
): Promise<Revision> {
  const bytes = await readBounded(
    artifact(target, 'revision', digest),
    METADATA_RECORD_LIMIT
  )

  try {
    return decodeRevision(bytes, digest)
  } finally {
    releaseBuffer(bytes)
  }
}

export function revisionResult(
  revision: Revision,
  digest: string
): RevisionResult {
  return {
    revision: digest,
    snapshot: revision.snapshot,
    concepts: revision.concepts,
    bundles: revision.bundles,
    diagnostics: revision.diagnostics
  }
}
