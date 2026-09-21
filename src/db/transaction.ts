import { decodeBlob, parseDir, parseHeader } from '../store/format.ts'
import { parseManifest } from '../compile/parsed.ts'
import { applyChanges } from './changes.ts'
import { storedConcepts } from './compiled.ts'
import { finish } from './documents.ts'
import { compileInput, mergeInput } from './input.ts'
import { reconstruct } from './reader.ts'

import type { DocumentChange } from '../types.ts'
import type { DirEntry, CompressedBody } from '../store/format.ts'
import type { BaseData } from './base.ts'
import type { ReusableContent } from './documents.ts'
import type { CompiledInput } from './input.ts'
import type { SourceRecord, Prepared } from './types.ts'
import type { WriteMetadata } from './writecache.ts'

interface Preparation {
  base: BaseData
  directory: Map<string, DirEntry>
  metadata: WriteMetadata
  reuse: Required<Omit<ReusableContent, 'encoded'>>
}

function storedBlock(state: Preparation, entry: SourceRecord) {
  const body = entry.body
  const directory =
    entry.id === undefined ? undefined : state.directory.get(entry.id)

  if (body === undefined || directory === undefined) {
    throw new Error(
      'database corruption: source points to a missing compiled body'
    )
  }

  return {
    entry: directory,
    bytes: state.base.snapshot.subarray(body.offset, body.offset + body.length)
  }
}

function unchangedInput(
  state: Preparation,
  name: string,
  entries: SourceRecord[]
): CompiledInput {
  const stored = state.base.archive.bundles.find(bundle => bundle.name === name)

  if (stored === undefined) {
    throw new Error('database corruption: missing bundle compilation metadata')
  }

  const sources = entries.map(entry => {
    if (entry.id !== undefined) {
      state.reuse.unchanged.set(
        `${name}/${entry.path}`,
        storedBlock(state, entry)
      )
    }

    return {
      bundle: name,
      path: entry.path,
      hash: entry.hash,
      bytes: entry.bytes,
      prefix: state.base.archive.payload.subarray(
        entry.offset,
        entry.offset + entry.length
      )
    }
  })

  const concepts = state.metadata.concepts.get(name)

  if (concepts === undefined) {
    throw new Error('database corruption: missing bundle concepts')
  }

  return {
    name,
    sources,
    result: { concepts, diagnostics: stored.diagnostics, bodies: new Map() }
  }
}

function documentsOf(state: Preparation, entries: SourceRecord[]) {
  return entries.map(entry => {
    let content = ''

    if (entry.id !== undefined) {
      const block = storedBlock(state, entry)

      content = decodeBlob(block.bytes, block.entry.checksum)
      state.reuse.bodies.set(entry.id, {
        content,
        bytes: block.bytes,
        checksum: block.entry.checksum ?? 0
      })
    }

    return reconstruct(state.base.archive, entry, content)
  })
}

function replacementInput(
  state: Preparation,
  previous: CompiledInput,
  entries: SourceRecord[],
  changes: DocumentChange[]
): CompiledInput {
  const paths = new Set(changes.map(change => change.path))
  const documents = documentsOf(
    state,
    entries.filter(entry => paths.has(entry.path))
  )
  const updated = applyChanges(documents, changes)
  const ids = new Map(
    previous.result.concepts.map(concept => [concept.path, concept.id])
  )
  const current = compileInput(
    previous.name,
    updated,
    state.base.summaryWidth,
    ids
  )

  for (const path of paths) {
    state.reuse.unchanged.delete(`${previous.name}/${path}`)
  }

  return mergeInput(previous, current)
}

function changedInput(
  state: Preparation,
  name: string,
  entries: SourceRecord[],
  changes: DocumentChange[]
): CompiledInput | undefined {
  const paths = new Set(entries.map(entry => entry.path))

  if (
    changes.every(
      change => change.operation === 'write' && paths.has(change.path)
    )
  ) {
    return replacementInput(
      state,
      unchangedInput(state, name, entries),
      entries,
      changes
    )
  }

  const updated = applyChanges(documentsOf(state, entries), changes)

  return updated.length === 0
    ? undefined
    : compileInput(name, updated, state.base.summaryWidth)
}

function readMetadata(base: BaseData): WriteMetadata {
  const header = parseHeader(base.snapshot)
  const entries = parseDir(
    base.snapshot.subarray(header.dirOffset, header.blobsOffset)
  )
  const directory = new Map(entries.map(entry => [entry.id, entry]))
  const text = new TextDecoder().decode(
    base.snapshot.subarray(header.manifestOffset, header.dirOffset)
  )
  const manifest = parseManifest(text)
  const sources = Map.groupBy(base.archive.entries, entry => entry.bundle)

  return {
    archive: base.archive,
    directory,
    reader: { header, entries, manifest: text },
    concepts: new Map(
      base.archive.bundles.map(bundle => [
        bundle.name,
        storedConcepts(sources.get(bundle.name) ?? [], { directory, manifest })
      ])
    )
  }
}

export function prepareChanges(
  base: BaseData,
  changes: DocumentChange[],
  tenant: string,
  bundleNames?: string[]
): Prepared {
  const metadata = base.metadata ?? readMetadata(base)
  const sources = Map.groupBy(base.archive.entries, entry => entry.bundle)
  const grouped = Map.groupBy(changes, change => change.bundle)
  const state: Preparation = {
    base,
    directory: metadata.directory,
    metadata,
    reuse: {
      capture: true,
      bodies: new Map<string, CompressedBody>(),
      unchanged: new Map()
    }
  }
  const names =
    bundleNames ??
    [
      ...new Set([
        ...base.archive.bundles.map(bundle => bundle.name),
        ...grouped.keys()
      ])
    ].sort()
  const inputs: CompiledInput[] = []

  for (const name of names) {
    const entries = sources.get(name) ?? []
    const mutations = grouped.get(name)
    const input =
      mutations === undefined
        ? metadata.concepts.has(name)
          ? unchangedInput(state, name, entries)
          : compileInput(name, [], base.summaryWidth)
        : changedInput(state, name, entries, mutations)

    if (input !== undefined) {
      inputs.push(input)
    } else if (bundleNames !== undefined) {
      inputs.push(compileInput(name, [], base.summaryWidth))
    }
  }

  return finish(inputs, tenant, base.summaryWidth, state.reuse)
}
