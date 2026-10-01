import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openTenant } from '../src/db/open.ts'
import { open } from '../src/client/connection.ts'
import { isIgnored, watchTenant } from '../src/store/watch.ts'

import type { PutResult } from '../src/store/writer.ts'
import type { Watcher } from '../src/store/watch.ts'

let scratch = ''

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-watch-'))
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

function md(description: string, body = ''): string {
  return `---\ntype: Table\ndescription: ${description}\n---\n\n${body}`
}

async function seed(name: string): Promise<{ source: string; root: string }> {
  const source = join(scratch, name, 'src')
  const root = join(scratch, name, 'data')

  await mkdir(join(source, 'sales'), { recursive: true })
  await writeFile(join(source, 'sales', 'orders.md'), md('Orders.'))

  return { source, root }
}

/**
 * FSEvents replays recent changes when a recursive watch starts, so the writes
 * made while seeding arrive after `ready` resolves. Harmless in production
 * because an unchanged tree reuses its snapshot, but tests that count syncs
 * have to let that churn finish first.
 */
async function settle(): Promise<void> {
  await Bun.sleep(300)
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 4000
): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the watcher')
    }

    await Bun.sleep(20)
  }
}

describe('watchTenant', () => {
  let watcher: Watcher | undefined

  afterAll(() => watcher?.close())

  test('populates the store before ready resolves', async () => {
    const { source, root } = await seed('initial')
    const syncs: PutResult[] = []

    watcher = watchTenant({
      source,
      root,
      tenant: 'acme',
      debounceMs: 20,
      rescanMs: 60_000,
      onSync: result => syncs.push(result)
    })

    await watcher.ready

    // Not an exact count: every platform replays or coalesces startup events
    // differently, so extra syncs may already have landed. What must hold is
    // that the first one did real work and the store is readable.
    expect(syncs.length).toBeGreaterThanOrEqual(1)
    expect(syncs[0]?.reused).toBe(false)
    expect((await openTenant(root, 'acme')).ids).toEqual(['orders'])

    watcher.close()
    watcher = undefined
  })

  test('syncs even when no onSync callback is supplied', async () => {
    const { source, root } = await seed('no-callback')
    const local = watchTenant({
      source,
      root,
      tenant: 'acme',
      debounceMs: 5000,
      rescanMs: 60_000
    })

    await local.ready

    expect((await openTenant(root, 'acme')).ids).toEqual(['orders'])

    local.close()
  })

  test('picks up a new bundle folder and a new concept', async () => {
    const { source, root } = await seed('changes')
    const syncs: PutResult[] = []
    const local = watchTenant({
      source,
      root,
      tenant: 'acme',
      debounceMs: 20,
      rescanMs: 60_000,
      onSync: result => syncs.push(result)
    })

    await local.ready
    await mkdir(join(source, 'ops'), { recursive: true })
    await writeFile(join(source, 'ops', 'deploy.md'), md('Deploy.'))

    // Wait on the observable outcome, not a sync counter. Startup events can
    // land an extra sync before the new folder exists, which would satisfy a
    // count-based wait while the tree is still one bundle.
    await waitFor(() => syncs.at(-1)?.bundles.length === 2)

    expect(syncs.at(-1)?.bundles).toEqual(['ops', 'sales'])
    expect((await openTenant(root, 'acme')).ids.sort()).toEqual([
      'deploy',
      'orders'
    ])

    local.close()
  })

  test('coalesces a burst of writes into fewer syncs than files', async () => {
    const { source, root } = await seed('burst')
    const syncs: PutResult[] = []
    const local = watchTenant({
      source,
      root,
      tenant: 'acme',
      debounceMs: 120,
      rescanMs: 60_000,
      onSync: result => syncs.push(result)
    })

    await local.ready

    const before = syncs.length

    for (let index = 0; index < 12; index++) {
      await writeFile(
        join(source, 'sales', `burst-${index}.md`),
        md(`Burst ${index}.`)
      )
    }

    await waitFor(() => syncs.length > before)
    await Bun.sleep(300)

    const rebuilds = syncs.length - before

    expect(rebuilds).toBeLessThan(12)
    expect((await openTenant(root, 'acme')).ids).toHaveLength(13)

    local.close()
  })

  test('an unchanged tree reuses the snapshot instead of rewriting', async () => {
    const { source, root } = await seed('rescan')
    const syncs: PutResult[] = []
    const local = watchTenant({
      source,
      root,
      tenant: 'acme',
      debounceMs: 20,
      rescanMs: 50,
      onSync: result => syncs.push(result)
    })

    await local.ready
    await waitFor(() => syncs.length >= 3)

    const first = syncs[0]

    expect(first?.reused).toBe(false)
    expect(syncs.slice(1).every(result => result.reused)).toBe(true)
    expect(
      syncs.slice(1).every(result => result.snapshot === first?.snapshot)
    ).toBe(true)

    local.close()
  })

  test('ignores writes inside dot directories', async () => {
    const { source, root } = await seed('dotfiles')
    const syncs: PutResult[] = []
    const local = watchTenant({
      source,
      root,
      tenant: 'acme',
      debounceMs: 30,
      rescanMs: 60_000,
      onSync: result => syncs.push(result)
    })

    await local.ready
    await settle()

    const before = syncs.length

    await mkdir(join(source, '.git'), { recursive: true })
    await writeFile(join(source, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    await settle()

    expect(syncs.length).toBe(before)

    local.close()
  })

  test('treats an event without a file name as a change', () => {
    // Bun 1.4 on Linux reports deleting the watched folder with no file name.
    expect(isIgnored(undefined)).toBe(false)
    expect(isIgnored(null)).toBe(false)
    expect(isIgnored('sales/orders.md')).toBe(false)
    expect(isIgnored('.git/HEAD')).toBe(true)
    expect(isIgnored('sales\\.obsidian\\workspace')).toBe(true)
  })

  test('reports errors instead of throwing out of the watcher', async () => {
    const { source, root } = await seed('errors')
    const errors: Error[] = []
    // A long debounce keeps the deletion's own events from racing the manual
    // sync, which would otherwise hit the concurrency guard and return early.
    const local = watchTenant({
      source,
      root,
      tenant: 'acme',
      debounceMs: 5000,
      rescanMs: 60_000,
      onError: error => errors.push(error)
    })

    await local.ready
    await rm(source, { recursive: true, force: true })
    await local.sync()

    expect(errors[0]?.message).toContain('ENOENT')

    local.close()
  })

  test('reports a folder/database conflict without overwriting the committed document', async () => {
    const { source, root } = await seed('database-conflict')
    const errors: Error[] = []
    const local = watchTenant({
      source,
      root,
      tenant: 'acme',
      debounceMs: 5000,
      rescanMs: 60_000,
      onError: error => errors.push(error)
    })
    const connection = open(`okf://${root}?tenant=acme`)

    try {
      await local.ready
      const original = await connection.readSource('sales', 'orders.md')

      await connection.writeSource(
        'sales',
        'orders.md',
        md('Database edit.'),
        original?.hash
      )
      await writeFile(join(source, 'sales', 'orders.md'), md('Folder edit.'))
      await local.sync()
      expect(errors.at(-1)?.message).toContain('both changed')
      expect((await connection.readSource('sales', 'orders.md'))?.content).toBe(
        md('Database edit.')
      )
      await writeFile(join(source, 'sales', 'orders.md'), md('Database edit.'))
      await local.sync()
      const revision = (await connection.history()).revisions[0]?.revision

      await local.sync()
      expect((await connection.history()).revisions[0]?.revision).toBe(revision)
    } finally {
      local.close()
      await connection.close()
    }
  })

  /**
   * A caller asking for a sync wants a compile that began after it asked, so
   * returning the run already in flight would hand back a digest taken before
   * their write. One follow-up serves every caller that waited for it.
   */
  test('overlapping syncs share a single follow-up compile', async () => {
    const { source, root } = await seed('coalesce')
    const syncs: PutResult[] = []
    const local = watchTenant({
      source,
      root,
      tenant: 'acme',
      debounceMs: 5000,
      rescanMs: 60_000,
      onSync: result => syncs.push(result)
    })

    await local.ready

    const before = syncs.length

    await Promise.all([local.sync(), local.sync(), local.sync()])

    expect(syncs.length - before).toBe(2)

    local.close()
  })

  test('closing while a sync is queued cancels the follow-up', async () => {
    const { source, root } = await seed('coalesce-close')
    const syncs: PutResult[] = []
    const local = watchTenant({
      source,
      root,
      tenant: 'acme',
      debounceMs: 5000,
      rescanMs: 60_000,
      onSync: result => syncs.push(result)
    })

    await local.ready

    const before = syncs.length
    const overlapping = [local.sync(), local.sync()]

    local.close()
    await Promise.all(overlapping)

    expect(syncs.length - before).toBe(1)
  })

  test('stops syncing after close', async () => {
    const { source, root } = await seed('closed')
    const syncs: PutResult[] = []
    const local = watchTenant({
      source,
      root,
      tenant: 'acme',
      debounceMs: 20,
      rescanMs: 40,
      onSync: result => syncs.push(result)
    })

    await local.ready
    local.close()

    const after = syncs.length

    await writeFile(join(source, 'sales', 'late.md'), md('Late.'))
    await Bun.sleep(200)

    expect(syncs.length).toBe(after)
  })
})
