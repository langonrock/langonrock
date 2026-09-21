import { deriveIds } from '../okf/ids.ts'

import type { Manifest } from '../compile/parsed.ts'
import type { Concept } from '../okf/types.ts'
import type { DirEntry } from '../store/format.ts'
import type { SourceRecord } from './types.ts'

interface Metadata {
  manifest: Manifest
  directory: Map<string, DirEntry>
}

function conceptOf(
  entry: SourceRecord,
  local: Map<string, string>,
  metadata: Metadata
): Concept {
  const global = entry.id ?? ''
  const row = metadata.manifest.rows.get(global)
  const directory = metadata.directory.get(global)

  if (row === undefined || directory === undefined) {
    throw new Error('database corruption: compiled document is missing')
  }

  return {
    id: local.get(global) ?? global,
    path: entry.path,
    kind: row.cells[2] ?? '-',
    status: row.cells[3] ?? '-',
    grain: row.cells[4] ?? '-',
    summary: row.cells[5] ?? '-',
    links: row.links.map(link => local.get(link) ?? link),
    title: directory.title ?? '',
    staleAfter: directory.staleAfter ?? ''
  }
}

export function storedConcepts(
  entries: SourceRecord[],
  metadata: Metadata
): Concept[] {
  const concepts = entries.filter(entry => entry.id !== undefined)
  const ids = deriveIds(concepts.map(entry => entry.path))
  const local = new Map(
    concepts.map(entry => [entry.id ?? '', ids.get(entry.path) ?? entry.path])
  )

  return concepts.map(entry => conceptOf(entry, local, metadata))
}
