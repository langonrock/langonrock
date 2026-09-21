import { releaseBuffer, Utf8Buffer } from '../buffers.ts'

export const MAGIC = 'TNT1'
export const VERSION = 1
export const HEADER_BYTES = 32

export interface SectionRange {
  start: number
  end: number
}

export interface DirEntry {
  checksum?: number
  id: string
  offset: number
  length: number
  sections: Record<string, SectionRange>
  /**
   * Compiled away from the manifest, kept for the search index. Optional so a
   * snapshot written before titles existed still parses.
   */
  title?: string
  /**
   * ISO date after which the reader demotes the concept's status to `stale`.
   * Optional for the same reason `title` is: older snapshots still parse.
   */
  staleAfter?: string
}

export interface TntHeader {
  version: number
  manifestOffset: number
  manifestLength: number
  dirOffset: number
  dirLength: number
  blobsOffset: number
  blobsLength: number
}

export interface TntConcept {
  id: string
  content: string
  sections: Record<string, SectionRange>
  title?: string
  staleAfter?: string
  encoded?: { bytes: Uint8Array; checksum: number }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })

function encodeHeader(header: TntHeader): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES)
  const view = new DataView(bytes.buffer)

  bytes.set(encoder.encode(MAGIC), 0)
  view.setUint32(4, header.version, true)
  view.setUint32(8, header.manifestOffset, true)
  view.setUint32(12, header.manifestLength, true)
  view.setUint32(16, header.dirOffset, true)
  view.setUint32(20, header.dirLength, true)
  view.setUint32(24, header.blobsOffset, true)
  view.setUint32(28, header.blobsLength, true)

  return bytes
}

export function parseHeader(bytes: Uint8Array): TntHeader {
  if (bytes.byteLength < HEADER_BYTES) {
    throw new Error('tnt: truncated header')
  }

  if (decoder.decode(bytes.subarray(0, 4)) !== MAGIC) {
    throw new Error('tnt: bad magic, not a snapshot file')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(4, true)

  if (version !== VERSION) {
    throw new Error(`tnt: unsupported version ${version}`)
  }

  return {
    version,
    manifestOffset: view.getUint32(8, true),
    manifestLength: view.getUint32(12, true),
    dirOffset: view.getUint32(16, true),
    dirLength: view.getUint32(20, true),
    blobsOffset: view.getUint32(24, true),
    blobsLength: view.getUint32(28, true)
  }
}

export function parseDir(bytes: Uint8Array): DirEntry[] {
  return JSON.parse(decoder.decode(bytes)) as DirEntry[]
}

export function decodeBlob(bytes: Uint8Array, checksum?: number): string {
  const content = Bun.zstdDecompressSync(bytes)

  try {
    if (checksum !== undefined && Bun.hash.crc32(content) !== checksum) {
      throw new Error('database corruption: body checksum mismatch')
    }

    return decoder.decode(content)
  } finally {
    releaseBuffer(content)
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let cursor = 0

  for (const chunk of chunks) {
    out.set(chunk, cursor)
    cursor += chunk.byteLength
  }

  return out
}

interface PackedBlobs {
  entries: DirEntry[]
  chunks: Uint8Array[]
  length: number
}

export interface CompressedBody {
  content: string
  bytes: Uint8Array
  checksum: number
}

export interface EncodingOptions {
  checksums?: boolean
  reusable?: Map<string, CompressedBody>
  compressionLevel?: number
}

function compressedBody(
  concept: TntConcept,
  options: EncodingOptions,
  buffer: Utf8Buffer
): CompressedBody {
  if (concept.encoded !== undefined) {
    return { content: '', ...concept.encoded }
  }

  const previous = options.reusable?.get(concept.id)

  if (previous?.content === concept.content) {
    return previous
  }

  const bytes = buffer.encode(concept.content)

  const compressed =
    options.compressionLevel === undefined
      ? Bun.zstdCompressSync(bytes)
      : Bun.zstdCompressSync(bytes, { level: options.compressionLevel })

  return {
    content: concept.content,
    bytes: compressed,
    checksum: Bun.hash.crc32(bytes)
  }
}

function packBlobs(
  concepts: TntConcept[],
  options: EncodingOptions
): PackedBlobs {
  const entries: DirEntry[] = []
  const chunks: Uint8Array[] = []
  let cursor = 0
  const buffer = new Utf8Buffer()

  try {
    for (const concept of concepts) {
      const body = compressedBody(concept, options, buffer)
      const blob = body.bytes
      const entry: DirEntry = {
        id: concept.id,
        offset: cursor,
        length: blob.byteLength,
        sections: concept.sections
      }

      if (concept.title !== undefined) {
        entry.title = concept.title
      }

      if (options.checksums) {
        entry.checksum = body.checksum
      }

      if (concept.staleAfter !== undefined) {
        entry.staleAfter = concept.staleAfter
      }

      entries.push(entry)
      chunks.push(blob)
      cursor += blob.byteLength
    }
  } finally {
    buffer.close()
  }

  return { entries, chunks, length: cursor }
}

/**
 * The manifest is stored contiguous and uncompressed so a reader can slice the
 * byte range and hand it straight to a prompt. Blobs are compressed per concept
 * so fetching one costs one decompression, not the whole file.
 */
export function encodeTnt(
  manifest: string,
  concepts: TntConcept[],
  options: EncodingOptions = {}
): Uint8Array {
  return encodeTntParts(manifest, concepts, options).bytes
}

export interface EncodedSnapshot {
  bytes: Uint8Array
  entries: DirEntry[]
  blobsOffset: number
}

export function encodeTntParts(
  manifest: string,
  concepts: TntConcept[],
  options: EncodingOptions = {}
): EncodedSnapshot {
  const manifestBytes = encoder.encode(manifest)
  const packed = packBlobs(concepts, options)
  const dirBytes = encoder.encode(JSON.stringify(packed.entries))

  const manifestOffset = HEADER_BYTES
  const dirOffset = manifestOffset + manifestBytes.byteLength
  const blobsOffset = dirOffset + dirBytes.byteLength

  if (blobsOffset + packed.length > 0xffffffff) {
    throw new Error('tnt: snapshot exceeds the 32-bit format size limit')
  }

  const header = encodeHeader({
    version: VERSION,
    manifestOffset,
    manifestLength: manifestBytes.byteLength,
    dirOffset,
    dirLength: dirBytes.byteLength,
    blobsOffset,
    blobsLength: packed.length
  })

  return {
    bytes: concat(
      [header, manifestBytes, dirBytes, ...packed.chunks],
      blobsOffset + packed.length
    ),
    entries: packed.entries,
    blobsOffset
  }
}
