const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

export function decodeText(bytes: Uint8Array | ArrayBuffer): string {
  try {
    return decoder.decode(bytes)
  } catch (cause) {
    throw new Error('source must contain valid UTF-8', { cause })
  }
}

export function assertSourceText(content: string): void {
  if (!content.isWellFormed()) {
    throw new Error('source must contain well-formed Unicode')
  }
}
