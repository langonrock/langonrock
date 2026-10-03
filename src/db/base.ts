import { closeSync, fstatSync, openSync } from 'node:fs'

import { readBytes } from '../store/readbytes.ts'
import { corruption } from './errors.ts'
import { hash } from './format.ts'
import { artifact, directory, readHead } from './head.ts'
import { lock } from './platform.ts'
import { leaseArchive } from './reader.ts'
import { releaseBuffer } from '../buffers.ts'
import { readRevision } from './revision.ts'
import { locationKey, readImport } from './importstate.ts'

import type { DatabaseTarget, Head, SourceArchive, Revision } from './types.ts'
import type { ImportedState } from './importstate.ts'
import type { WriteMetadata } from './writecache.ts'

export interface BaseData {
  release: () => void
  metadata?: WriteMetadata
  head: Head
  archive: SourceArchive
  snapshot: Uint8Array
  summaryWidth: number
  revision: Revision
  imported?: Map<string, ImportedState>
}

async function fromDescriptor(
  target: DatabaseTarget,
  head: Head,
  descriptor: number,
  includeImports: boolean
): Promise<BaseData> {
  const snapshot = await readBytes(descriptor, 0, fstatSync(descriptor).size)

  try {
    if (hash(snapshot) !== head.snapshot) {
      throw corruption('base snapshot digest mismatch')
    }

    const revision = await readRevision(target, head.revision)
    const imported = includeImports
      ? new Map(
          await Promise.all(
            (head.imports ?? []).map(
              async reference =>
                [
                  locationKey(reference),
                  await readImport(target, reference)
                ] as const
            )
          )
        )
      : undefined
    const sources = await leaseArchive(target, head)

    return {
      ...sources,
      head,
      snapshot,
      summaryWidth: revision.summaryWidth,
      revision,
      ...(imported === undefined ? {} : { imported }),
      release: () => {
        releaseBuffer(snapshot)
        sources.release()
      }
    }
  } catch (cause) {
    releaseBuffer(snapshot)

    throw cause
  }
}

export async function readBase(
  target: DatabaseTarget,
  includeImports = false
): Promise<BaseData> {
  const release = await lock(`${directory(target)}/retention.lock`, true)
  let descriptor: number | undefined

  try {
    const head = await readHead(target)

    if (head === undefined) {
      throw new Error('database disappeared while opening a transaction')
    }

    descriptor = openSync(artifact(target, 'snapshot', head.snapshot), 'r')

    return await fromDescriptor(target, head, descriptor, includeImports)
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor)
    }

    release()
  }
}
