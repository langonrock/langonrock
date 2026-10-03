import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'

import { deleteBundle, readSource, sync, transact } from '../src/db/api.ts'
import { exportFolder } from '../src/db/export.ts'
import { hash } from '../src/db/format.ts'
import { collect } from '../src/db/gc.ts'
import { artifact, readHead } from '../src/db/head.ts'
import { history } from '../src/db/history.ts'
import { importFolder, importFolders } from '../src/db/import.ts'
import { putBundle } from '../src/db/writer.ts'
import { verify } from '../src/db/verify.ts'
import { restore } from '../src/db/restore.ts'

import type { DatabaseTarget } from '../src/db/types.ts'

let target: DatabaseTarget
let source: string

beforeEach(async () => {
  const root = await mkdtemp(`${tmpdir()}/langonrock-interchange-`)

  target = { root: `${root}/data`, tenant: 'test' }
  source = `${root}/source`
  await Bun.write(
    `${source}/docs/a.md`,
    '---\r\ntype: concept\r\ncustom: [one, two]\r\n---\r\n# Original\r\n漢字 🪨\r\n'
  )
  await Bun.write(`${source}/docs/index.md`, 'navigation original')
})
afterEach(async () =>
  rm(dirname(target.root), { recursive: true, force: true })
)

const write = (path: string, content: string) => ({
  operation: 'write' as const,
  bundle: 'docs',
  path,
  content
})

test('deleting an imported empty bundle publishes a restorable revision', async () => {
  await mkdir(`${source}/empty`)

  const original = await importFolder(target, source)
  const document = await readSource(target, 'docs', 'a.md')

  expect(await deleteBundle(target, 'empty')).toBe(true)

  const deleted = await sync(target)

  expect(deleted.revision).not.toBe(original.revision)
  expect(deleted.bundles).toEqual(['docs'])
  expect(await readSource(target, 'docs', 'a.md')).toEqual(document)
  expect(await deleteBundle(target, 'empty')).toBe(false)
  expect((await sync(target)).revision).toBe(deleted.revision)
  expect((await importFolder(target, source)).revision).toBe(deleted.revision)

  const restored = await restore(target, {
    revision: original.revision,
    expectedRevision: deleted.revision
  })

  expect(restored.bundles).toEqual(['docs', 'empty'])
  expect((await verify(target)).ok).toBe(true)
})

test('unrelated folder edits preserve an empty bundle deleted in the database', async () => {
  await mkdir(`${source}/empty`)
  await importFolder(target, source)
  await deleteBundle(target, 'empty')
  await Bun.write(`${source}/docs/a.md`, '# External edit\n')

  expect((await importFolder(target, source)).bundles).toEqual(['docs'])

  await rm(`${source}/empty`, { recursive: true })
  await importFolder(target, source)
  await mkdir(`${source}/empty`)

  expect((await importFolder(target, source)).bundles).toEqual([
    'docs',
    'empty'
  ])
})

async function replace(path: string, content: string) {
  const previous = await readSource(target, 'docs', path)

  return transact(target, {
    changes: [
      {
        ...write(path, content),
        ...(previous === undefined ? {} : { replaces: previous.hash })
      }
    ]
  })
}

test('Markdown export is exact and never overwrites an existing destination', async () => {
  await Bun.write(`${source}/docs/empty.md`, '')
  await Bun.write(
    `${source}/docs/nested/raw.md`,
    '---\ninvalid: [yaml\n---\nraw\0body\n'
  )
  const first = await importFolder(target, source)
  const output = `${target.root}/../exported`
  const exported = await exportFolder(target, output)

  expect(exported.revision).toBe(first.revision)
  expect(exported.files).toBe(4)

  for (const path of ['a.md', 'index.md', 'empty.md', 'nested/raw.md']) {
    expect(await Bun.file(`${output}/docs/${path}`).text()).toBe(
      await Bun.file(`${source}/docs/${path}`).text()
    )
  }

  await expect(exportFolder(target, output)).rejects.toThrow('already exists')
  const imported = await importFolder(
    { ...target, tenant: 'roundtrip' },
    output
  )

  expect(imported.concepts).toBe(first.concepts)
  expect((await verify({ ...target, tenant: 'roundtrip' })).ok).toBe(true)
})

