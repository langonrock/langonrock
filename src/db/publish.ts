import { mkdir, rm } from 'node:fs/promises'

import {
  ConflictError,
  IndeterminateCommitError,
  corruption
} from './errors.ts'
import { hash } from './format.ts'
import { artifact, directory, encodeHead, readHead } from './head.ts'
import { ensureLayout } from './layout.ts'
import { updatedImports } from './importstate.ts'
import { flushFile, lock, replaceFile } from './platform.ts'
import { encodeRevision, revisionResult } from './revision.ts'
import { writeStage } from './staging.ts'
import { currentFile } from '../store/paths.ts'

import type { RevisionResult } from '../types.ts'
import type { DatabaseTarget, Head, Prepared, Revision } from './types.ts'

export type CommitStep =
  | 'locked'
  | 'snapshot'
  | 'archive'
  | 'revision'
  | 'import'
  | 'head-ready'
  | 'head-replaced'
  | 'durable'
export type CommitObserver = (step: CommitStep) => Promise<void>

interface Candidate {
  base: Head | undefined
  prepared: Prepared
  observe?: CommitObserver
  expectedLegacy?: string
}

async function install(
  path: string,
  bytes: Uint8Array,
  stage: string
): Promise<void> {
  const file = Bun.file(path)

  if (await file.exists()) {
    if (hash(new Uint8Array(await file.arrayBuffer())) !== hash(bytes)) {
      throw corruption(`existing artifact differs: ${path}`)
    }

    return
  }

  await writeStage(stage, bytes)
  replaceFile(stage, path)
}

async function publishHead(
  target: DatabaseTarget,
  head: Head,
  stage: string,
  observe?: CommitObserver
): Promise<void> {
  const path = `${directory(target)}/HEAD`

  await writeStage(stage, encodeHead(head), 'ordered')
  await observe?.('head-ready')

  try {
    replaceFile(stage, path)
    await observe?.('head-replaced')
    flushFile(path)
    await observe?.('durable')
  } catch (cause) {
    throw new IndeterminateCommitError(head.revision, cause)
  }
}

export async function replaceHead(
  target: DatabaseTarget,
  head: Head,
  observe?: CommitObserver
): Promise<void> {
  const stage = `${directory(target)}/staging/head-${crypto.randomUUID()}`

  try {
    await publishHead(target, head, stage, observe)
  } finally {
    await rm(stage, { force: true }).catch(() => undefined)
  }
}

function makeRevision(candidate: Candidate): Revision {
  const { base, prepared } = candidate

  return {
    version: 1,
    parent: base?.revision ?? null,
    snapshot: prepared.snapshot,
    archive: prepared.archive,
    concepts: prepared.concepts,
    bundles: prepared.bundles,
    diagnostics: prepared.diagnostics,
    summaryWidth: prepared.summaryWidth,
    checksums: prepared.checksums,
    created: new Date().toISOString()
  }
}

async function installRevision(
  target: DatabaseTarget,
  candidate: Candidate,
  stage: string
): Promise<RevisionResult> {
  const { base, prepared, observe } = candidate
  const revision = makeRevision(candidate)
  const bytes = encodeRevision(revision)
  const digest = hash(bytes)
  const imports = updatedImports(base?.imports, prepared.imports)

  const artifacts = [
    {
      kind: 'snapshot' as const,
      digest: prepared.snapshot,
      bytes: prepared.snapshotBytes
    },
    {
      kind: 'archive' as const,
      digest: prepared.archive,
      bytes: prepared.archiveBytes
    },
    { kind: 'revision' as const, digest, bytes },
    ...(prepared.imports ?? []).map(item => ({
      kind: 'import' as const,
      digest: item.reference.mapping,
      bytes: item.bytes
    }))
  ]
  const unique = new Map(
    artifacts.map(item => [`${item.kind}/${item.digest}`, item])
  )
  const installed = await Promise.allSettled(
    [...unique.values()].map(async item => {
      await install(
        artifact(target, item.kind, item.digest),
        item.bytes,
        `${stage}/${item.kind}-${item.digest}`
      )
      await observe?.(item.kind)
    })
  )

  for (const result of installed) {
    if (result.status === 'rejected') {
      throw result.reason
    }
  }

  const head: Head = {
    version: 1,
    revision: digest,
    snapshot: prepared.snapshot,
    archive: prepared.archive,
    checksums: prepared.checksums,
    ...(imports === undefined ? {} : { imports })
  }

  if (base?.retained !== undefined) {
    head.retained = [...base.retained, digest]
  }

  await publishHead(target, head, `${stage}/HEAD`, observe)

  return revisionResult(revision, digest)
}

function releaseWriter(
  release: () => void,
  result: RevisionResult | undefined
): void {
  try {
    release()
  } catch (cause) {
    if (result !== undefined) {
      throw new IndeterminateCommitError(result.revision, cause)
    }
  }
}

export async function publish(
  target: DatabaseTarget,
  candidate: Candidate
): Promise<RevisionResult> {
  if (candidate.base === undefined) {
    ensureLayout(target)
  }

  const release = await lock(`${directory(target)}/writer.lock`)
  const stage = `${directory(target)}/staging/${crypto.randomUUID()}`
  let result: RevisionResult | undefined

  try {
    const current = await readHead(target)

    if (current?.revision !== candidate.base?.revision) {
      throw new ConflictError()
    }

    if (
      current === undefined &&
      candidate.expectedLegacy === undefined &&
      (await Bun.file(currentFile(target.root, target.tenant)).exists())
    ) {
      throw new ConflictError(
        'legacy tenant appeared during preparation; migrate original sources before writing'
      )
    }

    if (
      candidate.expectedLegacy !== undefined &&
      (
        await Bun.file(currentFile(target.root, target.tenant)).text()
      ).trim() !== candidate.expectedLegacy
    ) {
      throw new ConflictError(
        'legacy snapshot changed during migration; verify originals and retry'
      )
    }

    await candidate.observe?.('locked')
    await mkdir(stage)

    result = await installRevision(
      target,
      { ...candidate, base: current },
      stage
    )

    return result
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined)
    releaseWriter(release, result)
  }
}
