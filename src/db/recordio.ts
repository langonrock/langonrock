import { corruption } from './errors.ts'

export const METADATA_RECORD_LIMIT = 64 * 1024 * 1024 + 48

export async function readBounded(
  path: string,
  limit: number
): Promise<Uint8Array> {
  const bytes = new Uint8Array(
    await Bun.file(path)
      .slice(0, limit + 1)
      .arrayBuffer()
  )

  if (bytes.length > limit) {
    throw corruption('record exceeds size limit')
  }

  return bytes
}