test('imports preserve UTF-8 byte-order marks and detect source-only BOM edits', async () => {
  const original =
    '\uFEFF---\r\ntype: concept\r\n---\r\n# Byte order\r\n漢字\r\n'
  const navigation = '\uFEFFNavigation\r\n'

  await Bun.write(`${source}/docs/a.md`, original)
  await Bun.write(`${source}/docs/index.md`, navigation)
  const initial = await importFolder(target, source)

  expect((await readSource(target, 'docs', 'a.md'))?.content).toBe(original)
  expect((await readSource(target, 'docs', 'index.md'))?.content).toBe(
    navigation
  )
  const output = `${target.root}/../bom-export`

  await exportFolder(target, output)

  for (const path of ['a.md', 'index.md']) {
    expect(
      new Uint8Array(await Bun.file(`${output}/docs/${path}`).arrayBuffer())
    ).toEqual(
      new Uint8Array(await Bun.file(`${source}/docs/${path}`).arrayBuffer())
    )
  }

  await Bun.write(`${source}/docs/a.md`, original.slice(1))
  const changed = await importFolder(target, source)

  expect(changed.revision).not.toBe(initial.revision)
  expect(changed.snapshot).toBe(initial.snapshot)
  expect((await readSource(target, 'docs', 'a.md'))?.content).toBe(
    original.slice(1)
  )
  expect((await verify(target)).ok).toBe(true)
})

test('invalid UTF-8 imports and ill-formed Unicode writes fail before publication', async () => {
  await Bun.write(
    `${source}/docs/a.md`,
    new Uint8Array([35, 32, 0xf0, 0x90, 0x80])
  )
  await expect(importFolder(target, source)).rejects.toThrow('UTF-8')
  expect(await readHead(target)).toBeUndefined()
  await expect(
    transact(target, {
      changes: [write('a.md', '# Invalid \uD800')]
    })
  ).rejects.toThrow('Unicode')
  expect(await readHead(target)).toBeUndefined()
})

test('a BOM at the beginning of a compiled body survives reads and export', async () => {
  const content = '---\ntype: concept\n---\n\uFEFF# Body marker\n'

  await transact(target, { changes: [write('body.md', content)] })
  expect((await readSource(target, 'docs', 'body.md'))?.content).toBe(content)
  expect((await verify(target)).ok).toBe(true)
  const output = `${target.root}/../body-bom`

  await exportFolder(target, output)
  expect(
    new Uint8Array(await Bun.file(`${output}/docs/body.md`).arrayBuffer())
  ).toEqual(new TextEncoder().encode(content))
})

test('unchanged imports preserve database edits and create no duplicate revisions', async () => {
  const initial = await importFolder(target, source)

  expect((await importFolder(target, source)).revision).toBe(initial.revision)
  const edited = await replace('a.md', '# Database edit')

  expect((await importFolder(target, source)).revision).toBe(edited.revision)
  expect((await readSource(target, 'docs', 'a.md'))?.content).toBe(
    '# Database edit'
  )
  expect((await history(target)).revisions).toHaveLength(2)
})

test('simultaneous folder and database edits conflict atomically, including deletions', async () => {
  await importFolder(target, source)
  const edited = await replace('a.md', '# Database edit')

  await Bun.write(`${source}/docs/a.md`, '# Folder edit')
  await Bun.write(`${source}/docs/new.md`, '# New')
  await expect(importFolder(target, source)).rejects.toThrow(
    'both changed docs/a.md'
  )
  expect((await readHead(target))?.revision).toBe(edited.revision)
  expect(await readSource(target, 'docs', 'new.md')).toBeUndefined()
  await rm(`${source}/docs/a.md`)
  await expect(importFolder(target, source)).rejects.toThrow('both changed')
  await Bun.write(`${source}/docs/a.md`, '# Database edit')
  await importFolder(target, source)
  expect((await readSource(target, 'docs', 'new.md'))?.content).toBe('# New')
  await rm(`${source}/docs/new.md`)
  await importFolder(target, source)
  expect(await readSource(target, 'docs', 'new.md')).toBeUndefined()
})

