import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { readSource, transact } from '../src/db/api.ts'
import { hash } from '../src/db/format.ts'
import { directory, readHead } from '../src/db/head.ts'
import { pinReader } from '../src/db/reader.ts'

import type { DatabaseTarget } from '../src/db/types.ts'
import type { TransactionRequest } from '../src/types.ts'

let target: DatabaseTarget

beforeEach(async () => {
  target = {
    root: await mkdtemp(`${tmpdir()}/langonrock-recovery-`),
    tenant: 'crash'
  }
})
afterEach(async () => rm(target.root, { recursive: true, force: true }))

function worker(request: TransactionRequest, stop?: string) {
  return Bun.spawn(
    [
      process.execPath,
      `${import.meta.dir}/helpers/db-worker.ts`,
      JSON.stringify({ target, request, stop })
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe'
    }
  )
}

const create = (path: string, content: string) => ({
  operation: 'write' as const,
  bundle: 'docs',
  path,
  content
})

test('forced exits at each commit boundary preserve a complete root and permit recovery', async () => {
  const steps = [
    'locked',
    'snapshot',
    'archive',
    'revision',
    'head-ready',
    'head-replaced',
    'durable'
  ]

  for (const [index, stop] of steps.entries()) {
    const path = `doc${index}.md`
    const initial = await transact(target, { changes: [create(path, 'old')] })
    const child = worker(
      { changes: [{ ...create(path, 'new'), replaces: hash('old') }] },
      stop
    )
    const stdout = child.stdout.getReader()

    try {
      const ready = await stdout.read()

      expect(new TextDecoder().decode(ready.value)).toBe('ready\n')
    } finally {
      stdout.releaseLock()
      child.kill('SIGKILL')
      await child.exited
    }

    const published = stop === 'head-replaced' || stop === 'durable'

    expect((await readSource(target, 'docs', path))?.content).toBe(
      published ? 'new' : 'old'
    )

    if (!published) {
      expect((await readHead(target))?.revision).toBe(initial.revision)
    }

    for (let reopen = 0; reopen < 2; reopen++) {
      const reader = await pinReader(target)

      expect(reader.ids).toContain(`doc${index}`)
      reader.close()
    }

    await transact(target, {
      changes: [create(`after${index}.md`, 'writer lock recovered')]
    })
  }
})

test('independent processes cannot both overwrite the same expected revision', async () => {
  const initial = await transact(target, { changes: [create('a.md', 'old')] })
  const children = ['one', 'two', 'three'].map(content =>
    worker({
      expectedRevision: initial.revision,
      changes: [{ ...create('a.md', content), replaces: hash('old') }]
    })
  )
  const codes = await Promise.all(
    children.map(async child => {
      await new Response(child.stdout).text()
      await new Response(child.stderr).text()

      return child.exited
    })
  )

  expect(codes.filter(code => code === 0)).toHaveLength(1)
  expect(codes.filter(code => code !== 0)).toHaveLength(2)
  expect(['one', 'two', 'three']).toContain(
    (await readSource(target, 'docs', 'a.md'))?.content ?? ''
  )
})

test('a corrupt committed head fails closed instead of selecting an older artifact', async () => {
  await transact(target, { changes: [create('a.md', 'old')] })
  await transact(target, {
    changes: [{ ...create('a.md', 'new'), replaces: hash('old') }]
  })
  await Bun.write(`${directory(target)}/HEAD`, 'interrupted or corrupt head')
  await expect(pinReader(target)).rejects.toThrow('corruption')
  await expect(
    transact(target, { changes: [create('b.md', 'must not commit')] })
  ).rejects.toThrow('corruption')
})
