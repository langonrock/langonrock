import { readFile } from 'node:fs/promises'

import { checkBytes, checkHeader } from './integrity.ts'

import { HEADER_BYTES, decodeBlob, parseDir, parseHeader } from './format.ts'
import { currentFile, snapshotFile } from './paths.ts'
import { sliceConcept } from './slice.ts'
import { readBytes as slice } from './readbytes.ts'
import { releaseBuffer } from '../buffers.ts'

import type { ConceptSlice, GetOptions } from '../types.ts'
import type { DirEntry, TntHeader } from './format.ts'
import type { SnapshotAccess } from './integrity.ts'

const decoder = new TextDecoder()

const BUNDLE_COLUMN = 'bundle'

export interface TenantReader {
  snapshot: string
  ids: string[]
  /** Frontmatter titles by id, only for concepts that have one. */
  titles: Map<string, string>
  manifest: (bundle?: string) => Promise<string>
  get: (
    ids: string[],
    options?: GetOptions
  ) => Promise<Map<string, ConceptSlice>>
  /**
   * Every body in id order, decompressed one at a time off a single read of
   * the blobs region. For whole-tenant consumers like the search index build,
   * where per-id `get` would cost one file read per concept.
   */
  bodies: () => Promise<Iterable<[string, string]>>
}

/**
 * Rows arrive grouped by bundle, so one bundle is one run of lines. Splitting
 * happens once per reader and only when a filtered manifest is first asked
 * for; the unfiltered read stays a straight slice of the snapshot.
 */
function splitByBundle(manifest: string): Map<string, string> {
  const preamble: string[] = []
  const rows = new Map<string, string[]>()
  let column = -1
  let inRows = false

  for (const line of manifest.split('\n')) {
    if (line === '') {
      continue
    }

    if (!inRows) {
      preamble.push(line)

      if (line.startsWith('id\t')) {
        inRows = true
        column = line.split('\t').indexOf(BUNDLE_COLUMN)
      }

      continue
    }

    const name = line.split('\t')[column] ?? ''
    const existing = rows.get(name)

    if (existing === undefined) {
      rows.set(name, [line])
    } else {
      existing.push(line)
    }
  }

  if (column === -1) {
    throw new Error('manifest has no bundle column')
  }

  return new Map(
    [...rows].map(([name, lines]) => [
      name,
      `${[...preamble, ...lines].join('\n')}\n`
    ])
  )
}

async function readCurrent(root: string, tenant: string): Promise<string> {
  const raw = await readFile(currentFile(root, tenant), 'utf8')
  const snapshot = raw.trim()

  if (snapshot === '') {
    throw new Error(`tenant "${tenant}" has an empty current pointer`)
  }

  return snapshot
}

function sliceSection(
  content: string,
  entry: DirEntry,
  section: string | undefined
): string | undefined {
  if (section === undefined) {
    return content
  }

  const range = entry.sections[section]

  return range === undefined ? undefined : content.slice(range.start, range.end)
}

async function readBodies(
  path: string | number,
  header: TntHeader,
  entries: DirEntry[]
): Promise<Iterable<[string, string]>> {
  const region = await slice(path, header.blobsOffset, header.blobsLength)

  return (function* (): Generator<[string, string]> {
    try {
      for (const entry of entries) {
        yield [
          entry.id,
          decodeBlob(
            region.subarray(entry.offset, entry.offset + entry.length),
            entry.checksum
          )
        ]
      }
    } finally {
      releaseBuffer(region)
    }
  })()
}

function indexEntries(entries: DirEntry[]) {
  const byId = new Map<string, DirEntry>()
  const ids: string[] = []
  const titles = new Map<string, string>()
  const stale = new Map<string, string>()

  for (const entry of entries) {
    byId.set(entry.id, entry)
    ids.push(entry.id)

    if (entry.title !== undefined) {
      titles.set(entry.id, entry.title)
    }

    if (entry.staleAfter !== undefined) {
      stale.set(entry.id, entry.staleAfter)
    }
  }

  return { byId, ids, titles, stale }
}

/** ISO dates order as strings, so the clock touches nothing but `today`. */
function expiredOf(dates: Map<string, string>, today: string): Set<string> {
  const expired = new Set<string>()

  for (const [id, date] of dates) {
    if (date < today) {
      expired.add(id)
    }
  }

  return expired
}

