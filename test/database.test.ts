import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  importInitial,
  listSource,
  readSource,
  sync,
  transact
} from '../src/db/api.ts'
import { prepare } from '../src/db/documents.ts'
import { hash } from '../src/db/format.ts'
import { readHead } from '../src/db/head.ts'
import { publish, replaceHead } from '../src/db/publish.ts'
import { releaseBuffer } from '../src/buffers.ts'
import {
  allDocuments,
  leaseArchive,
  pinReader,
  pinSources
} from '../src/db/reader.ts'
import { sourcePrefix } from '../src/db/sourcearchive.ts'
import { putTenantRoot } from '../src/store/writer.ts'
import { openTenant } from '../src/store/reader.ts'

import type { CommitStep } from '../src/db/publish.ts'
import type { DatabaseTarget, DocumentRecord } from '../src/db/types.ts'

let target: DatabaseTarget

beforeEach(async () => {
  target = {
    root: await mkdtemp(join(tmpdir(), 'langonrock-db-test-')),
    tenant: 'test'
  }
})

afterEach(async () => rm(target.root, { recursive: true, force: true }))

const document = (path: string, source: string): DocumentRecord => ({
  bundle: 'docs',
  path,
  source
})
const write = (path: string, content: string) => ({
  operation: 'write' as const,
  bundle: 'docs',
  path,
  content
})

test('one commit publishes every document and preserves exact original sources', async () => {
  const documents = [
    document(
      'a.md',
      '---\r\ntype: concept\r\nunknown: [one, two]\r\n---\r\n# A\r\n漢字 café 🪨\r\n'
    ),
    document('b.md', '---\ntype: [invalid yaml\n---\nbody\n'),
    document('empty.md', ''),
    document('index.md', '# Navigation\n[a](a.md)\n'),
    document('nested/plain.md', '# plain markdown\nbody\n')
  ]
  const result = await transact(target, {
    changes: documents.map(file => write(file.path, file.source))
  })
  const pinned = await pinSources(target)

  try {
    expect(await allDocuments(pinned)).toEqual(documents)
    expect(pinned.reader.head.revision).toBe(result.revision)
    expect(pinned.reader.ids).toHaveLength(4)
    expect((await pinned.reader.get(['a'])).get('a')?.text).toContain(
      '漢字 café 🪨'
    )
  } finally {
    pinned.reader.close()
  }

  expect(await readSource(target, 'docs', 'a.md')).toEqual({
    content: documents[0]?.source ?? '',
    hash: hash(documents[0]?.source ?? '')
  })
  expect(await readSource(target, 'docs', 'missing.md')).toBeUndefined()
  expect(await listSource(target)).toHaveLength(5)
  expect(await sync(target)).toEqual(result)
})

test('conflicting document or revision aborts a whole transaction', async () => {
  const first = await transact(target, { changes: [write('a.md', 'A')] })

  await expect(
    transact(target, { changes: [write('b.md', 'B'), write('a.md', 'wrong')] })
  ).rejects.toThrow('already exists')
  await expect(
    transact(target, {
      expectedRevision: '0'.repeat(64),
      changes: [write('b.md', 'B')]
    })
  ).rejects.toThrow('changed')
  expect(await readHead(target)).toMatchObject({ revision: first.revision })
  expect(await readSource(target, 'docs', 'b.md')).toBeUndefined()

  await transact(target, {
    expectedRevision: first.revision,
    changes: [
      { ...write('a.md', 'changed'), replaces: hash('A') },
      write('b.md', 'B')
    ]
  })
  await transact(target, {
    changes: [
      {
        operation: 'delete',
        bundle: 'docs',
        path: 'a.md',
        replaces: hash('changed')
      }
    ]
  })
  expect(await readSource(target, 'docs', 'a.md')).toBeUndefined()
})

