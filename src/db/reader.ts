import { closeSync, fstatSync, openSync } from 'node:fs'

import { openSnapshot } from '../store/reader.ts'
import { corruption } from './errors.ts'
import { Descriptor } from './descriptor.ts'
import { hash } from './format.ts'
import { artifact, directory, readHead } from './head.ts'
import { lock } from './platform.ts'
import { decodeSources, sourcePrefix } from './sourcearchive.ts'
import { acquireMetadata, cachedReader } from './writecache.ts'
import { releaseBuffer } from '../buffers.ts'

import type { TenantReader } from '../store/reader.ts'
import type {
  DatabaseTarget,
  DocumentRecord,
  Head,
  SourceArchive,
  SourceRecord
} from './types.ts'
import type { WriteMetadata } from './writecache.ts'

export interface PinnedReader extends TenantReader {
  head: Head
  close: () => void
}

const finalizer = new FinalizationRegistry<Descriptor>(descriptor =>
  descriptor.close()
)

async function fromDescriptor(
  target: DatabaseTarget,
  head: Head,
  descriptor: number
): Promise<PinnedReader> {
  const cached = cachedReader(target, head)
  let reader: TenantReader | undefined = await openSnapshot(
    target.root,
    target.tenant,
    head.snapshot,
    {
      descriptor,
      size: fstatSync(descriptor).size,
      checksums: head.checksums,
      ...(cached === undefined ? {} : { cached })
    }
  )
  const owned = new Descriptor(descriptor)

  const active = (): TenantReader => {
    if (reader === undefined) {
      throw new Error('database reader is closed')
    }

    return reader
  }

  const pinned: PinnedReader = {
    snapshot: head.snapshot,
    get ids() {
      return active().ids
    },
    get titles() {
      return active().titles
    },
    manifest: bundle => owned.use(() => active().manifest(bundle)),
    get: (ids, options) => owned.use(() => active().get(ids, options)),
    bodies: () => owned.use(() => active().bodies()),
    head,
    close: () => {
      if (reader !== undefined) {
        reader = undefined
        finalizer.unregister(pinned)
        owned.close()
      }
    }
  }

  finalizer.register(pinned, owned, pinned)

  return pinned
}

async function openLocked(
  target: DatabaseTarget,
  head: Head
): Promise<PinnedReader> {
  const descriptor = openSync(artifact(target, 'snapshot', head.snapshot), 'r')

  try {
    return await fromDescriptor(target, head, descriptor)
  } catch (cause) {
    closeSync(descriptor)

    throw cause
  }
}

export async function pinReader(target: DatabaseTarget): Promise<PinnedReader> {
  const release = await lock(`${directory(target)}/retention.lock`, true)

  try {
    const head = await readHead(target)

    if (head === undefined) {
      throw new Error(
        'tenant has no database; import or migrate original sources first'
      )
    }

    return await openLocked(target, head)
  } finally {
    release()
  }
}

export interface PinnedSources {
  reader: PinnedReader
  archive: SourceArchive
}

async function loadArchive(
  target: DatabaseTarget,
  head: Head
): Promise<SourceArchive> {
  const bytes = new Uint8Array(
    await Bun.file(artifact(target, 'archive', head.archive)).arrayBuffer()
  )

  if (hash(bytes) !== head.archive) {
    throw corruption('source archive digest mismatch')
  }

  return decodeSources(bytes)
}

export interface ArchiveLease {
  archive: SourceArchive
  metadata?: WriteMetadata
  release: () => void
}

export async function leaseArchive(
  target: DatabaseTarget,
  head: Head
): Promise<ArchiveLease> {
  const cached = acquireMetadata(target, head)

  if (cached !== undefined) {
    return { ...cached, archive: cached.metadata.archive }
  }

  const archive = await loadArchive(target, head)

  return { archive, release: () => releaseBuffer(archive.payload) }
}

export async function pinSources(
  target: DatabaseTarget
): Promise<PinnedSources> {
  const release = await lock(`${directory(target)}/retention.lock`, true)
  let reader: PinnedReader | undefined

  try {
    const head = await readHead(target)

    if (head === undefined) {
      throw new Error(
        'tenant has no database; import or migrate original sources first'
      )
    }

    reader = await openLocked(target, head)

    return { reader, archive: await loadArchive(target, head) }
  } catch (cause) {
    reader?.close()

    throw cause
  } finally {
    release()
  }
}

export function reconstruct(
  archive: SourceArchive,
  entry: SourceRecord,
  body: string
): DocumentRecord {
  const source = sourcePrefix(archive, entry) + body

  if (
    hash(source) !== entry.hash ||
    Buffer.byteLength(source) !== entry.bytes
  ) {
    throw corruption('reconstructed source differs from committed source')
  }

  return { bundle: entry.bundle, path: entry.path, source }
}

export async function allDocuments(
  pinned: PinnedSources
): Promise<DocumentRecord[]> {
  const bodies = new Map(await pinned.reader.bodies())

  return pinned.archive.entries.map(entry =>
    reconstruct(
      pinned.archive,
      entry,
      entry.id === undefined ? '' : (bodies.get(entry.id) ?? '')
    )
  )
}
