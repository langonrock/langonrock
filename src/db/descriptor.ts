import { closeSync } from 'node:fs'

export class Descriptor {
  private pending = 0

  private closing = false

  constructor(private readonly value: number) {}

  use<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) {
      throw new Error('database reader is closed')
    }

    this.pending++

    try {
      return operation().finally(() => this.finish())
    } catch (cause) {
      this.finish()

      throw cause
    }
  }

  close(): void {
    if (!this.closing) {
      this.closing = true

      if (this.pending === 0) {
        closeSync(this.value)
      }
    }
  }

  private finish(): void {
    this.pending--

    if (this.closing && this.pending === 0) {
      closeSync(this.value)
    }
  }
}
