import { pathToFileURL } from 'node:url'

import { adapter } from '../dbms/adapters.ts'
import { fixEvaluationDate } from '../dbms/clock.ts'
import { disk } from '../dbms/fixtures.ts'
import { EDITS, TENANT, digest } from '../dbms/protocol.ts'
import { check, emit } from './types.ts'

import type { WorkerRequest } from '../dbms/protocol.ts'
import type * as Api from '../../src/index.ts'

const WallDate = Date
const input = JSON.parse(Bun.argv[2] ?? '{}') as WorkerRequest

fixEvaluationDate()
const EvaluationDate = Date
const backend = await adapter(input)
const api = (await import(
  pathToFileURL(`${input.code}/src/index.ts`).href
)) as typeof Api

await backend.put(TENANT)
const original = await backend.original()

try {
  for (let index = 0; index < EDITS; index++) {
    await backend.edit(`${original}\nbenchmarkvisibilitymarker${index}\n`)
  }

  const before = await disk(input.store)
  const source = await disk(input.source)
  const pinned = await backend.reader(TENANT)
  const manifest = digest(await pinned.manifest())

  globalThis.Date = WallDate
  const collected = await api.collect({
    root: input.store,
    tenant: TENANT,
    keep: 10,
    graceMs: 0
  })

  globalThis.Date = EvaluationDate
  check(
    collected.kept === 10 && collected.skipped.length === 0,
    'equal retention did not keep exactly ten snapshots/revisions'
  )
  const current = await backend.reader(TENANT)

  check(
    digest(await current.manifest()) === manifest,
    'GC changed current content'
  )
  backend.closeReader?.(pinned)
  backend.closeReader?.(current)
  emit({
    before,
    after: await disk(input.store),
    source,
    manifest,
    retained: collected.kept,
    edits: EDITS
  })
} finally {
  await backend.restoreSource(original)
}
