const HASH = /^[a-f0-9]{64}$/
const HEADER_BYTES = 48
const MAX_METADATA = 64 * 1024 * 1024

export function hash(bytes: string | Uint8Array): string {
  return Bun.CryptoHasher.hash('sha256', bytes, 'hex')
}

export function assertHash(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !HASH.test(value)) {
    throw new Error('database corruption: invalid content digest')
  }
}

export function frame(
  magic: string,
  metadata: unknown,
  payload: Uint8Array | (string | Uint8Array)[] = new Uint8Array()
): Uint8Array {
  const json = JSON.stringify(metadata)
  const length = Buffer.byteLength(json)
  const chunks = Array.isArray(payload) ? payload : [payload]
  const payloadLength = chunks.reduce(
    (total, bytes) => total + chunkLength(bytes),
    0
  )

  if (
    magic.length !== 4 ||
    length > MAX_METADATA ||
    payloadLength > 0xffffffff
  ) {
    throw new Error('database record exceeds format limits')
  }

  const bytes = Buffer.allocUnsafeSlow(HEADER_BYTES + length + payloadLength)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  bytes.set(new TextEncoder().encode(magic))
  view.setUint32(4, 1, true)
  view.setUint32(8, length, true)
  view.setUint32(12, payloadLength, true)
  bytes.write(json, HEADER_BYTES, length, 'utf8')
  bytes.set(
    Bun.CryptoHasher.hash(
      'sha256',
      bytes.subarray(HEADER_BYTES, HEADER_BYTES + length)
    ),
    16
  )
  let cursor = HEADER_BYTES + length

  for (const chunk of chunks) {
    if (typeof chunk === 'string') {
      cursor += bytes.write(chunk, cursor, chunkLength(chunk), 'utf8')
    } else {
      bytes.set(chunk, cursor)
      cursor += chunk.length
    }
  }

  return bytes
}

function chunkLength(chunk: string | Uint8Array): number {
  return typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
}

export function unframe(
  bytes: Uint8Array,
  magic: string
): { metadata: unknown; payload: Uint8Array } {
  if (
    bytes.length < HEADER_BYTES ||
    new TextDecoder().decode(bytes.subarray(0, 4)) !== magic
  ) {
    throw new Error('database corruption: invalid record header')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const metadataSize = view.getUint32(8, true)
  const payloadSize = view.getUint32(12, true)

  if (
    view.getUint32(4, true) !== 1 ||
    metadataSize > MAX_METADATA ||
    HEADER_BYTES + metadataSize + payloadSize !== bytes.length
  ) {
    throw new Error('database corruption: unsupported or truncated record')
  }

  const json = bytes.subarray(HEADER_BYTES, HEADER_BYTES + metadataSize)
  const digest = new Bun.CryptoHasher('sha256').update(json).digest()

  if (!Buffer.from(digest).equals(bytes.subarray(16, HEADER_BYTES))) {
    throw new Error('database corruption: metadata checksum mismatch')
  }

  return {
    metadata: JSON.parse(new TextDecoder().decode(json)) as unknown,
    payload: bytes.subarray(HEADER_BYTES + metadataSize)
  }
}
