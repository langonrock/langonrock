import { afterEach, beforeEach, expect, test } from 'bun:test'
import { dirname } from 'node:path'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { readSource, transact } from '../src/db/api.ts'
import { collect } from '../src/db/gc.ts'
import { readHead } from '../src/db/head.ts'
import { history } from '../src/db/history.ts'
import { importFolder } from '../src/db/import.ts'
import { migrate } from '../src/db/migration.ts'
import { openTenant } from '../src/db/open.ts'
import { verify } from '../src/db/verify.ts'
import { currentFile, lockFile } from '../src/store/paths.ts'
import { putTenantRoot } from '../src/store/writer.ts'

import type { DatabaseTarget } from '../src/db/types.ts'

let target: DatabaseTarget
let source: string

beforeEach(async () => {
  const root = await mkdtemp(`${tmpdir()}/langonrock-migration-`)

  target = { root: `${root}/data`, tenant: 'test' }
  source = `${root}/source`
  await Bun.write(
    `${source}/docs/a.md`,
    '---\r\ntype: concept\r\ntitle: Original title\r\ncustom: retained\r\n---\r\n# Original\r\n## schema\r\n漢字\r\n'
  )
  await Bun.write(`${source}/docs/index.md`, 'navigation original')
  await putTenantRoot(source, target)
})
afterEach(async () =>
  rm(dirname(target.root), { recursive: true, force: true })
)

test('migration rejects invalid compile settings even when no concepts reveal a manifest difference', async () => {
  await rm(`${source}/docs/a.md`)
  await putTenantRoot(source, target)

  const pointer = await Bun.file(currentFile(target.root, target.tenant)).text()

  await expect(migrate(target, source, { summaryWidth: -1 })).rejects.toThrow()
  expect(await readHead(target)).toBeUndefined()
  expect(await Bun.file(currentFile(target.root, target.tenant)).text()).toBe(
    pointer
  )
})

test('migration retains a leading BOM while preserving legacy compiled reads', async () => {
  const original = '\uFEFF---\ntype: concept\n---\n# BOM migration\n'

  await Bun.write(`${source}/docs/a.md`, original)
  await putTenantRoot(source, target)
  const legacy = await openTenant(target.root, target.tenant)
  const manifest = await legacy.manifest()
  const body = await legacy.get(['a'])

  await migrate(target, source)
  const native = await openTenant(target.root, target.tenant)

  try {
    expect(await native.manifest()).toBe(manifest)
    expect(await native.get(['a'])).toEqual(body)
    expect((await readSource(target, 'docs', 'a.md'))?.content).toBe(original)
    expect((await verify(target)).ok).toBe(true)
  } finally {
    native.close?.()
  }
})

test('migration dry run validates read equivalence and preserves every original file and snapshot', async () => {
  const original = await Bun.file(`${source}/docs/a.md`).text()
  const legacy = await openTenant(target.root, target.tenant)
  const manifest = await legacy.manifest()
  const body = await legacy.get(['a'], { section: 'schema' })
  const snapshots = await readdir(`${target.root}/tenants/test/snapshots`)
  const preview = await migrate(target, source, { dryRun: true })

  expect(preview.dryRun).toBe(true)
  expect(preview.revision).toBeUndefined()
  expect(await readHead(target)).toBeUndefined()
  expect(await readdir(`${target.root}/tenants/test/snapshots`)).toEqual(
    snapshots
  )
  const result = await migrate(target, source)
  const native = await openTenant(target.root, target.tenant)

  try {
    expect(result.alreadyMigrated).toBe(false)
    expect(result.snapshot).toBe(preview.snapshot)
    expect(await native.manifest()).toBe(manifest)
    expect(await native.get(['a'], { section: 'schema' })).toEqual(body)
    expect((await readSource(target, 'docs', 'a.md'))?.content).toBe(original)
    expect((await readSource(target, 'docs', 'index.md'))?.content).toBe(
      'navigation original'
    )
    expect(await Bun.file(`${source}/docs/a.md`).text()).toBe(original)
    expect(
      (await Bun.file(currentFile(target.root, target.tenant)).text()).trim()
    ).toBe(legacy.snapshot)
    expect((await migrate(target, source)).revision).toBe(result.revision)
    expect((await history(target)).revisions).toHaveLength(1)
    await expect(putTenantRoot(source, target)).rejects.toThrow(
      'database ownership'
    )
    await collect({ ...target, keep: 1 })
    expect(await legacy.get(['a'])).toEqual(await native.get(['a']))
    expect((await verify(target)).ok).toBe(true)
  } finally {
    native.close?.()
  }
})

