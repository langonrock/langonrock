import { readFile } from 'node:fs/promises'

import { HEADER_BYTES, decodeBlob, parseDir, parseHeader } from './format.ts'
import { currentFile, snapshotFile } from './paths.ts'

import type { DirEntry, TntHeader } from './format.ts'

const decoder = new TextDecoder()

const BUNDLE_COLUMN = 'bundle'

export interface TenantReader {
  snapshot: string
  ids: string[]
  /** Frontmatter titles by id, only for concepts that have one. */
  titles: Map<string, string>
  manifest: (bundle?: string) => Promise<string>
  get: (ids: string[], section?: string) => Promise<Map<string, string>>
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

async function slice(
  path: string,
  offset: number,
  length: number
): Promise<Uint8Array> {
  const bytes = await Bun.file(path)
    .slice(offset, offset + length)
    .arrayBuffer()

  return new Uint8Array(bytes)
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
  path: string,
  header: TntHeader,
  entries: DirEntry[]
): Promise<Iterable<[string, string]>> {
  const region = await slice(path, header.blobsOffset, header.blobsLength)

  return (function* (): Generator<[string, string]> {
    for (const entry of entries) {
      yield [
        entry.id,
        decodeBlob(region.subarray(entry.offset, entry.offset + entry.length))
      ]
    }
  })()
}

function titlesOf(entries: DirEntry[]): Map<string, string> {
  const titles = new Map<string, string>()

  for (const entry of entries) {
    if (entry.title !== undefined) {
      titles.set(entry.id, entry.title)
    }
  }

  return titles
}

async function readEntry(
  path: string,
  header: TntHeader,
  entry: DirEntry
): Promise<string> {
  const bytes = await slice(
    path,
    header.blobsOffset + entry.offset,
    entry.length
  )

  return decodeBlob(bytes)
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
  const path = snapshotFile(root, tenant, snapshot)
  const header = parseHeader(await slice(path, 0, HEADER_BYTES))
  const entries = parseDir(
    await slice(path, header.dirOffset, header.dirLength)
  )
  const byId = new Map(entries.map(entry => [entry.id, entry]))

  // A snapshot never changes, so the manifest it holds is worth keeping once it
  // has been read: it is the one region asked for on every turn.
  let text: string | undefined
  let byBundle: Map<string, string> | undefined

  const manifest = async (bundle?: string): Promise<string> => {
    text ??= decoder.decode(
      await slice(path, header.manifestOffset, header.manifestLength)
    )

    if (bundle === undefined) {
      return text
    }

    byBundle ??= splitByBundle(text)

    const found = byBundle.get(bundle)

    if (found === undefined) {
      throw new Error(
        `no bundle "${bundle}" in this tenant: found ${[...byBundle.keys()].join(', ')}`
      )
    }

    return found
  }

  const get = async (
    ids: string[],
    section?: string
  ): Promise<Map<string, string>> => {
    const wanted = ids
      .map(id => byId.get(id))
      .filter((entry): entry is DirEntry => entry !== undefined)

    const contents = await Promise.all(
      wanted.map(entry => readEntry(path, header, entry))
    )

    const found = new Map<string, string>()

    for (const [index, entry] of wanted.entries()) {
      const value = sliceSection(contents[index] ?? '', entry, section)

      if (value !== undefined) {
        found.set(entry.id, value)
      }
    }

    return found
  }

  return {
    snapshot,
    ids: entries.map(entry => entry.id),
    titles: titlesOf(entries),
    manifest,
    get,
    bodies: () => readBodies(path, header, entries)
  }
}
