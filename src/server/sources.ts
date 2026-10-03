import { mkdir } from 'node:fs/promises'

import { writeAtomic } from '../store/atomic.ts'
import { acquireWriteLock } from '../store/lock.ts'
import { assertTenantId, currentFile } from '../store/paths.ts'

export const SOURCES_FILE = 'sources.json'

const SOURCES_LOCK = 'sources.lock'

const encoder = new TextEncoder()

function assertSourceMap(
  parsed: unknown,
  path: string
): Record<string, string> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must be a JSON object of {"tenant": "directory"}`)
  }

  for (const [tenant, dir] of Object.entries(parsed)) {
    if (typeof dir !== 'string' || dir === '') {
      throw new Error(`${path} has a non-string directory for "${tenant}"`)
    }
  }

  return parsed as Record<string, string>
}

/** Folder registrations for import/watch and unmigrated legacy editing. */
export async function loadSources(root: string): Promise<Map<string, string>> {
  const path = `${root}/${SOURCES_FILE}`
  const file = Bun.file(path)

  if (!(await file.exists())) {
    return new Map()
  }

  return new Map(Object.entries(assertSourceMap(await file.json(), path)))
}

/**
 * Sorted, so a registration that changes nothing leaves the file byte for byte
 * as it was and stays out of the diff of a store kept in git.
 */
async function saveSources(
  root: string,
  sources: Map<string, string>
): Promise<void> {
  const entries = [...sources].sort(([a], [b]) => (a < b ? -1 : 1))

  await mkdir(root, { recursive: true })
  await writeAtomic(
    `${root}/${SOURCES_FILE}`,
    encoder.encode(`${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`)
  )
}

/** Where a tenant nobody configured keeps its Markdown. */
function defaultSourceDir(root: string, tenant: string): string {
  return `${root}/sources/${assertTenantId(tenant)}`
}

/**
 * Asking an agent to persist knowledge for a tenant that does not exist yet is
 * an ordinary first request, not an error, so a write creates the directory and
 * registers it rather than refusing. Only the tenant the caller was already
 * scoped to is ever created, so this grants no reach it did not have.
 *
 * The lock spans the read and the write because registering two tenants at once
 * is a read-modify-write race that would drop one of them from the file with
 * nothing to show for it. It is a try-lock rather than a queue: a second
 * registration arriving mid-flight is refused outright instead of made to wait,
 * which is loud where the race was silent. Within one process the caller
 * memoises this, so the refusal only ever reaches two stores sharing a root.
 */
export async function ensureSource(
  root: string,
  tenant: string
): Promise<string> {
  const configured = (await loadSources(root)).get(tenant)

  if (configured !== undefined) {
    return configured
  }

  // A tenant with snapshots and no entry here was compiled from a directory
  // nobody told the store about, which `sync` on the command line never
  // records. Creating an empty one and compiling it would replace that tenant's
  // whole manifest with a single file, so this is where that stops.
  if (await Bun.file(currentFile(root, tenant)).exists()) {
    throw new Error(
      `tenant "${tenant}" already has knowledge compiled from a directory this store does not know: ` +
        `add it to ${root}/${SOURCES_FILE} before writing, or its source would be replaced by an empty one`
    )
  }

  await mkdir(root, { recursive: true })

  const release = await acquireWriteLock(`${root}/${SOURCES_LOCK}`)

  try {
    const sources = await loadSources(root)
    const existing = sources.get(tenant)

    if (existing !== undefined) {
      return existing
    }

    const dir = defaultSourceDir(root, tenant)

    await mkdir(dir, { recursive: true })
    sources.set(tenant, dir)
    await saveSources(root, sources)

    return dir
  } finally {
    await release()
  }
}