test('a reader pinned before publication continues reading its complete revision', async () => {
  await transact(target, {
    changes: [write('a.md', 'old'), write('b.md', 'old')]
  })

  const old = await pinReader(target)

  try {
    await transact(target, {
      changes: [
        { ...write('a.md', 'new'), replaces: hash('old') },
        { ...write('b.md', 'new'), replaces: hash('old') }
      ]
    })
    expect(
      [...(await old.get(['a', 'b']))].map(([, slice]) => slice.text)
    ).toEqual(['old', 'old'])

    const current = await pinReader(target)

    try {
      expect(
        [...(await current.get(['a', 'b']))].map(([, slice]) => slice.text)
      ).toEqual(['new', 'new'])
    } finally {
      current.close()
    }
  } finally {
    old.close()
  }
})

test('interruption before publication leaves the old revision authoritative', async () => {
  const original = await transact(target, { changes: [write('a.md', 'old')] })
  const steps: CommitStep[] = [
    'locked',
    'snapshot',
    'archive',
    'revision',
    'head-ready'
  ]

  for (const stop of steps) {
    await expect(
      transact(
        target,
        { changes: [{ ...write('a.md', 'new'), replaces: hash('old') }] },
        async step => {
          if (step === stop) {
            throw new Error(`interrupt ${step}`)
          }
        }
      )
    ).rejects.toThrow('interrupt')
    expect((await readHead(target))?.revision).toBe(original.revision)
    expect((await readSource(target, 'docs', 'a.md'))?.content).toBe('old')
  }
})

test('failure after replacement reports an indeterminate commit identity', async () => {
  await transact(target, { changes: [write('a.md', 'old')] })

  await expect(
    transact(
      target,
      { changes: [{ ...write('a.md', 'new'), replaces: hash('old') }] },
      async step => {
        if (step === 'head-replaced') {
          throw new Error('failed durability barrier')
        }
      }
    )
  ).rejects.toMatchObject({
    code: 'INDETERMINATE_COMMIT',
    revision: expect.stringMatching(/^[a-f0-9]{64}$/)
  })

  expect((await readSource(target, 'docs', 'a.md'))?.content).toBe('new')
})

test('only one competing prepared revision may commit', async () => {
  await transact(target, { changes: [write('a.md', 'old')] })

  const base = await readHead(target)
  const results = await Promise.allSettled(
    ['one', 'two'].map(source =>
      publish(target, {
        base,
        prepared: prepare([document('a.md', source)], target.tenant)
      })
    )
  )

  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(
    1
  )
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
})

test('publication inherits a retention boundary changed after candidate preparation', async () => {
  await transact(target, { changes: [write('a.md', 'old')] })
  await transact(target, {
    changes: [{ ...write('a.md', 'current'), replaces: hash('old') }]
  })

  const base = await readHead(target)

  if (base === undefined) {
    throw new Error('missing test head')
  }

  const prepared = prepare([document('a.md', 'next')], target.tenant)

  try {
    await replaceHead(target, { ...base, retained: [base.revision] })

    const result = await publish(target, { base, prepared })

    expect((await readHead(target))?.retained).toEqual([
      base.revision,
      result.revision
    ])
    expect((await readSource(target, 'docs', 'a.md'))?.content).toBe('next')
  } finally {
    releaseBuffer(prepared.snapshotBytes)
    releaseBuffer(prepared.archiveBytes)
  }
})

test('initial folder import preserves the legacy manifest and bodies', async () => {
  const source = `${target.root}/original`

  await Bun.write(`${source}/docs/a.md`, '---\ntype: concept\n---\n# A\ntext')
  await putTenantRoot(source, { root: target.root, tenant: 'legacy' })
  await importInitial(target, source)

  const legacy = await openTenant(target.root, 'legacy')
  const native = await pinReader(target)

  try {
    expect((await native.manifest()).replace('test', 'legacy')).toBe(
      await legacy.manifest()
    )
    expect(await native.get(native.ids)).toEqual(await legacy.get(legacy.ids))
  } finally {
    native.close()
  }

  await expect(importInitial(target, source)).rejects.toThrow('already exists')
  await expect(
    transact({ ...target, tenant: 'legacy' }, { changes: [write('a.md', 'X')] })
  ).rejects.toThrow('migrate')
})