test('updating an import baseline never adopts or later deletes database-only documents', async () => {
  await importFolder(target, source)
  await replace('only-in-db.md', '# Keep me')
  await Bun.write(`${source}/docs/index.md`, 'updated navigation')
  await importFolder(target, source)
  await Bun.write(`${source}/docs/index.md`, 'another navigation edit')
  await importFolder(target, source)
  await collect({ ...target, keep: 1 })
  await Bun.write(`${source}/docs/index.md`, 'after collection')
  await importFolder(target, source)
  expect((await readSource(target, 'docs', 'only-in-db.md'))?.content).toBe(
    '# Keep me'
  )
  expect((await verify(target)).ok).toBe(true)
  const head = await readHead(target)

  expect(head?.imports).toHaveLength(1)
  expect(await readdir(`${target.root}/tenants/test/imports`)).toHaveLength(2)
  await collect({ ...target, keep: 1 })
  expect(await readdir(`${target.root}/tenants/test/imports`)).toHaveLength(1)
})

test('single-bundle imports preserve unrelated bundles and track their own files', async () => {
  await putBundle(`${source}/docs`, { ...target, bundle: 'docs' })
  await Bun.write(`${source}/other/b.md`, '# Other bundle')
  await putBundle(`${source}/other`, { ...target, bundle: 'other' })
  expect((await readSource(target, 'docs', 'a.md'))?.content).toContain(
    '# Original'
  )
  expect((await readSource(target, 'other', 'b.md'))?.content).toBe(
    '# Other bundle'
  )
  await expect(importFolders(target, [])).rejects.toThrow('source locations')
})

test('imports and exports preserve empty bundles and track their removal', async () => {
  await mkdir(`${source}/empty`)

  expect((await importFolder(target, source)).bundles).toEqual([
    'docs',
    'empty'
  ])
  await mkdir(`${source}/added-empty`)
  expect((await importFolder(target, source)).bundles).toEqual([
    'added-empty',
    'docs',
    'empty'
  ])
  const output = `${target.root}/../empty-export`

  await exportFolder(target, output)
  expect(await readdir(`${output}/empty`)).toEqual([])
  await rm(`${source}/empty`, { recursive: true })
  expect((await importFolder(target, source)).bundles).toEqual([
    'added-empty',
    'docs'
  ])
})

test('an explicit summary width rebuild preserves original sources and database-only documents', async () => {
  const content =
    '---\ntype: concept\ndescription: This description has enough text to compare two summary widths.\n---\n# Body\n'

  await Bun.write(`${source}/docs/a.md`, content)
  await importFolder(target, source, { summaryWidth: 8 })
  const edited = await replace('database-only.md', '# Keep this source')
  const widened = await importFolder(target, source, { summaryWidth: 40 })

  expect(widened.snapshot).not.toBe(edited.snapshot)
  expect((await readSource(target, 'docs', 'a.md'))?.content).toBe(content)
  expect((await readSource(target, 'docs', 'database-only.md'))?.content).toBe(
    '# Keep this source'
  )
  expect(
    (await importFolder(target, source, { summaryWidth: 40 })).revision
  ).toBe(widened.revision)
})

test('corrupted import baselines fail closed and verification reports the damage', async () => {
  await importFolder(target, source)
  const head = await readHead(target)

  await Bun.write(
    artifact(target, 'import', head?.imports?.[0]?.mapping ?? ''),
    'broken baseline'
  )
  await Bun.write(`${source}/docs/a.md`, 'changed')
  await expect(importFolder(target, source)).rejects.toThrow('mapping digest')
  expect((await verify(target)).ok).toBe(false)
  expect((await readHead(target))?.revision).toBe(head?.revision)
})

test('database writes reject case-folded path collisions before publication', async () => {
  const first = await transact(target, { changes: [write('A.md', 'original')] })

  await expect(
    transact(target, { changes: [write('a.md', 'collision')] })
  ).rejects.toThrow('case-insensitive')
  expect((await readHead(target))?.revision).toBe(first.revision)
  expect((await readSource(target, 'docs', 'A.md'))?.hash).toBe(
    hash('original')
  )
})

test('forced exits cannot publish documents without their matching import baseline', async () => {
  for (const stop of ['import', 'head-ready', 'head-replaced', 'durable']) {
    await importFolder(target, source)
    await Bun.write(`${source}/docs/index.md`, `changed at ${stop}`)
    const child = Bun.spawn(
      [
        process.execPath,
        `${import.meta.dir}/helpers/import-worker.ts`,
        JSON.stringify({ target, source, stop })
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

    await importFolder(target, source)
    expect((await readSource(target, 'docs', 'index.md'))?.content).toBe(
      `changed at ${stop}`
    )
    expect((await history(target)).revisions).toHaveLength(2)
    expect((await verify(target)).ok).toBe(true)
    await rm(target.root, { recursive: true, force: true })
  }
})
