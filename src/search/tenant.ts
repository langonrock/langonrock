import { buildIndex, search } from './bm25.ts'

export type { SearchOptions } from '../types.ts'

import type { TenantReader } from '../store/reader.ts'
import type { SearchOptions } from '../types.ts'
import type { Bm25Index, Document } from './bm25.ts'

export const DEFAULT_K = 8

const EMPTY_CELL = '-'

export interface ManifestRow {
  id: string
  bundle: string
  cells: string[]
  links: string[]
}

export interface Manifest {
  comments: string[]
  columns: string
  rows: Map<string, ManifestRow>
}

export interface TenantIndex {
  snapshot: string
  manifest: Manifest
  index: Bm25Index
}

export function parseManifest(tsv: string): Manifest {
  const comments: string[] = []
  const rows = new Map<string, ManifestRow>()
  let columns = ''
  let bundleColumn = -1

  for (const line of tsv.split('\n')) {
    if (line === '') {
      continue
    }

    if (columns === '') {
      if (line.startsWith('id\t')) {
        columns = line
        bundleColumn = line.split('\t').indexOf('bundle')
      } else {
        comments.push(line)
      }

      continue
    }

    const cells = line.split('\t')
    const links = cells[cells.length - 1] ?? EMPTY_CELL

    rows.set(cells[0] ?? '', {
      id: cells[0] ?? '',
      bundle: cells[bundleColumn] ?? '',
      cells,
      links: links === EMPTY_CELL ? [] : links.split(' ')
    })
  }

  return { comments, columns, rows }
}

/**
 * The searchable text is the concept's names (id and frontmatter title), the
 * manifest row, and the body, minus the links column. Link targets are ids,
 * and indexing them would make every concept match its neighbours' names. The
 * title is indexed even though no manifest cell carries it: the compiler
 * strips it from the document, and without this fold a carefully titled
 * concept retrieves worse than an untitled one.
 */
export async function buildTenantIndex(
  reader: TenantReader
): Promise<TenantIndex> {
  const manifest = parseManifest(await reader.manifest())
  const bodies = await reader.get(reader.ids)
  const documents = reader.ids.map(id => {
    const title = reader.titles.get(id)
    const names = title === undefined ? id : `${id} ${title}`
    const cells = manifest.rows.get(id)?.cells.slice(1, -1).join(' ') ?? ''
    const document: Document = { id, names, text: bodies.get(id) ?? '' }

    if (cells !== '') {
      document.fields = cells
    }

    return document
  })

  return {
    snapshot: reader.snapshot,
    manifest,
    index: buildIndex(documents)
  }
}

interface Inbound {
  id: string
  count: number
  rank: number
}

function byInbound(a: Inbound, b: Inbound): number {
  if (a.count !== b.count) {
    return b.count - a.count
  }

  if (a.rank !== b.rank) {
    return a.rank - b.rank
  }

  return a.id < b.id ? -1 : 1
}

/**
 * One deterministic hop over the link graph after ranking. A concept that a hit
 * points at is usually the join partner, the parent dataset, or the metric
 * definition, and finding it costs no model call.
 *
 * Capped at k, and ranked by how many hits point at it. Without the cap a
 * single hub concept drags in everything it links to: on the Stack Overflow
 * sample, one dataset row with 16 outgoing links turned 8 hits into 26 rows,
 * which is most of the manifest. Search that does not narrow is worse than
 * reading the manifest directly.
 */
function expand(
  manifest: Manifest,
  direct: string[],
  k: number,
  keep?: (id: string) => boolean
): string[] {
  const hits = new Set(direct)
  const inbound = new Map<string, Inbound>()

  for (const [rank, id] of direct.entries()) {
    for (const target of manifest.rows.get(id)?.links ?? []) {
      if (
        hits.has(target) ||
        !manifest.rows.has(target) ||
        (keep !== undefined && !keep(target))
      ) {
        continue
      }

      const seen = inbound.get(target)

      if (seen === undefined) {
        inbound.set(target, { id: target, count: 1, rank })
      } else {
        seen.count += 1
      }
    }
  }

  return [...inbound.values()]
    .sort(byInbound)
    .slice(0, k)
    .map(entry => entry.id)
}

function rowsFor(manifest: Manifest, ids: string[]): string[] {
  return ids
    .map(id => manifest.rows.get(id))
    .filter((row): row is ManifestRow => row !== undefined)
    .map(row => row.cells.join('\t'))
}

function keeper(
  manifest: Manifest,
  bundle: string | undefined
): ((id: string) => boolean) | undefined {
  return bundle === undefined
    ? undefined
    : id => manifest.rows.get(id)?.bundle === bundle
}

/**
 * Returns manifest rows, not concept bodies. The agent stays on the two-hop
 * path: narrow with search, then fetch only what it chose with `get`.
 */
export function searchTenant(
  built: TenantIndex,
  query: string,
  options: SearchOptions = {}
): string {
  const k = options.k ?? DEFAULT_K
  const keep = keeper(built.manifest, options.bundle)
  const direct = search(built.index, query, k, keep).map(hit => hit.id)
  const linked =
    options.expand === false ? [] : expand(built.manifest, direct, k, keep)

  const lines = [
    ...built.manifest.comments,
    ...(options.bundle === undefined ? [] : [`# bundle: ${options.bundle}`]),
    `# query: ${query}`,
    `# hits: ${direct.length} direct, ${linked.length} linked`,
    built.manifest.columns,
    ...rowsFor(built.manifest, direct),
    ...rowsFor(built.manifest, linked)
  ]

  return `${lines.join('\n')}\n`
}
