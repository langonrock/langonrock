interface Writable {
  write: (
    bytes: Uint8Array,
    offset: number,
    length: number,
    position: number
  ) => Promise<{ bytesWritten: number }>
}

export async function writeAll(
  handle: Writable,
  bytes: Uint8Array
): Promise<void> {
  let offset = 0

  while (offset < bytes.byteLength) {
    const remaining = bytes.byteLength - offset
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      remaining,
      offset
    )

    if (
      !Number.isInteger(bytesWritten) ||
      bytesWritten <= 0 ||
      bytesWritten > remaining
    ) {
      throw new Error('file write made invalid progress')
    }

    offset += bytesWritten
  }
}
