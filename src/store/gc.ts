import { readFile, readdir, stat, unlink } from 'node:fs/promises'

import { HEADER_BYTES, parseHeader } from './format.ts'
import { acquireWriteLock } from './lock.ts'
import { currentFile, lockFile, snapshotsDir, tenantDir } from './paths.ts'

export const DEFAULT_KEEP = 10
export const DEFAULT_GRACE_MS = 3_600_000

const SNAPSHOT = '.tnt'
const PARTIAL = '.tnt.tmp'

export interface GcOptions {
  root: string
  tenant: string
  keep?: number
  graceMs?: number
  dryRun?: boolean
}

export interface Skipped {
  name: string
  reason: string
}

export interface GcResult {
  tenant: string
  current: string
  currentCorrupt: boolean
  kept: number
  removed: string[]
  partials: string[]
  corrupt: string[]
  skipped: Skipped[]
  bytesFreed: number
}

interface Candidate {
  name: string
  path: string
  modified: number
  size: number
  corrupt: boolean
}

export async function listTenants(root: string): Promise<string[]> {
  const entries = await readdir(`${root}/tenants`, { withFileTypes: true })

  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

/**
 * A snapshot whose header points past the end of the file is garbage, not data.
 * Checking it costs one stat and 32 bytes, and it is the only cheap way to spot
 * a truncated snapshot left behind by a crash before the writer used a temp.
 */
async function inspect(dir: string, name: string): Promise<Candidate> {
  const path = `${dir}/${name}`
  const info = await stat(path)
  let corrupt = false

  try {
    const head = new Uint8Array(
      await Bun.file(path).slice(0, HEADER_BYTES).arrayBuffer()
    )
    const header = parseHeader(head)

    corrupt = header.blobsOffset + header.blobsLength > info.size
  } catch {
    corrupt = true
  }

  return { name, path, modified: info.mtimeMs, size: info.size, corrupt }
}

function retain(
  candidates: Candidate[],
  current: string,
  keep: number
): Set<string> {
  const newest = [...candidates]
    .sort((a, b) => b.modified - a.modified)
    .filter(candidate => !candidate.corrupt)
    .slice(0, keep)
    .map(candidate => candidate.name)

  return new Set([`${current}${SNAPSHOT}`, ...newest])
}

async function remove(
  path: string,
  dryRun: boolean
): Promise<string | undefined> {
  if (dryRun) {
    return undefined
  }

  try {
    await unlink(path)

    return undefined
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}

interface Sweep {
  removed: string[]
  skipped: Skipped[]
  bytesFreed: number
}

/**
 * Grace exists because a reader holds a path, not a file handle: it parses the
 * directory on open and slices blobs later. Deleting a snapshot out from under
 * one would fail its next `get`, so nothing recently written is ever collected.
 */
async function sweep(
  candidates: Candidate[],
  cutoff: number,
  dryRun: boolean
): Promise<Sweep> {
  const removed: string[] = []
  const skipped: Skipped[] = []
  let bytesFreed = 0

  for (const candidate of candidates) {
    if (candidate.modified > cutoff) {
      skipped.push({ name: candidate.name, reason: 'within the grace period' })
      continue
    }

    const failure = await remove(candidate.path, dryRun)

    if (failure === undefined) {
      removed.push(candidate.name)
      bytesFreed += candidate.size
    } else {
      skipped.push({ name: candidate.name, reason: failure })
    }
  }

  return { removed, skipped, bytesFreed }
}

async function readCurrent(root: string, tenant: string): Promise<string> {
  return (await readFile(currentFile(root, tenant), 'utf8')).trim()
}

/**
 * Takes the write lock, so it can never race a `put` mid-rename. Deletion
 * failures are reported rather than thrown: on Windows a snapshot another
 * process still holds cannot be unlinked, and the right response is to leave
 * it for the next run.
 */
export async function collect(options: GcOptions): Promise<GcResult> {
  const { root, tenant } = options

  if (await Bun.file(`${tenantDir(root, tenant)}/HEAD`).exists()) {
    throw new Error(
      'tenant uses database ownership; run native collection through the public API'
    )
  }

  const keep = options.keep ?? DEFAULT_KEEP
  const cutoff = Date.now() - (options.graceMs ?? DEFAULT_GRACE_MS)
  const dryRun = options.dryRun === true
  const dir = snapshotsDir(root, tenant)
  const current = await readCurrent(root, tenant)
  const release = await acquireWriteLock(lockFile(root, tenant))

  try {
    const entries = await readdir(dir)
    const partials = entries.filter(name => name.endsWith(PARTIAL))
    const candidates = await Promise.all(
      entries
        .filter(name => name.endsWith(SNAPSHOT))
        .map(name => inspect(dir, name))
    )

    const retained = retain(candidates, current, keep)
    const collectable = candidates.filter(
      candidate =>
        candidate.name !== `${current}${SNAPSHOT}` &&
        (candidate.corrupt || !retained.has(candidate.name))
    )

    const swept = await sweep(
      [
        ...collectable,
        ...(await Promise.all(partials.map(name => inspect(dir, name))))
      ],
      cutoff,
      dryRun
    )

    return {
      tenant,
      current,
      currentCorrupt:
        candidates.find(c => c.name === `${current}${SNAPSHOT}`)?.corrupt ??
        true,
      kept: retained.size,
      removed: swept.removed.filter(name => name.endsWith(SNAPSHOT)),
      partials: swept.removed.filter(name => name.endsWith(PARTIAL)),
      corrupt: candidates.filter(c => c.corrupt).map(c => c.name),
      skipped: swept.skipped,
      bytesFreed: swept.bytesFreed
    }
  } finally {
    await release()
  }
}

export async function collectAll(
  options: Omit<GcOptions, 'tenant'>
): Promise<GcResult[]> {
  const tenants = await listTenants(options.root)
  const results: GcResult[] = []

  for (const tenant of tenants) {
    results.push(await collect({ ...options, tenant }))
  }

  return results
}
