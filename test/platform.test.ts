import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { flushFile, lock, replaceFile, tryLock } from '../src/db/platform.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(`${tmpdir()}/langonrock-platform-`)
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function owner() {
  const child = Bun.spawn(
    [
      process.execPath,
      `${import.meta.dir}/helpers/lock-worker.ts`,
      `${root}/lock`
    ],
    { stdout: 'pipe', stderr: 'inherit' }
  )
  const reader = child.stdout.getReader()
  const first = await reader.read()

  reader.releaseLock()
  expect(new TextDecoder().decode(first.value)).toContain('ready')

  return child
}

describe('kernel-owned store locks', () => {
  test('does not steal an old lock from a live process', async () => {
    const child = await owner()

    try {
      await utimes(`${root}/lock`, new Date(0), new Date(0))
      expect(tryLock(`${root}/lock`)).toBeUndefined()
    } finally {
      child.kill('SIGKILL')
      await child.exited
    }

    const release = tryLock(`${root}/lock`)

    expect(release).toBeDefined()
    release?.()
    release?.()
  })

  test('permits shared readers and excludes collection until they release', () => {
    const first = tryLock(`${root}/retention`, true)
    const second = tryLock(`${root}/retention`, true)

    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(tryLock(`${root}/retention`)).toBeUndefined()
    first?.()
    expect(tryLock(`${root}/retention`)).toBeUndefined()
    second?.()

    const exclusive = tryLock(`${root}/retention`)

    expect(exclusive).toBeDefined()
    exclusive?.()
  })

  test('waits without blocking the event loop', async () => {
    const release = await lock(`${root}/lock`)

    setTimeout(release, 15)

    const next = await lock(`${root}/lock`)

    next()

    const released = tryLock(`${root}/lock`)

    expect(released).toBeDefined()
    released?.()
  })

  test('reports platform failures and rejects invalid paths', () => {
    expect(() => tryLock(`${root}/missing/lock`)).toThrow()
    expect(() => tryLock(`${root}/invalid\0path`)).toThrow()
    expect(() => flushFile(`${root}/missing`)).toThrow()
    expect(() => replaceFile(`${root}/missing`, `${root}/target`)).toThrow()
  })

  test('flushes complete bytes before replacing an existing path', async () => {
    await Bun.write(`${root}/target`, 'old')
    await Bun.write(`${root}/candidate`, 'new α🙂')
    flushFile(`${root}/candidate`)
    replaceFile(`${root}/candidate`, `${root}/target`)
    flushFile(`${root}/target`)
    expect(await Bun.file(`${root}/target`).text()).toBe('new α🙂')
    expect(await Bun.file(`${root}/candidate`).exists()).toBe(false)
  })
})
