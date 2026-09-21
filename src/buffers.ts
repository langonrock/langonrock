export function releaseBuffer(bytes: ArrayBufferView): void {
  if (bytes.buffer instanceof ArrayBuffer && bytes.buffer.byteLength !== 0) {
    bytes.buffer.transfer(0)
  }
}

export class Utf8Buffer {
  private bytes = new Uint8Array(4096)

  private encoder = new TextEncoder()

  encode(value: string): Uint8Array {
    const length = Buffer.byteLength(value)

    if (length > this.bytes.length) {
      releaseBuffer(this.bytes)
      this.bytes = new Uint8Array(length)
    }

    this.encoder.encodeInto(value, this.bytes)

    return this.bytes.subarray(0, length)
  }

  close(): void {
    releaseBuffer(this.bytes)
  }
}
