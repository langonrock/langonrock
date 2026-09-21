import { closeSync, fstatSync, openSync } from 'node:fs'

import { decodeBlob } from '../store/format.ts'
import { readBytes } from '../store/readbytes.ts'
import { artifact } from './head.ts'
import { withHead } from './history.ts'
import { leaseArchive, reconstruct } from './reader.ts'

import type { SourceEntry, SourceFile } from '../types.ts'
import type { DatabaseTarget, SourceArchive, SourceRecord } from './types.ts'

async function sourceBody(
  descriptor: number,
  entry: SourceRecord
): Promise<string> {
  const body = entry.body

  if (body === undefined) {
    return ''
  }

  if (body.offset + body.length > fstatSync(descriptor).size) {
    throw new Error('database corruption: source body exceeds snapshot')
  }

  return decodeBlob(
    await readBytes(descriptor, body.offset, body.length),
    body.checksum
  )
}

interface SourceView {
  release: () => void
  descriptor: number
  archive: SourceArchive
}

async function sourceView(target: DatabaseTarget): Promise<SourceView> {
  return withHead(target, async head => {
    const sources = await leaseArchive(target, head)

    try {
      const descriptor = openSync(
        artifact(target, 'snapshot', head.snapshot),
        'r'
      )

      return { ...sources, descriptor }
    } catch (cause) {
      sources.release()

      throw cause
    }
  })
}

export async function listStoredSources(
  target: DatabaseTarget
): Promise<SourceEntry[]> {
  const { descriptor, archive, release } = await sourceView(target)

  try {
    return archive.entries.map(({ bundle, path, id, bytes, hash }) => ({
      bundle,
      path,
      bytes,
      hash,
      ...(id === undefined ? {} : { id })
    }))
  } finally {
    closeSync(descriptor)
    release()
  }
}

export async function readStoredSource(
  target: DatabaseTarget,
  bundle: string,
  path: string
): Promise<SourceFile | undefined> {
  const { descriptor, archive, release } = await sourceView(target)

  try {
    const entry = archive.entries.find(
      entry => entry.bundle === bundle && entry.path === path
    )

    if (entry === undefined) {
      return undefined
    }

    const body = await sourceBody(descriptor, entry)
    const document = reconstruct(archive, entry, body)

    return { content: document.source, hash: entry.hash }
  } finally {
    closeSync(descriptor)
    release()
  }
}
