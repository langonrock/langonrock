import { open, stat, unlink } from 'node:fs/promises'

const STALE_MS = 30_000

export type Release = () => Promise<void>

async function isStale(path: string): Promise<boolean> {
  try {
    const info = await stat(path)

    return Date.now() - info.mtimeMs > STALE_MS
  } catch {
    return false
  }
}

async function create(path: string): Promise<void> {
  const handle = await open(path, 'wx')

  try {
    await handle.write(`${process.pid}\n`)
  } finally {
    await handle.close()
  }
}

/**
 * Readers never take this lock. Snapshots are immutable, so only writers can
 * conflict, and a single writer per tenant is enough to make the whole store
 * safe without transactions.
 */
export async function acquireWriteLock(path: string): Promise<Release> {
  try {
    await create(path)
  } catch (cause) {
    if (!(await isStale(path))) {
      throw new Error(`another writer holds the lock at ${path}`, { cause })
    }

    await unlink(path).catch(() => undefined)
    await create(path)
  }

  return async () => {
    await unlink(path).catch(() => undefined)
  }
}
