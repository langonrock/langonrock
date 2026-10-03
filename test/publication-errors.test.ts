import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'

import { transact } from '../src/db/api.ts'
import { readHead } from '../src/db/head.ts'

import type NativeBinding from '../native/bin/store-platform.node'
import type { DatabaseTarget } from '../src/db/types.ts'
import type { CommitStep } from '../src/db/publish.ts'

const binding = createRequire(import.meta.url)(
  '../native/bin/store-platform.node'
) as typeof NativeBinding
let target: DatabaseTarget

beforeEach(async () => {
  target = {
    root: await mkdtemp(`${tmpdir()}/langonrock-publication-error-`),
    tenant: 'test'
  }
})

afterEach(async () => rm(target.root, { recursive: true, force: true }))

async function releaseFailure(stop?: CommitStep) {
  const original = binding.release
  const mocked = spyOn(binding, 'release').mockImplementation(handle => {
    original(handle)
    throw new Error('injected lock close failure')
  })

  try {
    return await transact(
      target,
      {
        changes: [
          { operation: 'write', bundle: 'docs', path: 'a.md', content: 'A' }
        ]
      },
      step => {
        if (step === stop) {
          return Promise.reject(new Error(`injected ${stop} failure`))
        }

        return Promise.resolve()
      }
    ).catch((error: unknown) => error)
  } finally {
    mocked.mockRestore()
  }
}

test('a lock cleanup failure after publication carries the committed revision', async () => {
  const error = await releaseFailure()

  expect(error).toMatchObject({
    code: 'INDETERMINATE_COMMIT',
    revision: (await readHead(target))?.revision
  })
})

test('lock cleanup cannot hide an indeterminate publication outcome', async () => {
  const error = await releaseFailure('head-replaced')

  expect(error).toMatchObject({
    code: 'INDETERMINATE_COMMIT',
    revision: (await readHead(target))?.revision,
    cause: new Error('injected head-replaced failure')
  })
})

test('lock cleanup preserves the primary failure before publication', async () => {
  expect(await releaseFailure('locked')).toEqual(
    new Error('injected locked failure')
  )
  expect(await readHead(target)).toBeUndefined()
})
