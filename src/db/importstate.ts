import { assertBundleName, assertConceptPath } from '../store/sourcepaths.ts'
import { corruption } from './errors.ts'
import { assertHash, frame, hash, unframe } from './format.ts'
import { artifact } from './paths.ts'
import { validateBundles } from './validation.ts'
import { releaseBuffer } from '../buffers.ts'
import { METADATA_RECORD_LIMIT, readBounded } from './recordio.ts'

import type { DatabaseTarget } from './types.ts'

export interface ImportLocation {
  source: string
  bundle?: string
}

export interface ImportedFile {
  bundle: string
  path: string
  hash: string
}

export interface ImportedState {
  files: ImportedFile[]
  bundles: string[]
}

export interface ImportReference extends ImportLocation {
  mapping: string
}

export interface ImportArtifact {
  reference: ImportReference
  bytes: Uint8Array
}

export function locationKey(location: ImportLocation): string {
  return JSON.stringify([location.source, location.bundle ?? null])
}

export function validateImports(references: ImportReference[]): void {
  if (!Array.isArray(references) || references.length > 64) {
    throw corruption('invalid import references')
  }

  const keys = new Set<string>()

  for (const reference of references) {
    if (
      !reference ||
      typeof reference.source !== 'string' ||
      reference.source.length === 0 ||
      reference.source.length > 4096
    ) {
      throw corruption('invalid import source')
    }

    assertHash(reference.mapping)

    if (reference.bundle !== undefined) {
      if (typeof reference.bundle !== 'string') {
        throw corruption('invalid import bundle')
      }

      assertBundleName(reference.bundle)
    }

    const key = locationKey(reference)

    if (keys.has(key)) {
      throw corruption('duplicate import source')
    }

    keys.add(key)
  }
}

export function encodeImport(
  location: ImportLocation,
  files: ImportedFile[],
  bundles: string[] = [...new Set(files.map(file => file.bundle))].sort()
): ImportArtifact {
  const entries = files
    .map(({ bundle, path, hash }) => ({ bundle, path, hash }))
    .sort((a, b) => {
      const one = `${a.bundle}/${a.path}`
      const two = `${b.bundle}/${b.path}`

      return one < two ? -1 : one > two ? 1 : 0
    })

  validateFiles(entries)
  validateBundles(bundles)

  const bytes = frame('LRI1', { files: entries, bundles })

  return { reference: { ...location, mapping: hash(bytes) }, bytes }
}

export async function readImport(
  target: DatabaseTarget,
  reference: ImportReference
): Promise<ImportedState> {
  const bytes = await readBounded(
    artifact(target, 'import', reference.mapping),
    METADATA_RECORD_LIMIT
  )

  try {
    return decodeImport(bytes, reference.mapping)
  } finally {
    releaseBuffer(bytes)
  }
}

function decodeImport(bytes: Uint8Array, digest: string): ImportedState {
  if (hash(bytes) !== digest) {
    throw corruption('import mapping digest mismatch')
  }

  const { metadata, payload } = unframe(bytes, 'LRI1')

  const state = metadata as ImportedState

  if (
    !state ||
    !Array.isArray(state.files) ||
    !Array.isArray(state.bundles) ||
    payload.length !== 0
  ) {
    throw corruption('invalid import mapping')
  }

  validateFiles(state.files)
  validateBundles(state.bundles)

  return state
}

function validateFiles(files: ImportedFile[]): void {
  const keys = new Set<string>()

  for (const entry of files) {
    if (
      !entry ||
      typeof entry.bundle !== 'string' ||
      typeof entry.path !== 'string'
    ) {
      throw corruption('invalid imported document')
    }

    assertBundleName(entry.bundle)
    assertConceptPath(entry.path)
    assertHash(entry.hash)

    const key = `${entry.bundle}/${entry.path}`.toLowerCase()

    if (keys.has(key)) {
      throw corruption('duplicate imported document')
    }

    keys.add(key)
  }
}

export function updatedImports(
  previous: ImportReference[] | undefined,
  next: ImportArtifact[] | undefined
): ImportReference[] | undefined {
  if (next === undefined) {
    return previous
  }

  validateImports(next.map(item => item.reference))

  const references = new Map(
    previous?.map(reference => [locationKey(reference), reference])
  )

  for (const artifact of next) {
    references.set(locationKey(artifact.reference), artifact.reference)
  }

  const result = [...references.values()]

  validateImports(result)

  return result
}
