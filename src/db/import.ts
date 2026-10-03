import { releaseBuffer } from '../buffers.ts'
import { commit, requireNative } from './api.ts'
import { readBase } from './base.ts'
import { finish, prepareFolders } from './documents.ts'
import { compileInput } from './input.ts'
import { applyChanges } from './changes.ts'
import { decodeBlob } from '../store/format.ts'
import { reconstruct } from './reader.ts'
import { readHead } from './head.ts'
import { importChanges } from './importchanges.ts'
import { importedBundles } from './importbundles.ts'
import { scanImports } from './importscan.ts'
import { locationKey } from './importstate.ts'
import { revisionResult } from './revision.ts'
import { prepareChanges } from './transaction.ts'
import { assertSummaryWidth } from './validation.ts'

import type { RevisionResult } from '../types.ts'
import type { ImportLocation } from './importstate.ts'
import type { DatabaseTarget, Head, Prepared } from './types.ts'
import type { CommitObserver } from './publish.ts'
import type { BaseData } from './base.ts'
import type { DocumentChange } from '../types.ts'

interface ImportOptions {
  summaryWidth?: number
}

function rebuild(
  base: BaseData,
  changes: DocumentChange[],
  config: { tenant: string; width: number; bundles: string[] }
): Prepared {
  const originals = base.archive.entries.map(entry => {
    const body = entry.body
    const content =
      body === undefined
        ? ''
        : decodeBlob(
            base.snapshot.subarray(body.offset, body.offset + body.length),
            body.checksum
          )

    return reconstruct(base.archive, entry, content)
  })

  const grouped = Map.groupBy(
    applyChanges(originals, changes),
    file => file.bundle
  )

  return finish(
    config.bundles.map(name =>
      compileInput(name, grouped.get(name) ?? [], config.width)
    ),
    config.tenant,
    config.width
  )
}

function candidate(
  base: BaseData,
  target: DatabaseTarget,
  changes: DocumentChange[],
  options: { width: number | undefined; bundles: string[] }
): Prepared {
  const { width, bundles } = options

  if (width !== undefined && width !== base.summaryWidth) {
    return rebuild(base, changes, { tenant: target.tenant, width, bundles })
  }

  return changes.length === 0 &&
    JSON.stringify(bundles) === JSON.stringify(base.revision.bundles)
    ? {
        ...base.revision,
        snapshotBytes: base.snapshot.slice(),
        archiveBytes: new Uint8Array(base.archive.payload.buffer).slice()
      }
    : prepareChanges(base, changes, target.tenant, bundles)
}

async function existing(
  target: DatabaseTarget,
  locations: ImportLocation[],
  options: ImportOptions
) {
  const scans = await scanImports(locations)
  let base: BaseData | undefined
  let transferred = false

  try {
    base = await readBase(target, true)

    const mappings = new Map(
      base.head.imports?.map(reference => [
        locationKey(reference),
        reference.mapping
      ])
    )

    if (
      (options.summaryWidth === undefined ||
        options.summaryWidth === base.summaryWidth) &&
      scans.every(
        scan =>
          mappings.get(locationKey(scan.artifact.reference)) ===
          scan.artifact.reference.mapping
      )
    ) {
      return { result: revisionResult(base.revision, base.head.revision) }
    }

    const changes = await importChanges(base, scans)
    const prepared = candidate(base, target, changes, {
      width: options.summaryWidth,
      bundles: importedBundles(base, scans, changes)
    })

    prepared.imports = scans.map(scan => scan.artifact)
    transferred = true

    return { candidate: { base: base.head, prepared } }
  } finally {
    base?.release()

    if (!transferred) {
      for (const scan of scans) {
        releaseBuffer(scan.artifact.bytes)
      }
    }
  }
}

export async function importFolders(
  target: DatabaseTarget,
  locations: ImportLocation[],
  options: ImportOptions = {},
  observe?: CommitObserver
): Promise<RevisionResult> {
  if (locations.length === 0 || locations.length > 64) {
    throw new Error('import needs between 1 and 64 source locations')
  }

  if (options.summaryWidth !== undefined) {
    assertSummaryWidth(options.summaryWidth)
  }

  await requireNative(target)

  let candidate: { base: Head | undefined; prepared: Prepared }

  if ((await readHead(target)) === undefined) {
    candidate = {
      base: undefined,
      prepared: await prepareFolders(
        locations,
        target.tenant,
        options.summaryWidth
      )
    }
  } else {
    const prepared = await existing(target, locations, options)

    if (prepared.result !== undefined) {
      return prepared.result
    }

    candidate = prepared.candidate
  }

  return commit(target, candidate, observe)
}

export function importFolder(
  target: DatabaseTarget,
  source: string,
  options: ImportOptions = {},
  observe?: CommitObserver
): Promise<RevisionResult> {
  return importFolders(target, [{ source }], options, observe)
}
