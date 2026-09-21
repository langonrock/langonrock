import { expect, test } from 'bun:test'

import { frame, hash } from '../src/db/format.ts'
import { decodeHead } from '../src/db/head.ts'
import { decodeRevision } from '../src/db/revision.ts'
import { encodeTntParts } from '../src/store/format.ts'

const digest = hash('test artifact')
const checksums = { header: 0, directory: 1, manifest: 0xffffffff }
const head = {
  version: 1 as const,
  revision: digest,
  snapshot: digest,
  archive: digest,
  checksums
}
const revision = {
  version: 1 as const,
  parent: null,
  snapshot: digest,
  archive: digest,
  checksums,
  concepts: 1,
  bundles: ['docs'],
  diagnostics: [],
  summaryWidth: 120,
  created: '2026-09-21T12:00:00.000Z'
}

test('encoding rejects offsets beyond TNT1 limits before allocating the snapshot', () => {
  const oversized = { byteLength: 0x100000000 } as Uint8Array

  expect(() =>
    encodeTntParts('', [
      {
        id: 'oversized',
        content: '',
        sections: {},
        encoded: { bytes: oversized, checksum: 0 }
      }
    ])
  ).toThrow('32-bit format size limit')
})

test('committed roots validate checksum ranges and retention membership', () => {
  expect(decodeHead(frame('LRH1', head))).toEqual(head)

  for (const value of [-1, 0x100000000, 0.5, null, '0']) {
    expect(() =>
      decodeHead(
        frame('LRH1', {
          ...head,
          checksums: { ...checksums, header: value }
        })
      )
    ).toThrow('corruption')
  }

  for (const retained of [[], [digest, digest], [hash('unrelated')]]) {
    expect(() => decodeHead(frame('LRH1', { ...head, retained }))).toThrow(
      'retention'
    )
  }
})

test('revision metadata rejects malformed checksums, bundles, dates, and diagnostics', () => {
  const valid = frame('LRR1', revision)

  expect(decodeRevision(valid, hash(valid))).toEqual(revision)

  const malformed = [
    { checksums: undefined },
    { checksums: { ...checksums, manifest: -1 } },
    { bundles: ['../escape'] },
    { bundles: ['docs', 'docs'] },
    { bundles: [null] },
    { diagnostics: [null] },
    { diagnostics: [{ level: 'fatal', path: 'a.md', message: 'bad' }] },
    { created: 'not a date' },
    { summaryWidth: -1 }
  ]

  for (const change of malformed) {
    const bytes = frame('LRR1', { ...revision, ...change })

    expect(() => decodeRevision(bytes, hash(bytes))).toThrow()
  }
})
