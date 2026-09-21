import { expect, test } from 'bun:test'

import { prepare } from '../src/db/documents.ts'
import { frame, hash, unframe } from '../src/db/format.ts'
import { decodeSources, sourcePrefix } from '../src/db/sourcearchive.ts'
import {
  decodeBlob,
  encodeTnt,
  parseDir,
  parseHeader
} from '../src/store/format.ts'

test('source records detect damaged payloads, truncation, bounds, and duplicate keys', () => {
  const prepared = prepare(
    [{ bundle: 'docs', path: 'index.md', source: 'exact\r\n漢字' }],
    'test'
  )
  const archive = decodeSources(prepared.archiveBytes)
  const entry = archive.entries[0]

  expect(entry).toBeDefined()

  if (entry === undefined) {
    throw new Error('test fixture has no source')
  }

  expect(sourcePrefix(archive, entry)).toBe('exact\r\n漢字')
  archive.payload[0] = 0
  expect(() => sourcePrefix(archive, entry)).toThrow('checksum')
  expect(() => decodeSources(prepared.archiveBytes.subarray(0, 20))).toThrow(
    'corruption'
  )
  expect(() =>
    decodeSources(
      frame(
        'LRS1',
        { entries: [{ ...entry, offset: 999999 }], bundles: [] },
        archive.payload
      )
    )
  ).toThrow('range')
  expect(() =>
    decodeSources(
      frame('LRS1', { entries: [entry, entry], bundles: [] }, archive.payload)
    )
  ).toThrow('duplicate')
})

test('framed metadata rejects unknown versions and altered bytes', () => {
  const bytes = frame('TEST', { one: 1 })

  expect(unframe(bytes, 'TEST').metadata).toEqual({ one: 1 })
  expect(() => unframe(bytes, 'NOPE')).toThrow('header')
  bytes[4] = 2
  expect(() => unframe(bytes, 'TEST')).toThrow('unsupported')
  bytes[4] = 1
  bytes[bytes.length - 2] = 4
  expect(() => unframe(bytes, 'TEST')).toThrow('checksum')
})

test('native body checksums and reuse verify actual contents, including a changed body with the same id', () => {
  const first = encodeTnt(
    'manifest',
    [{ id: 'a', content: 'old', sections: {} }],
    { checksums: true }
  )
  const header = parseHeader(first)
  const entry = parseDir(
    first.subarray(header.dirOffset, header.blobsOffset)
  )[0]

  if (entry?.checksum === undefined) {
    throw new Error('test fixture is missing a checksum')
  }

  const bytes = first.subarray(header.blobsOffset)
  const checksum = entry.checksum

  expect(() => decodeBlob(bytes, checksum ^ 1)).toThrow('checksum')

  const reusable = new Map([
    ['a', { content: 'old', bytes, checksum: entry.checksum }]
  ])
  const same = encodeTnt(
    'manifest',
    [{ id: 'a', content: 'old', sections: {} }],
    { checksums: true, reusable }
  )
  const changed = encodeTnt(
    'manifest',
    [{ id: 'a', content: 'new', sections: {} }],
    { checksums: true, reusable }
  )
  const changedHeader = parseHeader(changed)

  expect(hash(same)).toBe(hash(first))
  expect(decodeBlob(changed.subarray(changedHeader.blobsOffset))).toBe('new')
})
