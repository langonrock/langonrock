import { open } from 'node:fs/promises'

import { writeAll } from '../store/writeall.ts'
import { orderWrites } from './platform.ts'

export async function writeStage(
  path: string,
  bytes: Uint8Array,
  flush: 'file' | 'ordered' = 'file'
): Promise<void> {
  const handle = await open(path, 'wx', 0o600)

  try {
    await writeAll(handle, bytes)

    if (flush === 'ordered') {
      orderWrites(path)
    } else {
      await handle.sync()
    }
  } finally {
    await handle.close()
  }
}
