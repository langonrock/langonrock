import { releaseBuffer } from '../buffers.ts'
import { decodeBlob, parseDir, parseHeader } from '../store/format.ts'
import { checkHeader } from '../store/integrity.ts'
import { snapshotFile } from '../store/paths.ts'
import { corruption } from './errors.ts'
import { hash } from './format.ts'
import { verifyPrepared } from './verified.ts'

import type { DirEntry } from '../store/format.ts'
import type { DatabaseTarget, Prepared } from './types.ts'

function metadata(entry: DirEntry) {
  return {
    id: entry.id,
    sections: entry.sections,
    title: entry.title,
    staleAfter: entry.staleAfter
  }
}

function compare(before: Uint8Array, after: Uint8Array): void {
  const oldHeader = parseHeader(before)
  const newHeader = parseHeader(after)

  checkHeader(oldHeader, before.length)

  if (
    !Buffer.from(
      before.subarray(oldHeader.manifestOffset, oldHeader.dirOffset)
    ).equals(after.subarray(newHeader.manifestOffset, newHeader.dirOffset))
  ) {
    throw new Error(
      'original sources do not reproduce the legacy manifest; restore matching originals and summary width before migration'
    )
  }

  const oldEntries = parseDir(
    before.subarray(oldHeader.dirOffset, oldHeader.blobsOffset)
  )
  const newEntries = parseDir(
    after.subarray(newHeader.dirOffset, newHeader.blobsOffset)
  )

  if (
    JSON.stringify(oldEntries.map(metadata)) !==
    JSON.stringify(newEntries.map(metadata))
  ) {
    throw new Error(
      'original sources do not reproduce the legacy concepts and sections'
    )
  }

  for (const [index, entry] of oldEntries.entries()) {
    const next = newEntries[index]

    if (next === undefined) {
      throw corruption('missing migrated concept')
    }

    const original = decodeBlob(
      before.subarray(
        oldHeader.blobsOffset + entry.offset,
        oldHeader.blobsOffset + entry.offset + entry.length
      ),
      entry.checksum
    )
    const migrated = decodeBlob(
      after.subarray(
        newHeader.blobsOffset + next.offset,
        newHeader.blobsOffset + next.offset + next.length
      ),
      next.checksum
    )

    if (original !== migrated) {
      throw new Error(
        `original source body differs from legacy concept ${entry.id}`
      )
    }
  }
}

export async function verifyMigration(
  target: DatabaseTarget,
  snapshot: string,
  prepared: Prepared
): Promise<void> {
  verifyPrepared(prepared)

  const bytes = new Uint8Array(
    await Bun.file(
      snapshotFile(target.root, target.tenant, snapshot)
    ).arrayBuffer()
  )

  try {
    if (hash(bytes) !== snapshot) {
      throw corruption('legacy snapshot digest mismatch')
    }

    compare(bytes, prepared.snapshotBytes)
  } finally {
    releaseBuffer(bytes)
  }
}
