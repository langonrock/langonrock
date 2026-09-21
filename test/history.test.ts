import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { readSource, transact } from '../src/db/api.ts'
import { hash } from '../src/db/format.ts'
import { collect } from '../src/db/gc.ts'
import { artifact, readHead } from '../src/db/head.ts'
import { history } from '../src/db/history.ts'
import { restore } from '../src/db/restore.ts'

import type { DatabaseTarget } from '../src/db/types.ts'

let target: DatabaseTarget

beforeEach(async () => {
  target = {
    root: await mkdtemp(`${tmpdir()}/langonrock-history-`),
    tenant: 'test'
  }
})
afterEach(async () => rm(target.root, { recursive: true, force: true }))

const write = (path: string, content: string) => ({
  operation: 'write' as const,
  bundle: 'docs',
  path,
  content
})

async function revisions(count: number): Promise<string[]> {
  const result: string[] = []

  for (let index = 0; index < count; index++) {
    result.push(
      (
        await transact(target, {
          changes: [write(`${index}.md`, `body ${index}`)]
        })
      ).revision
    )
  }

  return result
}

test('history pages preserve order across new commits and reject invalid or expired cursors', async () => {
  const committed = await revisions(5)
  const first = await history(target, { limit: 2 })

  expect(first.revisions.map(item => item.revision)).toEqual(
    committed.slice(3).reverse()
  )
  await transact(target, {
    changes: [write('new.md', 'newer than the cursor')]
  })

  const second = await history(target, { before: first.next ?? '', limit: 2 })
  const last = await history(target, { before: second.next ?? '', limit: 2 })

  expect(second.revisions.map(item => item.revision)).toEqual(
    committed.slice(1, 3).reverse()
  )
  expect(last.revisions.map(item => item.revision)).toEqual(
    committed.slice(0, 1)
  )
  expect(last.next).toBeUndefined()
  await expect(history(target, { limit: 0 })).rejects.toThrow('limit')
  await expect(history(target, { limit: 101 })).rejects.toThrow('limit')
  await expect(history(target, { before: 'invalid' })).rejects.toThrow('cursor')
  await collect({ ...target, keep: 1 })
  await expect(history(target, { before: first.next ?? '' })).rejects.toThrow(
    'expired'
  )
})

test('prepared orphan revisions never enter history and cannot be restored', async () => {
  const [initial] = await revisions(1)

  await expect(
    transact(
      target,
      { changes: [write('orphan.md', 'never committed')] },
      async step => {
        if (step === 'head-ready') {
          throw new Error('stop')
        }
      }
    )
  ).rejects.toThrow('stop')

  const { readdir } = await import('node:fs/promises')
  const files = await readdir(`${target.root}/tenants/test/revisions`)
  const orphan = files
    .map(name => name.slice(0, -4))
    .find(digest => digest !== initial)

  expect(orphan).toBeDefined()
  expect((await history(target)).revisions.map(item => item.revision)).toEqual([
    initial ?? ''
  ])
  await expect(
    restore(target, { revision: orphan ?? '', expectedRevision: initial ?? '' })
  ).rejects.toThrow('retained committed')
})

test('restore creates a new revision with exact sources across delete, rename, and source-only changes', async () => {
  const original =
    '---\r\ntype: concept\r\ncustom: old\r\n---\r\n# Body\r\n漢字\r\n'
  const first = await transact(target, {
    changes: [write('a.md', original), write('index.md', 'navigation old')]
  })
  const sourceOnly = await transact(target, {
    changes: [
      {
        ...write('index.md', 'navigation new'),
        replaces: hash('navigation old')
      }
    ]
  })

  expect(sourceOnly.snapshot).toBe(first.snapshot)
  expect(sourceOnly.revision).not.toBe(first.revision)

  const renamed = await transact(target, {
    changes: [
      {
        operation: 'delete',
        bundle: 'docs',
        path: 'a.md',
        replaces: hash(original)
      },
      write('nested/renamed.md', '# Changed'),
      write('created.md', '# Created')
    ]
  })
  const restored = await restore(target, {
    revision: first.revision,
    expectedRevision: renamed.revision
  })

  expect(restored.snapshot).toBe(first.snapshot)
  expect(restored.revision).not.toBe(first.revision)
  expect((await history(target)).revisions[0]?.parent).toBe(renamed.revision)
  expect((await readSource(target, 'docs', 'a.md'))?.content).toBe(original)
  expect((await readSource(target, 'docs', 'index.md'))?.content).toBe(
    'navigation old'
  )
  expect(await readSource(target, 'docs', 'nested/renamed.md')).toBeUndefined()
  expect(await readSource(target, 'docs', 'created.md')).toBeUndefined()
  await expect(
    restore(target, {
      revision: sourceOnly.revision,
      expectedRevision: renamed.revision
    })
  ).rejects.toThrow('changed')

  const restoredNavigation = await restore(target, {
    revision: sourceOnly.revision,
    expectedRevision: restored.revision
  })

  expect(restoredNavigation.snapshot).toBe(first.snapshot)
  expect((await readSource(target, 'docs', 'index.md'))?.content).toBe(
    'navigation new'
  )
})

test('restore verifies retained artifact bytes before changing the current head', async () => {
  const first = await transact(target, { changes: [write('a.md', '# old')] })
  const current = await transact(target, {
    changes: [{ ...write('a.md', '# current'), replaces: hash('# old') }]
  })

  await Bun.write(
    artifact(target, 'snapshot', first.snapshot),
    'corrupt snapshot'
  )
  await expect(
    restore(target, {
      revision: first.revision,
      expectedRevision: current.revision
    })
  ).rejects.toThrow('digest')
  expect((await readHead(target))?.revision).toBe(current.revision)
  expect((await readSource(target, 'docs', 'a.md'))?.content).toBe('# current')
})
