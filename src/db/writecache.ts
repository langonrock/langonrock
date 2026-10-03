import { resolve } from 'node:path'
import { releaseBuffer } from '../buffers.ts'

import type { Concept } from '../okf/types.ts'
import type { DirEntry } from '../store/format.ts'
import type { SnapshotMetadata } from '../store/integrity.ts'
import type { DatabaseTarget, Head, SourceArchive } from './types.ts'

export interface WriteMetadata {
  archive: SourceArchive
  directory: Map<string, DirEntry>
  concepts: Map<string, Concept[]>
  reader: SnapshotMetadata
}

interface Entry {
  references: number
  key: string
  head: Pick<Head, 'revision' | 'snapshot' | 'archive' | 'checksums'>
  metadata: WriteMetadata
}

let current: Entry | undefined

function key(target: DatabaseTarget): string {
  return `${resolve(target.root)}\0${target.tenant}`
}

function matching(target: DatabaseTarget, head: Head): Entry | undefined {
  return current?.key === key(target) &&
    current.head.revision === head.revision &&
    current.head.snapshot === head.snapshot &&
    current.head.archive === head.archive &&
    current.head.checksums.header === head.checksums.header &&
    current.head.checksums.directory === head.checksums.directory &&
    current.head.checksums.manifest === head.checksums.manifest
    ? current
    : undefined
}

function release(entry: Entry): void {
  entry.references--

  if (entry.references === 0) {
    releaseBuffer(entry.metadata.archive.payload)
  }
}

export function cachedReader(
  target: DatabaseTarget,
  head: Head
): SnapshotMetadata | undefined {
  return matching(target, head)?.metadata.reader
}

export function acquireMetadata(
  target: DatabaseTarget,
  head: Head
): { metadata: WriteMetadata; release: () => void } | undefined {
  const entry = matching(target, head)

  if (entry === undefined) {
    return undefined
  }

  entry.references++
  let active = true

  return {
    metadata: entry.metadata,
    release: () => {
      if (active) {
        active = false
        release(entry)
      }
    }
  }
}

export function rememberMetadata(
  target: DatabaseTarget,
  head: Entry['head'],
  metadata: WriteMetadata
): boolean {
  if (current !== undefined) {
    release(current)
  }

  current =
    metadata.archive.payload.buffer.byteLength <= 32 * 1024 * 1024 &&
    metadata.reader.header.dirLength + metadata.reader.header.manifestLength <=
      32 * 1024 * 1024 &&
    metadata.archive.entries.length <= 50_000
      ? { key: key(target), head, metadata, references: 1 }
      : undefined

  return current !== undefined
}
