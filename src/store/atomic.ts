import { open, rename } from 'node:fs/promises'

export async function writeSynced(
  path: string,
  bytes: Uint8Array,
  mode?: number
): Promise<void> {
  const handle = await open(path, 'w', mode)

  try {
    // `open` only applies a mode when it creates the file, so a temp left
    // behind by a crash would keep its old one and the bytes about to be
    // written would inherit it.
    if (mode !== undefined) {
      await handle.chmod(mode)
    }

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
  bytes: Uint8Array,
  mode?: number
): Promise<void> {
  const temp = `${path}.tmp`

  // The mode goes on the temp file, not on the target after the rename: a
  // secret written world-readable and tightened a moment later was still
  // readable for that moment.
  await writeSynced(temp, bytes, mode)
  await rename(temp, path)
  await syncDir(parentOf(path))
}
