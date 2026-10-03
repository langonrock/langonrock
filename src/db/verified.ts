import { releaseBuffer } from '../buffers.ts'
import { decodeBlob, parseDir, parseHeader } from '../store/format.ts'
import { checkBytes, checkHeader } from '../store/integrity.ts'
import { corruption } from './errors.ts'
import { hash } from './format.ts'
import { artifact } from './head.ts'
import { reconstruct } from './reader.ts'
import { decodeSources } from './sourcearchive.ts'

import type { DirEntry, TntHeader } from '../store/format.ts'
import type {
  DatabaseTarget,
  Prepared,
  Revision,
  SourceArchive,
  SourceRecord
} from './types.ts'

function snapshotDirectory(
  bytes: Uint8Array,
  revision: Pick<Revision, 'checksums' | 'concepts'>
) {
  const header = parseHeader(bytes)

  checkHeader(header, bytes.length)
  checkBytes(bytes.subarray(0, 32), revision.checksums.header)
  checkBytes(
    bytes.subarray(header.manifestOffset, header.dirOffset),
    revision.checksums.manifest
  )
  checkBytes(
    bytes.subarray(header.dirOffset, header.blobsOffset),
    revision.checksums.directory
  )

  const entries = parseDir(bytes.subarray(header.dirOffset, header.blobsOffset))
  const directory = new Map(entries.map(entry => [entry.id, entry]))

  if (
    directory.size !== entries.length ||
    entries.length !== revision.concepts
  ) {
    throw corruption('compiled concept count differs from revision')
  }

  return { header, directory }
}

function sourceBody(
  bytes: Uint8Array,
  source: SourceRecord,
  entry: DirEntry | undefined,
  header: TntHeader
): string {
  const body = source.body

  if (body === undefined) {
    return ''
  }

  if (
    entry === undefined ||
    body.offset !== header.blobsOffset + entry.offset ||
    body.length !== entry.length ||
    body.checksum !== entry.checksum ||
    body.offset + body.length > bytes.length
  ) {
    throw corruption('source body differs from compiled directory')
  }

  return decodeBlob(
    bytes.subarray(body.offset, body.offset + body.length),
    body.checksum
  )
}

function verifySources(
  bytes: Uint8Array,
  archive: SourceArchive,
  revision: Pick<Revision, 'checksums' | 'concepts' | 'bundles'>
): void {
  const { header, directory } = snapshotDirectory(bytes, revision)
  const bundles = new Set(revision.bundles)
  const ids = new Set<string>()

  if (
    JSON.stringify(archive.bundles.map(bundle => bundle.name)) !==
    JSON.stringify(revision.bundles)
  ) {
    throw corruption('source bundles differ from revision')
  }

  for (const source of archive.entries) {
    if (!bundles.has(source.bundle)) {
      throw corruption('source references a missing bundle')
    }

    const entry = source.id === undefined ? undefined : directory.get(source.id)

    reconstruct(archive, source, sourceBody(bytes, source, entry, header))

    if (source.id !== undefined) {
      if (ids.has(source.id)) {
        throw corruption('duplicate compiled source identity')
      }

      ids.add(source.id)
    }
  }

  if (ids.size !== directory.size) {
    throw corruption('compiled concept has no original source')
  }
}

export async function verifiedArtifacts(
  target: DatabaseTarget,
  revision: Revision
): Promise<Prepared> {
  const snapshotBytes = new Uint8Array(
    await Bun.file(
      artifact(target, 'snapshot', revision.snapshot)
    ).arrayBuffer()
  )
  let archiveBytes: Uint8Array | undefined

  try {
    archiveBytes = new Uint8Array(
      await Bun.file(
        artifact(target, 'archive', revision.archive)
      ).arrayBuffer()
    )

    if (
      hash(snapshotBytes) !== revision.snapshot ||
      hash(archiveBytes) !== revision.archive
    ) {
      throw corruption('revision artifact digest mismatch')
    }

    verifySources(snapshotBytes, decodeSources(archiveBytes), revision)

    return { ...revision, snapshotBytes, archiveBytes }
  } catch (cause) {
    releaseBuffer(snapshotBytes)

    if (archiveBytes !== undefined) {
      releaseBuffer(archiveBytes)
    }

    throw cause
  }
}

export function verifyPrepared(prepared: Prepared): void {
  if (
    hash(prepared.snapshotBytes) !== prepared.snapshot ||
    hash(prepared.archiveBytes) !== prepared.archive
  ) {
    throw corruption('prepared artifact digest mismatch')
  }

  verifySources(
    prepared.snapshotBytes,
    decodeSources(prepared.archiveBytes),
    prepared
  )
}

export function releasePrepared(prepared: Prepared): void {
  releaseBuffer(prepared.snapshotBytes)
  releaseBuffer(prepared.archiveBytes)

  for (const imported of prepared.imports ?? []) {
    releaseBuffer(imported.bytes)
  }
}
