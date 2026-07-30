import { describe, expect, test } from 'bun:test'

import {
  HEADER_BYTES,
  MAGIC,
  VERSION,
  decodeBlob,
  encodeTnt,
  parseDir,
  parseHeader
} from '../src/store/format.ts'

import type { TntConcept } from '../src/store/format.ts'

const MANIFEST = '# bundle: demo\nid\tkind\n a\ttable\n'

const CONCEPTS: TntConcept[] = [
  {
    id: 'orders',
    content: 'Lead.\n## Schema\norder_id int64\n',
    sections: { body: { start: 0, end: 6 }, schema: { start: 6, end: 31 } }
  },
  { id: 'customers', content: 'Just prose.\n', sections: {} }
]

function slice(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  return bytes.subarray(offset, offset + length)
}

describe('encodeTnt', () => {
  test('round-trips the manifest, directory and blobs', () => {
    const bytes = encodeTnt(MANIFEST, CONCEPTS)
    const header = parseHeader(bytes)

    expect(header.version).toBe(VERSION)
    expect(
      new TextDecoder().decode(
        slice(bytes, header.manifestOffset, header.manifestLength)
      )
    ).toBe(MANIFEST)

    const entries = parseDir(slice(bytes, header.dirOffset, header.dirLength))

    expect(entries.map(entry => entry.id)).toEqual(['orders', 'customers'])

    const first = entries[0]
    const expected = CONCEPTS[0]

    if (first === undefined || expected === undefined) {
      throw new Error('fixture lost its first concept')
    }

    const blob = slice(bytes, header.blobsOffset + first.offset, first.length)

    expect(decodeBlob(blob)).toBe(expected.content)
  })

  test('stores the manifest uncompressed so it can be sliced directly', () => {
    const bytes = encodeTnt(MANIFEST, CONCEPTS)

    expect(new TextDecoder().decode(bytes)).toContain(MANIFEST)
  })

  test('places the manifest immediately after the header', () => {
    const header = parseHeader(encodeTnt(MANIFEST, CONCEPTS))

    expect(header.manifestOffset).toBe(HEADER_BYTES)
  })

  test('keeps section ranges intact through the directory', () => {
    const bytes = encodeTnt(MANIFEST, CONCEPTS)
    const header = parseHeader(bytes)
    const entries = parseDir(slice(bytes, header.dirOffset, header.dirLength))

    expect(entries[0]?.sections['schema']).toEqual({ start: 6, end: 31 })
  })

  test('handles a bundle with no concepts', () => {
    const bytes = encodeTnt(MANIFEST, [])
    const header = parseHeader(bytes)

    expect(header.blobsLength).toBe(0)
    expect(parseDir(slice(bytes, header.dirOffset, header.dirLength))).toEqual(
      []
    )
  })

  test('compresses blobs, so repetitive content shrinks', () => {
    const repetitive: TntConcept[] = [
      { id: 'big', content: 'x'.repeat(20_000), sections: {} }
    ]
    const bytes = encodeTnt(MANIFEST, repetitive)

    expect(parseHeader(bytes).blobsLength).toBeLessThan(1000)
  })
})

describe('parseHeader', () => {
  test('rejects a truncated header', () => {
    expect(() => parseHeader(new Uint8Array(8))).toThrow('truncated header')
  })

  test('rejects a file that is not a snapshot', () => {
    const bytes = new Uint8Array(HEADER_BYTES)

    bytes.set(new TextEncoder().encode('NOPE'), 0)

    expect(() => parseHeader(bytes)).toThrow('bad magic')
  })

  test('rejects an unsupported version', () => {
    const bytes = encodeTnt(MANIFEST, CONCEPTS)

    new DataView(bytes.buffer).setUint32(4, VERSION + 1, true)

    expect(() => parseHeader(bytes)).toThrow('unsupported version')
  })

  test('accepts the documented magic', () => {
    expect(MAGIC).toBe('TNT1')
  })
})