test('invalid batches fail before creating tenant state', async () => {
  for (const changes of [
    [],
    [write('../a.md', 'x')],
    [write('a.md', 'x'), write('a.md', 'y')]
  ]) {
    await expect(transact(target, { changes })).rejects.toThrow()
  }

  expect(await readHead(target)).toBeUndefined()
})

test('initial imports reject invalid summary widths before publishing a revision', async () => {
  const source = `${target.root}/original`

  await Bun.write(`${source}/docs/a.md`, '# Original\nbody\n')

  for (const width of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(importInitial(target, source, width)).rejects.toThrow()
    expect(await readHead(target)).toBeUndefined()
  }

  const result = await importInitial(target, source, 0)

  expect(await sync(target)).toEqual(result)
  expect((await readSource(target, 'docs', 'a.md'))?.content).toBe(
    '# Original\nbody\n'
  )
})

test('cached writer metadata follows a revision published by an independent writer', async () => {
  await transact(target, { changes: [write('a.md', 'first')] })
  await transact(target, {
    changes: [{ ...write('a.md', 'cached'), replaces: hash('first') }]
  })

  const base = await readHead(target)

  await publish(target, {
    base,
    prepared: prepare(
      [document('a.md', 'external'), document('b.md', 'created elsewhere')],
      target.tenant
    )
  })
  expect((await readSource(target, 'docs', 'a.md'))?.content).toBe('external')
  await transact(target, {
    changes: [{ ...write('a.md', 'current'), replaces: hash('external') }]
  })
  expect((await readSource(target, 'docs', 'b.md'))?.content).toBe(
    'created elsewhere'
  )
  expect((await listSource(target)).map(entry => entry.path)).toEqual([
    'a.md',
    'b.md'
  ])
})

test('closing a pinned reader is idempotent and prevents descriptor reuse through its methods', async () => {
  await transact(target, { changes: [write('a.md', 'old')] })

  const reader = await pinReader(target)

  reader.close()
  reader.close()
  expect(() => reader.ids).toThrow('closed')
  expect(() => reader.get(['a'])).toThrow('closed')
  expect(() => reader.manifest()).toThrow('closed')
})

test('closing a pinned reader lets reads already in progress finish on their original descriptor', async () => {
  await transact(target, { changes: [write('a.md', 'original body')] })

  const previous = await pinReader(target)

  await transact(target, {
    changes: [{ ...write('a.md', 'new body'), replaces: hash('original body') }]
  })

  const pending = previous.get(new Array<string>(256).fill('a'))
  const observed = pending.then(
    value => ({ value, error: undefined }),
    error => ({ value: undefined, error })
  )

  previous.close()

  const current = await pinReader(target)

  try {
    const completed = await observed

    expect(completed.error).toBeUndefined()
    expect(completed.value?.get('a')?.text).toBe('original body')
    expect((await current.get(['a'])).get('a')?.text).toBe('new body')
  } finally {
    current.close()
  }
})

test('cache eviction keeps leased source bytes alive until the last reader releases them', async () => {
  await transact(target, { changes: [write('index.md', 'first')] })
  await transact(target, {
    changes: [{ ...write('index.md', 'cached'), replaces: hash('first') }]
  })

  const head = await readHead(target)

  if (head === undefined) {
    throw new Error('missing test head')
  }

  const one = await leaseArchive(target, head)
  const two = await leaseArchive(target, head)
  const entry = one.archive.entries[0]

  if (entry === undefined) {
    throw new Error('missing test source')
  }

  await transact(target, {
    changes: [{ ...write('index.md', 'new'), replaces: hash('cached') }]
  })
  one.release()
  one.release()
  expect(sourcePrefix(two.archive, entry)).toBe('cached')
  two.release()
  expect(two.archive.payload.byteLength).toBe(0)
  expect((await readSource(target, 'docs', 'index.md'))?.content).toBe('new')
})

