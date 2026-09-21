import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { readSource, transact } from '../src/db/api.ts'
import { hash } from '../src/db/format.ts'
import { collect } from '../src/db/gc.ts'
import { artifact, directory, readHead } from '../src/db/head.ts'
import { history } from '../src/db/history.ts'
import { pinReader } from '../src/db/reader.ts'
import { restore } from '../src/db/restore.ts'
import { lock } from '../src/db/platform.ts'

import type { DatabaseTarget } from '../src/db/types.ts'

let target: DatabaseTarget

beforeEach(async () => {
  target = { root: await mkdtemp(`${tmpdir()}/langonrock-gc-`), tenant: 'test' }
})
afterEach(async () => rm(target.root, { recursive: true, force: true }))

const write = (path: string, content: string) => ({
  operation: 'write' as const,
  bundle: 'docs',
  path,
  content
})

async function revisions(count: number) {
  const result = []

  for (let index = 0; index < count; index++) {
    result.push(
      await transact(target, {
        changes: [write(`${index}.md`, `body ${index}`)]
      })
    )
  }

  return result
}

test('dry-run predicts collection without changing head or deleting abandoned staging', async () => {
  await revisions(4)
  await Bun.write(
    `${directory(target)}/staging/abandoned/file`,
    'partial write'
  )

  const before = await readHead(target)
  const preview = await collect({ ...target, keep: 2, dryRun: true })

  expect(await readHead(target)).toEqual(before)
  expect(preview.kept).toBe(2)
  expect(preview.removed).toHaveLength(6)
  expect(preview.partials).toEqual(['staging/abandoned'])
  expect(
    await Bun.file(`${directory(target)}/staging/abandoned/file`).text()
  ).toBe('partial write')

  const actual = await collect({ ...target, keep: 2 })

  expect(actual).toEqual(preview)
  expect(await readdir(`${directory(target)}/staging`)).toEqual([])
  expect((await history(target)).revisions).toHaveLength(2)
  expect((await collect({ ...target, keep: 2 })).removed).toEqual([])
})

test('default collection retains ten complete revisions and repeated collections preserve restore', async () => {
  const commits = await revisions(12)
  const oldestKept = commits[2]
  const current = commits.at(-1)

  expect((await collect(target)).kept).toBe(10)
  expect((await history(target)).revisions.map(item => item.revision)).toEqual(
    commits
      .slice(2)
      .reverse()
      .map(item => item.revision)
  )
  await collect({ ...target, keep: 20 })
  expect((await history(target)).revisions).toHaveLength(10)

  const restored = await restore(target, {
    revision: oldestKept?.revision ?? '',
    expectedRevision: current?.revision ?? ''
  })

  expect(restored.snapshot).toBe(oldestKept?.snapshot ?? '')
  expect(await readSource(target, 'docs', '11.md')).toBeUndefined()
  await collect({ ...target, keep: 1 })
  expect((await history(target)).revisions.map(item => item.revision)).toEqual([
    restored.revision
  ])
  expect((await collect({ ...target, keep: 1 })).removed).toEqual([])
  expect((await readSource(target, 'docs', '0.md'))?.content).toBe('body 0')
  await expect(collect({ ...target, keep: 0 })).rejects.toThrow(
    'positive integer'
  )
})

test('a pinned old reader keeps working while its revision is collected', async () => {
  const first = await transact(target, { changes: [write('a.md', 'old text')] })
  const reader = await pinReader(target)

  try {
    await transact(target, {
      changes: [{ ...write('a.md', 'new text'), replaces: hash('old text') }]
    })

    const result = await collect({ ...target, keep: 1 })

    expect((await reader.get(['a'])).get('a')?.text).toBe('old text')
    expect(await reader.manifest()).toContain('a\tdocs')
    expect((await readSource(target, 'docs', 'a.md'))?.content).toBe('new text')

    if (process.platform !== 'win32') {
      expect(
        await Bun.file(artifact(target, 'snapshot', first.snapshot)).exists()
      ).toBe(false)
    } else {
      expect(result.removed.length + result.skipped.length).toBe(3)
    }
  } finally {
    reader.close()
  }
})

test('collection waits for writer and reader-opening locks without reclaiming live staging', async () => {
  await revisions(2)

  const releaseWriter = await lock(`${directory(target)}/writer.lock`)
  let finished = false

  await Bun.write(`${directory(target)}/staging/live/file`, 'owned by writer')

  const pending = collect({ ...target, keep: 1 }).then(result => {
    finished = true

    return result
  })

  await Bun.sleep(20)
  expect(finished).toBe(false)
  expect(
    await Bun.file(`${directory(target)}/staging/live/file`).exists()
  ).toBe(true)

  const releaseOpening = await lock(`${directory(target)}/retention.lock`, true)

  releaseWriter()
  await Bun.sleep(20)
  expect(finished).toBe(false)
  releaseOpening()
  await pending
  expect(finished).toBe(true)
})

test('corrupt retained artifacts abort collection before publishing a boundary', async () => {
  const commits = await revisions(3)
  const head = await readHead(target)

  await Bun.write(
    artifact(target, 'snapshot', commits[1]?.snapshot ?? ''),
    'broken'
  )
  await expect(collect({ ...target, keep: 2 })).rejects.toThrow('digest')
  expect(await readHead(target)).toEqual(head)
  expect(await readdir(`${directory(target)}/revisions`)).toHaveLength(3)
})

test('forced exit at every collection boundary leaves retained history restorable', async () => {
  for (const stop of [
    'locked',
    'head-ready',
    'head-replaced',
    'durable',
    'removed'
  ]) {
    const commits = await revisions(3)
    const child = Bun.spawn(
      [
        process.execPath,
        `${import.meta.dir}/helpers/gc-worker.ts`,
        JSON.stringify({ target, stop })
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    const stdout = child.stdout.getReader()

    try {
      expect(new TextDecoder().decode((await stdout.read()).value)).toBe(
        'ready\n'
      )
    } finally {
      stdout.releaseLock()
      child.kill('SIGKILL')
      await child.exited
    }

    const head = await readHead(target)

    expect(head?.revision).toBe(commits.at(-1)?.revision)
    await collect({ ...target, keep: 2 })
    await collect({ ...target, keep: 2 })
    expect((await history(target)).revisions).toHaveLength(2)
    await restore(target, {
      revision: commits[1]?.revision ?? '',
      expectedRevision: head?.revision ?? ''
    })
    expect(await readSource(target, 'docs', '2.md')).toBeUndefined()
    await rm(`${directory(target)}`, { recursive: true })
  }
})
