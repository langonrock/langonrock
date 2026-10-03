import { releaseBuffer } from '../buffers.ts'
import { decodeText } from '../text.ts'

export async function readText(file: Bun.BunFile): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())

  try {
    return decodeText(bytes)
  } finally {
    releaseBuffer(bytes)
  }
}
