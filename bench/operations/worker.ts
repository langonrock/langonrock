import { createInterface } from 'node:readline'

import { readSource, commit, transact } from '../../src/db/api.ts'
import { readBase } from '../../src/db/base.ts'
import { ConflictError } from '../../src/db/errors.ts'
import { collect } from '../../src/db/gc.ts'
import { pinReader } from '../../src/db/reader.ts'
import { prepareChanges } from '../../src/db/transaction.ts'
import { verify } from '../../src/db/verify.ts'
import { buildTenantIndex } from '../../src/search/tenant.ts'
import { disk } from '../dbms/fixtures.ts'
import { fixEvaluationDate } from '../dbms/clock.ts'
import { measure } from '../dbms/metrics.ts'
import { maintenance } from './maintenance.ts'
import { check, emit, memory, sample } from './types.ts'

import type { Request } from './types.ts'

const input = JSON.parse(Bun.argv[2] ?? '{}') as Request
const lines = createInterface({ input: process.stdin })
const commands = lines[Symbol.asyncIterator]()

fixEvaluationDate()

async function barrier(): Promise<void> {
  emit({ ready: true })
  check((await commands.next()).value === 'sample', 'missing memory barrier')
  emit(memory())
  check((await commands.next()).value === 'go', 'missing execution barrier')
}

async function writeRequest() {
  const source = await readSource(input.target, input.bundle, input.path)

  check(source !== undefined, 'missing contention source')

  return {
    changes: [
      {
        operation: 'write' as const,
        bundle: input.bundle,
        path: input.path,
        content: `${source.content}\nwriter ${input.label}\n`,
        replaces: source.hash
      }
    ]
  }
}

async function writer(): Promise<void> {
  const request = await writeRequest()
  const data = await readBase(input.target)
  const candidate = {
    base: data.head,
    prepared: prepareChanges(data, request.changes, input.target.tenant)
  }

  data.release()
  await barrier()
  const started = Bun.nanoseconds()

  try {
    const result = await commit(input.target, candidate)

    emit({
      outcome: 'committed',
      revision: result.revision,
      elapsed: (Bun.nanoseconds() - started) / 1e6,
      ...memory()
    })
  } catch (cause) {
    if (!(cause instanceof ConflictError)) {
      throw cause
    }

    emit({
      outcome: 'conflict',
      elapsed: (Bun.nanoseconds() - started) / 1e6,
      ...memory()
    })
  }
}

async function reader(): Promise<void> {
  const pinned = await pinReader(input.target)
  const index = await buildTenantIndex(pinned)
  const path = input.path.slice(0, -3)
  const stem = path.split('/').at(-1) ?? ''
  const id = [
    stem,
    path,
    `${input.bundle}/${stem}`,
    `${input.bundle}/${path}`
  ].find(candidate => pinned.ids.includes(candidate))

  check(id !== undefined, 'fixture target has no compiled identity')
  const ids = [id]
  const original = JSON.stringify([...(await pinned.get(ids))])

  await barrier()
  check(
    (await commands.next()).value === 'verify',
    'missing reader verification'
  )
  check(
    JSON.stringify([...(await pinned.get(ids))]) === original,
    'pinned reader changed during competing writes'
  )
  check(index.snapshot === pinned.snapshot, 'reader index snapshot mismatch')
  emit({ outcome: 'pinned', revision: pinned.head.revision, ...memory() })
  pinned.close()
}

async function crash(): Promise<void> {
  await transact(input.target, await writeRequest(), async step => {
    if (step === 'head-ready') {
      emit({ ready: true })
      await commands.next()
      throw new Error('crash worker must be killed before publication')
    }
  })
  throw new Error('crash writer unexpectedly completed')
}

async function recovery(): Promise<void> {
  const result = sample()

  result.timings['recoveryOpenGet'] = [
    await measure(async () => {
      const pinned = await pinReader(input.target)

      check(
        (await pinned.get(pinned.ids.slice(0, 1))).size === 1,
        'recovery get failed'
      )
      result.checks['head'] = pinned.head.revision
      pinned.close()
    })
  ]
  result.checks['diskBeforeGc'] = await disk(input.target.root)
  result.timings['gcKeep10'] = [
    await measure(async () => {
      const collected = await collect(input.target)

      check(collected.kept === 10, 'default GC did not retain ten revisions')
      result.checks['gc'] = collected
    })
  ]
  result.checks['diskAfterGc'] = await disk(input.target.root)
  const verified = await verify(input.target)

  check(
    verified.ok && verified.verifiedRevisions.length === 10,
    'retained revisions failed verification'
  )
  result.checks['retainedRevisions'] = verified.verifiedRevisions.length
  emit({ ...result, ...memory() })
}

try {
  switch (input.role) {
    case 'maintenance':
      emit(await maintenance(input))
      break
    case 'writer':
      await writer()
      break
    case 'reader':
      await reader()
      break
    case 'crash':
      await crash()
      break
    case 'recovery':
      await recovery()
      break
  }
} finally {
  lines.close()
}