/**
 * Rewrites the status cell of expired rows to `stale`, leaving any explicit
 * status alone: `deprecated` already says more than `stale` would. Demotion
 * happens here, at render time, because a compile-time comparison against the
 * clock would break the byte-determinism of the snapshot. The search index
 * parses this same rendered manifest, so search rows inherit the demotion
 * when the index is next built.
 */
function demote(manifest: string, expired: Set<string>): string {
  const lines = manifest.split('\n')
  let status = -1

  return lines
    .map(line => {
      if (status === -1) {
        if (line.startsWith('id\t')) {
          status = line.split('\t').indexOf('status')
        }

        return line
      }

      const cells = line.split('\t')

      if (!expired.has(cells[0] ?? '') || cells[status] !== '-') {
        return line
      }

      cells[status] = 'stale'

      return cells.join('\t')
    })
    .join('\n')
}

async function readEntry(
  path: string | number,
  header: TntHeader,
  entry: DirEntry
): Promise<string> {
  const bytes = await slice(
    path,
    header.blobsOffset + entry.offset,
    entry.length
  )

  return decodeBlob(bytes, entry.checksum)
}

/**
 * Opening reads the header and the directory only. Blobs stay on disk until an
 * id is actually requested, and a batch fetches them concurrently so N concepts
 * cost one round trip rather than N.
 */
export async function openTenant(
  root: string,
  tenant: string
): Promise<TenantReader> {
  const snapshot = await readCurrent(root, tenant)

  return openSnapshot(root, tenant, snapshot)
}

async function metadata(
  root: string,
  tenant: string,
  snapshot: string,
  access?: SnapshotAccess
): Promise<{ path: string | number; header: TntHeader; entries: DirEntry[] }> {
  const path = access?.descriptor ?? snapshotFile(root, tenant, snapshot)

  if (access?.cached !== undefined) {
    return {
      path,
      header: access.cached.header,
      entries: access.cached.entries
    }
  }

  const headerBytes = await slice(path, 0, HEADER_BYTES)

  if (access !== undefined) {
    checkBytes(headerBytes, access.checksums.header)
  }

  const header = parseHeader(headerBytes)

  if (access !== undefined) {
    checkHeader(header, access.size)
  }

  const dirBytes = await slice(path, header.dirOffset, header.dirLength)

  if (access !== undefined) {
    checkBytes(dirBytes, access.checksums.directory)
  }

  const entries = parseDir(dirBytes)

  return { path, header, entries }
}

export async function openSnapshot(
  root: string,
  tenant: string,
  snapshot: string,
  access?: SnapshotAccess
): Promise<TenantReader> {
  const { path, header, entries } = await metadata(
    root,
    tenant,
    snapshot,
    access
  )
  const { byId, ids, titles, stale } = indexEntries(entries)

  // A snapshot never changes, so the manifest it holds is worth keeping once it
  // has been read: it is the one region asked for on every turn.
  let text: string | undefined = access?.cached?.manifest
  let byBundle: Map<string, string> | undefined

  const manifest = async (bundle?: string): Promise<string> => {
    if (text === undefined) {
      const bytes = await slice(
        path,
        header.manifestOffset,
        header.manifestLength
      )

      if (access !== undefined) {
        checkBytes(bytes, access.checksums.manifest)
      }

      text = decoder.decode(bytes)
    }

    let base = text

    if (bundle !== undefined) {
      byBundle ??= splitByBundle(text)

      const found = byBundle.get(bundle)

      if (found === undefined) {
        throw new Error(
          `no bundle "${bundle}" in this tenant: found ${[...byBundle.keys()].join(', ')}`
        )
      }

      base = found
    }

    const expired = expiredOf(stale, new Date().toISOString().slice(0, 10))

    return expired.size === 0 ? base : demote(base, expired)
  }

  const get = async (
    ids: string[],
    options?: GetOptions
  ): Promise<Map<string, ConceptSlice>> => {
    const wanted = ids
      .map(id => byId.get(id))
      .filter((entry): entry is DirEntry => entry !== undefined)

    const contents = await Promise.all(
      wanted.map(entry => readEntry(path, header, entry))
    )

    const found = new Map<string, ConceptSlice>()

    for (const [index, entry] of wanted.entries()) {
      const value = sliceSection(contents[index] ?? '', entry, options?.section)

      if (value !== undefined) {
        found.set(entry.id, sliceConcept(value, options))
      }
    }

    return found
  }

  return {
    snapshot,
    ids,
    titles,
    manifest,
    get,
    bodies: () => readBodies(path, header, entries)
  }
}
