import { DEFAULT_KEEP } from '../store/contracts.ts'
import { currentFile } from '../store/paths.ts'
import { assertHash } from './format.ts'
import { directory, readHead } from './head.ts'
import { committed } from './history.ts'
import { readImport } from './importstate.ts'
import { lock } from './platform.ts'
import { replaceHead } from './publish.ts'
import { garbage, sweep } from './sweep.ts'
import { releasePrepared, verifiedArtifacts } from './verified.ts'

import type { GcOptions, GcResult } from '../store/contracts.ts'
import type { CommitStep } from './publish.ts'
import type { DatabaseTarget, Head } from './types.ts'

export type CollectionObserver = (step: CommitStep | 'removed') => Promise<void>

async function retain(target: DatabaseTarget, head: Head, keep: number) {
  const retained: string[] = []
  const artifacts = new Set<string>()

  for await (const { digest, revision } of committed(target, head)) {
    const prepared = await verifiedArtifacts(target, revision)

    releasePrepared(prepared)
    retained.push(digest)
    artifacts.add(`revisions/${digest}.rev`)
    artifacts.add(`snapshots/${revision.snapshot}.tnt`)
    artifacts.add(`sources/${revision.archive}.src`)

    if (retained.length === keep) {
      break
    }
  }

  return { retained, artifacts }
}

async function collectLocked(
  options: GcOptions,
  observe?: CollectionObserver
): Promise<GcResult> {
  const head = await readHead(options)

  if (head === undefined) {
    throw new Error('database not initialized; migrate legacy stores first')
  }

  const keep = await retain(options, head, options.keep ?? DEFAULT_KEEP)
  const legacy = Bun.file(currentFile(options.root, options.tenant))

  if (await legacy.exists()) {
    const snapshot = (await legacy.text()).trim()

    assertHash(snapshot)
    keep.artifacts.add(`snapshots/${snapshot}.tnt`)
  }

  for (const reference of head.imports ?? []) {
    await readImport(options, reference)
    keep.artifacts.add(`imports/${reference.mapping}.imp`)
  }

  const candidates = await garbage(options, keep.artifacts)
  const dryRun = options.dryRun === true

  if (!dryRun) {
    await replaceHead(options, { ...head, retained: keep.retained }, observe)
  }

  const swept = await sweep(options, candidates, {
    dryRun,
    observe: async () => observe?.('removed')
  })

  return {
    ...swept,
    tenant: options.tenant,
    current: head.snapshot,
    currentCorrupt: false,
    kept: keep.retained.length,
    corrupt: []
  }
}

export async function collect(
  options: GcOptions,
  observe?: CollectionObserver
): Promise<GcResult> {
  const keep = options.keep ?? DEFAULT_KEEP

  if (!Number.isSafeInteger(keep) || keep < 1) {
    throw new Error('database gc keep must be a positive integer')
  }

  const releaseWriter = await lock(`${directory(options)}/writer.lock`)

  try {
    await observe?.('locked')

    const releaseReaders = await lock(`${directory(options)}/retention.lock`)

    try {
      return await collectLocked(options, observe)
    } finally {
      releaseReaders()
    }
  } finally {
    releaseWriter()
  }
}