test('migration requires matching originals and does not reconstruct missing frontmatter from TNT', async () => {
  await expect(migrate(target, `${source}/missing`)).rejects.toThrow()
  expect(await readHead(target)).toBeUndefined()
  await Bun.write(`${source}/docs/a.md`, '# Different body')
  await expect(migrate(target, source)).rejects.toThrow('do not reproduce')
  expect(await readHead(target)).toBeUndefined()
  await expect(importFolder(target, source)).rejects.toThrow('migrate')
})

test('migration revalidates original hashes under the writer lock before publishing', async () => {
  await expect(
    migrate(target, source, {
      observe: async step => {
        if (step === 'locked') {
          await Bun.write(
            `${source}/docs/index.md`,
            'changed during preparation'
          )
        }
      }
    })
  ).rejects.toThrow('original sources changed')
  expect(await readHead(target)).toBeUndefined()
})

test('migration refuses an active legacy writer and leaves another tenant independent', async () => {
  const other = { ...target, tenant: 'other' }

  await putTenantRoot(source, other)
  await Bun.write(lockFile(target.root, target.tenant), 'legacy writer active')
  await expect(migrate(target, source)).rejects.toThrow('stop legacy writers')
  await rm(lockFile(target.root, target.tenant))
  await migrate(target, source)
  await transact(target, {
    changes: [
      {
        operation: 'write',
        bundle: 'docs',
        path: 'new.md',
        content: '# Only in migrated tenant'
      }
    ]
  })
  expect(await readHead(other)).toBeUndefined()
  expect((await openTenant(other.root, other.tenant)).ids).toEqual(['a'])
})

test('CLI migration dry run and exact export use the same native contract', async () => {
  const run = async (args: string[]) => {
    const child = Bun.spawn(
      [
        process.execPath,
        `${import.meta.dir}/../src/cli.ts`,
        ...args,
        '--data',
        target.root,
        '--tenant',
        target.tenant
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    const output = await new Response(child.stdout).text()
    const error = await new Response(child.stderr).text()

    expect(error).toBe('')
    expect(await child.exited).toBe(0)

    return JSON.parse(output)
  }

  expect((await run(['migrate', source, '--dry-run'])).dryRun).toBe(true)
  expect(await readHead(target)).toBeUndefined()
  expect((await run(['migrate', source])).alreadyMigrated).toBe(false)
  const destination = `${dirname(target.root)}/exported`

  expect((await run(['export', destination])).files).toBe(2)
  expect(await Bun.file(`${destination}/docs/a.md`).text()).toBe(
    await Bun.file(`${source}/docs/a.md`).text()
  )
})

test('interrupted migration preserves the legacy root or publishes a complete native root', async () => {
  for (const stop of ['head-ready', 'head-replaced']) {
    const child = Bun.spawn(
      [
        process.execPath,
        `${import.meta.dir}/helpers/import-worker.ts`,
        JSON.stringify({ target, source, stop, migration: true })
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

    if (stop === 'head-ready') {
      expect(await readHead(target)).toBeUndefined()
      const legacy = await openTenant(target.root, target.tenant)

      expect((await legacy.get(['a'])).get('a')?.text).toContain('# Original')
    } else {
      expect((await verify(target)).ok).toBe(true)
    }

    await migrate(target, source)
    expect((await readSource(target, 'docs', 'a.md'))?.content).toContain(
      'custom: retained'
    )
    expect((await history(target)).revisions).toHaveLength(1)
    await rm(target.root, { recursive: true, force: true })
    await putTenantRoot(source, target)
  }
})