test('replacement-only compilation matches a full build with links, diagnostics, and navigation edits', async () => {
  const documents = [
    document('a.md', '# A\n[b](b.md)\n'),
    document(
      'b.md',
      '---\ntype: concept\ntitle: Original\n---\n# B\n[missing](missing.md)\n'
    ),
    document('index.md', '# Original navigation\n')
  ]

  await transact(target, {
    changes: documents.map(file => write(file.path, file.source))
  })

  for (const source of [
    '---\ntype: concept\ntitle: New\n---\n# Updated\n[a](a.md)\n## schema\n漢字\n',
    '---\ntype: [malformed\n---\n# Invalid\n[a](a.md)\n',
    '# Plain\n[a](a.md)\n[missing](missing.md)\n'
  ]) {
    const old = documents[1]
    const navigation = documents[2]

    if (old === undefined || navigation === undefined) {
      throw new Error('missing test documents')
    }

    const result = await transact(target, {
      changes: [
        { ...write('b.md', source), replaces: hash(old.source) },
        { ...write('index.md', source), replaces: hash(navigation.source) }
      ]
    })

    old.source = source
    navigation.source = source

    const complete = prepare(documents, target.tenant)

    expect(result.snapshot).toBe(complete.snapshot)
    expect(result.diagnostics).toEqual(complete.diagnostics)
    expect((await readSource(target, 'docs', 'b.md'))?.content).toBe(source)
  }
})

test('incremental commits preserve untouched bundles when global ids and links change', async () => {
  const original = [
    {
      operation: 'write' as const,
      bundle: 'one',
      path: 'a.md',
      content:
        '---\ntype: concept\ntitle: A title\nstale_after: 2000-01-01\n---\n# A\n[a](a.md)\n## schema\nα\n'
    },
    {
      operation: 'write' as const,
      bundle: 'two',
      path: 'b.md',
      content: '---\ntype: concept\n---\n# B\n[b](b.md)\n'
    }
  ]

  await transact(target, { changes: original })
  await transact(target, {
    changes: [
      {
        operation: 'write',
        bundle: 'two',
        path: 'a.md',
        content: '# collision\n[b](b.md)\n'
      }
    ]
  })

  const sources = await listSource(target)
  const exported = `${target.root}/comparison`

  for (const entry of sources) {
    const file = await readSource(target, entry.bundle, entry.path)

    await Bun.write(
      `${exported}/${entry.bundle}/${entry.path}`,
      file?.content ?? ''
    )
  }

  await putTenantRoot(exported, { root: target.root, tenant: 'reference' })

  const reference = await openTenant(target.root, 'reference')
  const current = await pinReader(target)

  try {
    expect(
      (await current.manifest()).replace(
        '# tenant: test',
        '# tenant: reference'
      )
    ).toBe(await reference.manifest())
    expect(await current.get(current.ids)).toEqual(
      await reference.get(reference.ids)
    )
    expect(await current.get(['one/a'], { section: 'schema' })).toEqual(
      await reference.get(['one/a'], { section: 'schema' })
    )
    expect(current.titles).toEqual(reference.titles)
  } finally {
    current.close()
  }

  const collision = await readSource(target, 'two', 'a.md')

  await transact(target, {
    changes: [
      {
        operation: 'delete',
        bundle: 'two',
        path: 'a.md',
        replaces: collision?.hash ?? ''
      }
    ]
  })

  const restored = await pinReader(target)

  expect(restored.ids).toEqual(['a', 'b'])
  expect((await restored.get(['a'])).get('a')?.text).toContain('[a](a.md)')
  restored.close()
})
