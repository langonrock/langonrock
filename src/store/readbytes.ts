import { read as readCallback } from 'node:fs'
import { promisify } from 'node:util'

const read = promisify(readCallback)

export async function readBytes(
  path: string | number,
  offset: number,
  length: number
): Promise<Uint8Array> {
  if (typeof path === 'string') {
    return new Uint8Array(
      await Bun.file(path)
        .slice(offset, offset + length)
        .arrayBuffer()
    )
  }

  const bytes = new Uint8Array(length)
  let cursor = 0

  while (cursor < length) {
    const { bytesRead } = await read(
      path,
      bytes,
      cursor,
      length - cursor,
      offset + cursor
    )

    if (bytesRead === 0) {
      throw new Error('database corruption: truncated snapshot')
    }

    cursor += bytesRead
  }

  return bytes
}
