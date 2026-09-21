import { realpath } from 'node:fs/promises'

import { combineBundles, discoverBundles } from '../compile/tenant.ts'
import { toTntConcepts } from '../store/writer.ts'
import { encodeTntParts, parseHeader } from '../store/format.ts'
import { snapshotChecksums } from '../store/integrity.ts'
import { hash } from './format.ts'
import { compileFolder, compileInput } from './input.ts'
import { encodeSourceParts } from './sourcearchive.ts'
import { compressInputs, releaseCompressed } from './compression.ts'
import { encodeImport } from './importstate.ts'
import { assertSummaryWidth, validateBundles } from './validation.ts'

import type { DocumentRecord, Prepared } from './types.ts'
import type { CompiledInput } from './input.ts'
import type { CompressedBody } from '../store/format.ts'
import type { DirEntry } from '../store/format.ts'
import type { EncodedBody } from './compression.ts'
import type { ImportLocation } from './importstate.ts'

export { scanDocuments } from './input.ts'

export interface ReusableContent {
  encoded?: Map<string, EncodedBody>
  capture?: boolean
  bodies?: Map<string, CompressedBody>
  unchanged?: Map<string, { entry: DirEntry; bytes: Uint8Array }>
}

function validatePaths(inputs: CompiledInput[]): void {
  validateBundles(inputs.map(input => input.name))

  const paths = new Set<string>()

  for (const input of inputs) {
    for (const source of input.sources) {
      const path = `${source.bundle}/${source.path}`.toLowerCase()

      if (paths.has(path)) {
        throw new Error(
          'document paths must be unique across case-insensitive filesystems'
        )
      }

      paths.add(path)
    }
  }
}

export function finish(
  inputs: CompiledInput[],
  tenant: string,
  summaryWidth: number,
  reuse: ReusableContent = {}
): Prepared {
  assertSummaryWidth(summaryWidth)
  validatePaths(inputs)

  const compiled = combineBundles(inputs, tenant)
  const concepts = toTntConcepts(compiled)

  for (const [index, concept] of compiled.concepts.entries()) {
    const previous = reuse.unchanged?.get(`${concept.bundle}/${concept.path}`)
    const current = concepts[index]
    const encoded = reuse.encoded?.get(`${concept.bundle}/${concept.path}`)

    if (current !== undefined && encoded !== undefined) {
      current.encoded = encoded
    }

    if (previous?.entry.checksum !== undefined && current !== undefined) {
      current.sections = previous.entry.sections
      current.encoded = {
        bytes: previous.bytes,
        checksum: previous.entry.checksum
      }
    }
  }

  const snapshot = encodeTntParts(compiled.tsv, concepts, {
    checksums: true,
    compressionLevel: 1,
    ...(reuse.bodies === undefined ? {} : { reusable: reuse.bodies })
  })
  const snapshotBytes = snapshot.bytes
  const sources = encodeSourceParts(
    inputs.flatMap(input => input.sources),
    compiled,
    snapshot,
    inputs
  )
  const archiveBytes = sources.bytes
  const header = parseHeader(snapshotBytes)

  return {
    ...(reuse.capture
      ? {
          metadata: {
            archive: sources.archive,
            reader: {
              header,
              entries: snapshot.entries,
              manifest: compiled.tsv
            },
            directory: new Map(
              snapshot.entries.map(entry => [entry.id, entry])
            ),
            concepts: new Map(
              inputs.map(input => [input.name, input.result.concepts])
            )
          }
        }
      : {}),
    checksums: snapshotChecksums(snapshotBytes, header),
    snapshot: hash(snapshotBytes),
    snapshotBytes,
    archive: hash(archiveBytes),
    archiveBytes,
    concepts: compiled.concepts.length,
    bundles: compiled.bundles,
    diagnostics: compiled.diagnostics,
    summaryWidth
  }
}

export function prepare(
  documents: DocumentRecord[],
  tenant: string,
  summaryWidth = 120
): Prepared {
  const groups = Map.groupBy(documents, document => document.bundle)
  const inputs = [...groups]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, files]) => compileInput(name, files, summaryWidth))

  return finish(inputs, tenant, summaryWidth)
}

export async function prepareFolder(
  root: string,
  tenant: string,
  summaryWidth = 120
): Promise<Prepared> {
  return prepareFolders([{ source: root }], tenant, summaryWidth)
}

export async function prepareFolders(
  locations: ImportLocation[],
  tenant: string,
  summaryWidth = 120
): Promise<Prepared> {
  const groups = await Promise.all(
    locations.map(async location => {
      const source = await realpath(location.source)
      const bundles =
        location.bundle === undefined
          ? await discoverBundles(source)
          : [{ name: location.bundle, dir: source }]
      const inputs = await Promise.all(
        bundles.map(bundle =>
          compileFolder(bundle.name, bundle.dir, summaryWidth)
        )
      )

      return { location: { ...location, source }, inputs }
    })
  )
  const inputs = groups
    .flatMap(group => group.inputs)
    .sort((a, b) => (a.name < b.name ? -1 : 1))

  if (
    new Set(inputs.map(input => input.name.toLowerCase())).size !==
    inputs.length
  ) {
    throw new Error('import contains duplicate bundle names')
  }

  const encoded = await compressInputs(inputs)

  try {
    return {
      ...finish(inputs, tenant, summaryWidth, { encoded }),
      imports: groups.map(group =>
        encodeImport(
          group.location,
          group.inputs.flatMap(input => input.sources),
          group.inputs.map(input => input.name)
        )
      )
    }
  } finally {
    releaseCompressed(encoded)
  }
}
