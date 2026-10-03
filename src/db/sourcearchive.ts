import { assertBundleName, assertConceptPath } from '../store/sourcepaths.ts'
import { decodeText } from '../text.ts'
import { assertHash, frame, unframe } from './format.ts'
import { uint32, validateBundles, validateDiagnostics } from './validation.ts'

import type { TenantCompileResult } from '../compile/tenant.ts'
import type { SourceArchive, SourceRecord } from './types.ts'
import type { EncodedSnapshot } from '../store/format.ts'
import type { CompiledInput } from './input.ts'

export interface OriginalSource {
  bundle: string
  path: string
  prefix: string | Uint8Array
  hash: string
  bytes: number
}

export function encodeSourceParts(
  documents: OriginalSource[],
  compiled: TenantCompileResult,
  snapshot: EncodedSnapshot,
  inputs: CompiledInput[]
): { bytes: Uint8Array; archive: SourceArchive } {
  const concepts = new Map(
    compiled.concepts.map(concept => [
      `${concept.bundle}/${concept.path}`,
      concept.id
    ])
  )
  const entries: SourceRecord[] = []
  const bodies = new Map(snapshot.entries.map(entry => [entry.id, entry]))
  const chunks: (string | Uint8Array)[] = []
  let offset = 0

  for (const document of documents) {
    const id = concepts.get(`${document.bundle}/${document.path}`)
    const payload = document.prefix
    const length =
      typeof payload === 'string' ? Buffer.byteLength(payload) : payload.length
    const entry: SourceRecord = {
      bundle: document.bundle,
      path: document.path,
      hash: document.hash,
      bytes: document.bytes,
      offset,
      length,
      checksum: Bun.hash.crc32(payload)
    }

    if (id !== undefined) {
      entry.id = id
      const body = bodies.get(id)

      if (body?.checksum === undefined) {
        throw new Error('source body is missing from the compiled snapshot')
      }

      entry.body = {
        offset: snapshot.blobsOffset + body.offset,
        length: body.length,
        checksum: body.checksum
      }
    }

    entries.push(entry)
    chunks.push(payload)
    offset += length
  }

  const bundles = inputs.map(input => ({
    name: input.name,
    diagnostics: input.result.diagnostics
  }))

  const bytes = frame('LRS1', { entries, bundles }, chunks)

  return {
    bytes,
    archive: {
      entries,
      bundles,
      payload: bytes.subarray(bytes.length - offset)
    }
  }
}

function validateEntry(entry: SourceRecord, length: number): void {
  if (
    !entry ||
    typeof entry.bundle !== 'string' ||
    typeof entry.path !== 'string'
  ) {
    throw new Error('database corruption: invalid source entry')
  }

  assertBundleName(entry.bundle)
  assertConceptPath(entry.path)
  assertHash(entry.hash)

  if (
    !Number.isSafeInteger(entry.offset) ||
    !Number.isSafeInteger(entry.length) ||
    entry.offset < 0 ||
    entry.length < 0 ||
    entry.offset + entry.length > length
  ) {
    throw new Error('database corruption: invalid source range')
  }

  if (
    !Number.isSafeInteger(entry.bytes) ||
    entry.bytes < 0 ||
    !uint32(entry.checksum)
  ) {
    throw new Error('database corruption: invalid source metadata')
  }

  validateBody(entry)
}

function validateBody(entry: SourceRecord): void {
  if (entry.id === undefined && entry.body === undefined) {
    return
  }

  const body = entry.body

  if (
    typeof entry.id !== 'string' ||
    !body ||
    !uint32(body.offset) ||
    !uint32(body.length) ||
    !uint32(body.checksum)
  ) {
    throw new Error('database corruption: invalid source body reference')
  }
}

export function decodeSources(bytes: Uint8Array): SourceArchive {
  const { metadata, payload } = unframe(bytes, 'LRS1')
  const data = metadata as Pick<SourceArchive, 'entries' | 'bundles'>

  if (!data || !Array.isArray(data.entries) || !Array.isArray(data.bundles)) {
    throw new Error('database corruption: invalid source directory')
  }

  const entries = data.entries
  const keys = new Set<string>()

  for (const entry of entries) {
    validateEntry(entry, payload.length)

    const key = `${entry.bundle}/${entry.path}`.toLowerCase()

    if (keys.has(key)) {
      throw new Error('database corruption: duplicate source')
    }

    keys.add(key)
  }

  validateBundles(data.bundles.map(bundle => bundle?.name))

  for (const bundle of data.bundles) {
    if (!Array.isArray(bundle.diagnostics)) {
      throw new Error('database corruption: invalid bundle diagnostics')
    }

    validateDiagnostics(bundle.diagnostics)
  }

  return { entries, payload, bundles: data.bundles }
}

export function sourcePrefix(
  archive: SourceArchive,
  entry: SourceRecord
): string {
  const payload = archive.payload.subarray(
    entry.offset,
    entry.offset + entry.length
  )

  if (Bun.hash.crc32(payload) !== entry.checksum) {
    throw new Error('database corruption: source checksum mismatch')
  }

  return decodeText(payload)
}
