import type { DirEntry, TntHeader } from './format.ts'

export interface SnapshotChecksums {
  header: number
  directory: number
  manifest: number
}

export interface SnapshotAccess {
  descriptor: number
  size: number
  checksums: SnapshotChecksums
  cached?: SnapshotMetadata
}

export interface SnapshotMetadata {
  header: TntHeader
  entries: DirEntry[]
  manifest: string
}

export function snapshotChecksums(
  bytes: Uint8Array,
  header: TntHeader
): SnapshotChecksums {
  return {
    header: Bun.hash.crc32(bytes.subarray(0, 32)),
    directory: Bun.hash.crc32(
      bytes.subarray(header.dirOffset, header.blobsOffset)
    ),
    manifest: Bun.hash.crc32(
      bytes.subarray(header.manifestOffset, header.dirOffset)
    )
  }
}

export function checkBytes(bytes: Uint8Array, checksum: number): void {
  if (Bun.hash.crc32(bytes) !== checksum) {
    throw new Error('database corruption: snapshot metadata checksum mismatch')
  }
}

export function checkHeader(header: TntHeader, size: number): void {
  if (
    header.manifestOffset !== 32 ||
    header.dirOffset !== header.manifestOffset + header.manifestLength ||
    header.blobsOffset !== header.dirOffset + header.dirLength ||
    header.blobsOffset + header.blobsLength !== size
  ) {
    throw new Error('database corruption: invalid snapshot offsets')
  }
}
