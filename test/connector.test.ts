import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = `${import.meta.dir}/../src/cli.ts`

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
let dsn = ''

interface Run {
  stdout: string
  stderr: string
  code: number
}

// Bun paints console.error red, so a hash read off stderr arrives wrapped in
// escape codes and would be passed straight back as a bogus precondition.
const ANSI = /\[\d+m/g

async function run(args: string[], stdin?: string): Promise<Run> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe'
  })

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ])

  return { stdout, stderr: stderr.replaceAll(ANSI, ''), code }
}

async function query(args: string[], stdin?: string): Promise<Run> {
  return run(['query', dsn, ...args], stdin)
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-connector-'))
  root = join(scratch, 'data')
  source = join(scratch, 'sources', 'acme')
  dsn = `okf://${root}?tenant=acme`

  await mkdir(join(source, 'sales', 'tables'), { recursive: true })
  await mkdir(root, { recursive: true })
  await writeFile(join(source, 'sales', 'tables', 'orders.md'), CONCEPT)
  await writeFile(join(root, 'sources.json'), JSON.stringify({ acme: source }))
  await run(['sync', source, '--data', root, '--tenant', 'acme'])
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

describe('query source', () => {
  test('lists each file with its hash and size', async () => {
    const result = await query(['source'])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('sales/tables/orders.md')
    expect(result.stderr).toContain('1 files')
  })

  test('reads one file, content on stdout and hash on stderr', async () => {
    const result = await query(['read', 'sales', 'tables/orders.md'])

    expect(result.code).toBe(0)
    expect(result.stdout).toBe(CONCEPT)
    expect(result.stderr.trim()).toMatch(/^[0-9a-f]{64}$/)
  })

  test('reports a concept that is not there', async () => {
    const result = await query(['read', 'sales', 'tables/nope.md'])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('no such concept')
  })
})

describe('query write', () => {
  test('refuses a write that names no version', async () => {
    const result = await query(['write', 'sales', 'tables/new.md'], 'x')

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--replaces')
  })

  test('creates from stdin with --create', async () => {
    const result = await query(
      ['write', 'sales', 'tables/created.md', '--create'],
      CONCEPT
    )

    expect(result.code).toBe(0)
    expect(result.stderr).toContain('wrote sales/tables/created.md')
  })

  test('refuses to create twice', async () => {
    const result = await query(
      ['write', 'sales', 'tables/created.md', '--create'],
      CONCEPT
    )

    expect(result.code).toBe(1)
  })

  test('updates when given the current hash', async () => {
    const read = await query(['read', 'sales', 'tables/created.md'])
    const updated = `${CONCEPT}\nEdited.\n`
    const result = await query(
      ['write', 'sales', 'tables/created.md', '--replaces', read.stderr.trim()],
      updated
    )

    expect(result.code).toBe(0)
    expect((await query(['read', 'sales', 'tables/created.md'])).stdout).toBe(
      updated
    )
  })

  test('refuses an update whose hash is stale', async () => {
    const result = await query(
      ['write', 'sales', 'tables/created.md', '--replaces', 'deadbeef'],
      'x'
    )

    expect(result.code).toBe(1)
  })

  test('takes the content from a file with --from', async () => {
    const path = join(scratch, 'payload.md')

    await writeFile(path, CONCEPT)

    const result = await query([
      'write',
      'sales',
      'tables/fromfile.md',
      '--create',
      '--from',
      path
    ])

    expect(result.code).toBe(0)
    expect((await query(['read', 'sales', 'tables/fromfile.md'])).stdout).toBe(
      CONCEPT
    )
  })
})

describe('query sync and delete', () => {
  test('sync reports immediately committed writes without creating another revision', async () => {
    const before = await query(['snapshot'])
    const history = await query(['history'])

    expect((await query(['manifest'])).stdout).toContain('created')

    const result = await query(['sync'])

    expect(result.code).toBe(0)
    expect(result.stderr).toContain('concepts')
    expect((await query(['snapshot'])).stdout).toBe(before.stdout)
    expect((await query(['history'])).stdout).toBe(history.stdout)
    expect((await query(['manifest'])).stdout).toContain('created')
  })

  test('delete needs a hash and then removes the file', async () => {
    const bare = await query(['delete', 'sales', 'tables/fromfile.md'])

    expect(bare.code).toBe(1)

    const result = await query([
      'delete',
      'sales',
      'tables/fromfile.md',
      '--force'
    ])

    expect(result.code).toBe(0)
    expect((await query(['read', 'sales', 'tables/fromfile.md'])).code).toBe(1)
  })

  test('delete-bundle removes the whole folder', async () => {
    await query(['write', 'ops', 'runbooks/deploy.md', '--create'], CONCEPT)

    expect((await query(['delete-bundle', 'ops'])).code).toBe(0)
    expect((await query(['read', 'ops', 'runbooks/deploy.md'])).code).toBe(1)
  })
})

describe('unknown verbs', () => {
  test('name the ones that exist instead of doing nothing', async () => {
    const result = await query(['writ'])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('unknown verb "writ"')
    expect(result.stderr).toContain('write')
  })
})
