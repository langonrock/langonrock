import { currentFile, lockFile } from '../store/paths.ts'
import { releaseBuffer } from '../buffers.ts'
import { sync } from './api.ts'
import { prepareFolders } from './documents.ts'
import { assertHash } from './format.ts'
import { readHead } from './head.ts'
import { ConflictError } from './errors.ts'
import { scanImports } from './importscan.ts'
import { locationKey } from './importstate.ts'
import { verifyMigration } from './migrationcheck.ts'
import { publish } from './publish.ts'
import { releasePrepared } from './verified.ts'

import type { RevisionResult } from '../types.ts'
import type { ImportLocation } from './importstate.ts'
import type { CommitObserver } from './publish.ts'
import type { DatabaseTarget, Prepared } from './types.ts'

export interface MigrationOptions {
  bundle?: string
  summaryWidth?: number
  dryRun?: boolean
  observe?: CommitObserver
}

export interface MigrationResult {
  alreadyMigrated: boolean
  dryRun: boolean
  snapshot: string
  concepts: number
  revision?: string
}

async function legacySnapshot(target: DatabaseTarget): Promise<string> {
  const pointer = Bun.file(currentFile(target.root, target.tenant))

  if (!(await pointer.exists())) {
    throw new Error(
      'no legacy snapshot to migrate; use import for a new database'
    )
  }

  const snapshot = (await pointer.text()).trim()

  assertHash(snapshot)

  return snapshot
}

function completed(
  result: RevisionResult,
  alreadyMigrated: boolean
): MigrationResult {
  return {
    alreadyMigrated,
    dryRun: false,
    snapshot: result.snapshot,
    concepts: result.concepts,
    revision: result.revision
  }
}

async function unchangedOriginals(
  target: DatabaseTarget,
  prepared: Prepared
): Promise<void> {
  if (await Bun.file(lockFile(target.root, target.tenant)).exists()) {
    throw new ConflictError(
      'a legacy writer is active; stop legacy writers before migrating'
    )
  }

  const references = prepared.imports?.map(item => item.reference) ?? []
  const scans = await scanImports(references)

  try {
    const expected = new Map(
      references.map(reference => [locationKey(reference), reference.mapping])
    )

    if (
      scans.some(
        scan =>
          expected.get(locationKey(scan.artifact.reference)) !==
          scan.artifact.reference.mapping
      )
    ) {
      throw new ConflictError(
        'original sources changed during migration; stop editing and verify them again'
      )
    }
  } finally {
    for (const scan of scans) {
      releaseBuffer(scan.artifact.bytes)
    }
  }
}

export async function migrate(
  target: DatabaseTarget,
  source: string,
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  if ((await readHead(target)) !== undefined) {
    return {
      ...completed(await sync(target), true),
      dryRun: options.dryRun === true
    }
  }

  const snapshot = await legacySnapshot(target)
  const location: ImportLocation = {
    source,
    ...(options.bundle === undefined ? {} : { bundle: options.bundle })
  }
  const prepared = await prepareFolders(
    [location],
    target.tenant,
    options.summaryWidth
  )

  try {
    await verifyMigration(target, snapshot, prepared)

    if (options.dryRun === true) {
      return {
        alreadyMigrated: false,
        dryRun: true,
        snapshot: prepared.snapshot,
        concepts: prepared.concepts
      }
    }

    return completed(
      await publish(target, {
        base: undefined,
        prepared,
        expectedLegacy: snapshot,
        observe: async step => {
          await options.observe?.(step)

          if (step === 'locked') {
            await unchangedOriginals(target, prepared)
          }
        }
      }),
      false
    )
  } finally {
    releasePrepared(prepared)
  }
}
