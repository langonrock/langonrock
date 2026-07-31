import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { connect } from '../src/client/client.ts'
import { serve } from '../src/server/http.ts'
import { putTenantRoot } from '../src/store/writer.ts'

import type { LangonrockServer } from '../src/server/http.ts'

const ENTRY = `${import.meta.dir}/../src/client/client.ts`

const CONCEPT = `---
type: BigQuery Table
title: Orders
description: One row per completed customer order.
grain: order_id
---

# Schema

One row per order.
`

let scratch = ''
let root = ''
let source = ''
let server: LangonrockServer | undefined

function dsn(): string {
  return `okf+http://127.0.0.1:${server?.port}/?token=tok`
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-client-'))
  root = join(scratch, 'data')
  source = join(scratch, 'sources', 'acme')

  await mkdir(join(source, 'sales'), { recursive: true })
  await mkdir(root, { recursive: true })
  await writeFile(join(source, 'sales', 'orders.md'), CONCEPT)
  await putTenantRoot(source, { root, tenant: 'acme' })

  server = serve({
    root,
    port: 0,
    hostname: '127.0.0.1',
    sources: new Map([['acme', source]]),
    sync: async tenant => putTenantRoot(source, { root, tenant }),
    tokens: new Map([['tok', { tenant: 'acme', write: true }]])
  })
})

afterAll(async () => {
  server?.stop(true)
  await rm(scratch, { recursive: true, force: true })
})

/**
 * The point of this entry point is that an editor can depend on it from Node,
 * Electron, Tauri or a browser. That only holds while nothing in its import
 * graph reaches for Bun or the filesystem, so the invariant is asserted rather
 * than trusted: bundle it for node and look at what came out.
 */
describe('the client bundles for other runtimes', () => {
  test('pulls in no Bun API and no filesystem', async () => {
    const built = await Bun.build({ entrypoints: [ENTRY], target: 'node' })

    expect(built.success).toBe(true)

    const text = await (built.outputs[0] as Bun.BuildArtifact).text()

    expect(text).not.toContain('Bun.')
    expect(text).not.toContain('node:fs')
    expect(text).not.toContain('node:path')
  })
})

describe('connect', () => {
  test('reads a tenant over http', async () => {
    const knowledge = connect(dsn())

    expect(knowledge.transport).toBe('http')
    expect(await knowledge.manifest()).toContain('orders')
    expect((await knowledge.get(['orders'])).size).toBe(1)
    expect(await knowledge.search('orders')).toContain('orders')
  })

  test('writes, syncs and enforces the precondition', async () => {
    const knowledge = connect(dsn())
    const before = await knowledge.snapshot()

    await knowledge.writeSource('sales', 'metrics/revenue.md', CONCEPT)

    const synced = await knowledge.sync()

    expect(synced.snapshot).not.toBe(before)
    expect(synced.concepts).toBe(2)

    await expect(
      knowledge.writeSource('sales', 'metrics/revenue.md', CONCEPT)
    ).rejects.toThrow('412')

    const found = await knowledge.readSource('sales', 'metrics/revenue.md')

    await knowledge.deleteSource(
      'sales',
      'metrics/revenue.md',
      found?.hash ?? ''
    )
    await knowledge.sync()
  })

  test('refuses an embedded dsn rather than pretending', () => {
    expect(() => connect('okf:///var/data?tenant=acme')).toThrow(
      'speaks HTTP only'
    )
  })

  test('explains the missing named pipe on Windows', () => {
    expect(() => connect('okf+npipe://./pipe/okf')).toThrow('loopback TCP')
  })
})
