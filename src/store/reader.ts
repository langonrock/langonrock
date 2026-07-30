import { readFile } from 'node:fs/promises'

import { HEADER_BYTES, decodeBlob, parseDir, parseHeader } from './format.ts'
import { currentFile, snapshotFile } from './paths.ts'

import type { DirEntry, TntHeader } from './format.ts'

const decoder = new TextDecoder()

export interface TenantReader {
  snapshot: string
  ids: string[]
  manifest: () => Promise<string>
  get: (ids: string[], section?: string) => Promise<Map<string, string>>
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

  const manifest = async (): Promise<string> =>
    decoder.decode(
      await slice(path, header.manifestOffset, header.manifestLength)
    )

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

  return { snapshot, ids: entries.map(entry => entry.id), manifest, get }
}
