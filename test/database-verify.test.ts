import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { readSource, transact } from '../src/db/api.ts'
import { frame, hash } from '../src/db/format.ts'
import { artifact, directory, encodeHead, readHead } from '../src/db/head.ts'
import { history } from '../src/db/history.ts'
import { pinReader } from '../src/db/reader.ts'
import { repair } from '../src/db/repair.ts'
import { encodeRevision, readRevision } from '../src/db/revision.ts'
import { decodeSources } from '../src/db/sourcearchive.ts'
import { verify } from '../src/db/verify.ts'

import type { DatabaseTarget } from '../src/db/types.ts'

let target: DatabaseTarget

beforeEach(async () => {
  target = {
    root: await mkdtemp(`${tmpdir()}/langonrock-verify-`),
    tenant: 'test'
  }
})
afterEach(async () => rm(target.root, { recursive: true, force: true }))

const write = (content: string) => ({
  operation: 'write' as const,
  bundle: 'docs',
  path: 'a.md',
  content
})

test('full verification checks every retained revision without using cached writer metadata', async () => {
  const first = await transact(target, { changes: [write('first')] })
  const current = await transact(target, {
    changes: [{ ...write('current'), replaces: hash('first') }]
  })

  expect(await verify(target)).toMatchObject({
    ok: true,
    verifiedRevisions: [current.revision, first.revision],
    issues: []
  })

  const head = await readHead(target)

  await Bun.write(
    artifact(target, 'archive', head?.archive ?? ''),
    'broken archive behind writer cache'
  )

  const result = await verify(target)

  expect(result.ok).toBe(false)
  expect(result.verifiedRevisions).toEqual([first.revision])
  expect(result.issues[0]?.message).toContain('digest mismatch')
})

test('cached writer metadata cannot bypass changed root checksums or source identities', async () => {
  await transact(target, { changes: [write('first')] })
  await transact(target, {
    changes: [{ ...write('cached'), replaces: hash('first') }]
  })
  const head = await readHead(target)

  if (head === undefined) {
    throw new Error('missing committed head')
  }

  const path = `${directory(target)}/HEAD`

  await Bun.write(
    path,
    encodeHead({
      ...head,
      checksums: {
        ...head.checksums,
        directory: (head.checksums.directory + 1) >>> 0
      }
    })
  )
  await expect(pinReader(target)).rejects.toThrow('checksum')
  await Bun.write(
    path,
    encodeHead({ ...head, archive: hash('missing archive') })
  )
  await expect(readSource(target, 'docs', 'a.md')).rejects.toThrow()
  await Bun.write(path, encodeHead(head))
  expect((await readSource(target, 'docs', 'a.md'))?.content).toBe('cached')
})

test('verification refuses an oversized root before reading the whole file', async () => {
  await transact(target, { changes: [write('retained')] })
  await truncate(`${directory(target)}/HEAD`, 128 * 1024 * 1024)
  await expect(verify(target)).rejects.toThrow('size limit')
})

test('repair requires an exact head precondition, preserves the bad head, and selects an explicitly verified revision', async () => {
  const first = await transact(target, { changes: [write('first')] })
  const current = await transact(target, {
    changes: [{ ...write('current'), replaces: hash('first') }]
  })
  const before = await verify(target)

  await Bun.write(`${directory(target)}/HEAD`, 'corrupted root')
  await expect(pinReader(target)).rejects.toThrow('corruption')

  const corrupted = await verify(target)
  const candidate = await verify(target, { revision: first.revision })

  expect(corrupted.ok).toBe(false)
  expect(corrupted.headHash).toBe(hash('corrupted root'))
  expect(candidate.ok).toBe(true)
  expect(candidate.verifiedRevisions).toEqual([first.revision])
  await expect(
    repair(target, {
      revision: first.revision,
      expectedHeadHash: before.headHash
    })
  ).rejects.toThrow('head changed')
  await repair(target, {
    revision: first.revision,
    expectedHeadHash: corrupted.headHash
  })
  expect((await readSource(target, 'docs', 'a.md'))?.content).toBe('first')
  expect((await history(target)).revisions.map(item => item.revision)).toEqual([
    first.revision
  ])
  expect(
    await Bun.file(
      `${directory(target)}/recovery/${hash('corrupted root')}.head`
    ).text()
  ).toBe('corrupted root')
  expect(
    await Bun.file(artifact(target, 'revision', current.revision)).exists()
  ).toBe(true)
  expect((await verify(target)).ok).toBe(true)
  await transact(target, {
    changes: [{ ...write('after repair'), replaces: hash('first') }]
  })
  expect((await history(target)).revisions).toHaveLength(2)
})

test('repair refuses corrupt selected artifacts and supports an explicitly missing head', async () => {
  const first = await transact(target, { changes: [write('first')] })
  const current = await transact(target, {
    changes: [{ ...write('current'), replaces: hash('first') }]
  })

  await Bun.write(artifact(target, 'snapshot', current.snapshot), 'corrupt')

  const state = await verify(target)

  await expect(
    repair(target, {
      revision: current.revision,
      expectedHeadHash: state.headHash
    })
  ).rejects.toThrow('digest')
  expect(await readdir(`${directory(target)}/revisions`)).toHaveLength(2)
  await rm(`${directory(target)}/HEAD`)
  expect(await verify(target)).toMatchObject({ ok: false, headHash: null })
  await repair(target, { revision: first.revision, expectedHeadHash: null })
  expect((await readSource(target, 'docs', 'a.md'))?.content).toBe('first')
})

test('verification rejects consistent file hashes with inconsistent source-to-snapshot mappings', async () => {
  const initial = await transact(target, { changes: [write('body')] })
  const revision = await readRevision(target, initial.revision)
  const archive = decodeSources(
    new Uint8Array(
      await Bun.file(
        artifact(target, 'archive', revision.archive)
      ).arrayBuffer()
    )
  )
  const source = archive.entries[0]

  if (source?.body === undefined) {
    throw new Error('missing test source')
  }

  source.body.offset++

  const bytes = frame(
    'LRS1',
    { entries: archive.entries, bundles: archive.bundles },
    [archive.payload]
  )
  const altered = { ...revision, archive: hash(bytes) }
  const descriptor = encodeRevision(altered)
  const digest = hash(descriptor)

  await Bun.write(artifact(target, 'archive', altered.archive), bytes)
  await Bun.write(artifact(target, 'revision', digest), descriptor)

  const result = await verify(target, { revision: digest })

  expect(result.ok).toBe(false)
  expect(result.issues[0]?.message).toContain('source body differs')
  expect((await readHead(target))?.revision).toBe(initial.revision)
})
