import { open, rename } from 'node:fs/promises'

export async function writeSynced(
  path: string,
  bytes: Uint8Array
): Promise<void> {
  const handle = await open(path, 'w')

  try {
    await handle.write(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * POSIX needs the parent directory flushed before a rename is durable. Windows
 * offers no equivalent and does not need one.
 */
export async function syncDir(path: string): Promise<void> {
  if (process.platform === 'win32') {
    return
  }

  const handle = await open(path, 'r')

  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function parentOf(path: string): string {
  const cut = path.replaceAll('\\', '/').lastIndexOf('/')

  return cut <= 0 ? '/' : path.slice(0, cut)
}

/**
 * A reader must never observe a half-written file. Writing to a temp name and
 * renaming means the target either holds the previous bytes or all of the new
 * ones, which is the same discipline the snapshot writer uses.
 */
export async function writeAtomic(
  path: string,
  bytes: Uint8Array
): Promise<void> {
  const temp = `${path}.tmp`

  await writeSynced(temp, bytes)
  await rename(temp, path)
  await syncDir(parentOf(path))
}
