import { importInitial, readSource, transact } from '../../src/db/api.ts'
import { hash } from '../../src/db/format.ts'
import { history } from '../../src/db/history.ts'
import { pinReader } from '../../src/db/reader.ts'
import { restore } from '../../src/db/restore.ts'
import { measure } from '../dbms/metrics.ts'
import { check, memory, sample } from './types.ts'

import type { DocumentChange, RevisionResult } from '../../src/types.ts'
import type { Request, Sample } from './types.ts'

function content(index: number, version: number): string {
  return `---\ntype: concept\n---\n# Atomic ${index}\nversion ${version}\n`
}

function changes(bundle: string, version: number): DocumentChange[] {
  return Array.from({ length: 25 }, (_, index) => ({
    operation: 'write',
    bundle,
    path: `atomic-${index}.md`,
    content: content(index, version),
    ...(version === 0 ? {} : { replaces: hash(content(index, version - 1)) })
  }))
}

async function batches(input: Request, first: RevisionResult, result: Sample) {
  let current = first

  for (let version = 0; version < 10; version++) {
    const request = {
      expectedRevision: current.revision,
      changes: changes(input.bundle, version)
    }
    const elapsed = await measure(async () => {
      current = await transact(input.target, request)
    })
    const metric = version === 0 ? 'batchCreate25' : 'batchReplace25'

    ;(result.timings[metric] ??= []).push(elapsed)

    for (const change of request.changes) {
      const stored = await readSource(input.target, change.bundle, change.path)

      check(
        stored?.hash ===
          hash(content(Number(change.path.slice(7, -3)), version)),
        'atomic batch source mismatch'
      )
    }
  }

  return current
}

async function pages(input: Request, result: Sample): Promise<void> {
  let next: string | undefined
  let first: string | undefined

  result.timings['historyFirst5'] = [
    await measure(async () => {
      const page = await history(input.target, { limit: 5 })

      check(
        page.revisions.length === 5 && page.next,
        'first history page incomplete'
      )
      first = page.revisions.at(-1)?.parent ?? undefined
      next = page.next
    })
  ]
  check(next !== undefined, 'missing history cursor')
  const before = next

  result.timings['historyNext5'] = [
    await measure(async () => {
      const page = await history(input.target, { limit: 5, before })

      check(
        page.revisions.length === 5 && page.revisions[0]?.revision === first,
        'history pagination skipped or repeated a revision'
      )
    })
  ]
}

export async function maintenance(input: Request): Promise<Sample> {
  const first = await importInitial(input.target, input.source)
  const original = await pinReader(input.target)
  const manifest = await original.manifest()
  const result = sample()

  original.close()
  const current = await batches(input, first, result)

  await pages(input, result)
  result.timings['restore'] = [
    await measure(async () => {
      const restored = await restore(input.target, {
        revision: first.revision,
        expectedRevision: current.revision
      })

      check(
        restored.snapshot === first.snapshot &&
          restored.revision !== first.revision,
        'restore did not publish the original state as a new revision'
      )
    })
  ]
  check(
    (await history(input.target, { limit: 1 })).revisions[0]?.parent ===
      current.revision,
    'restore parent is not the previous current revision'
  )
  const reader = await pinReader(input.target)

  check((await reader.manifest()) === manifest, 'restored manifest mismatch')
  check(
    (await readSource(input.target, input.bundle, 'atomic-0.md')) === undefined,
    'restored database retained a created document'
  )
  result.checks = {
    batches: 10,
    documentsPerBatch: 25,
    revisions: 12,
    manifestBytes: Buffer.byteLength(manifest),
    manifestTokenEstimate: Math.ceil(manifest.length / 4),
    manifestHash: hash(manifest),
    head: reader.head.revision
  }
  reader.close()

  return { ...result, ...memory() }
}
