import type { DatabaseTarget } from '../../src/db/types.ts'

export interface Request {
  target: DatabaseTarget
  source: string
  bundle: string
  path: string
  role: 'maintenance' | 'writer' | 'reader' | 'crash' | 'recovery'
  label?: string
}

export interface Sample {
  timings: Record<string, number[]>
  peakRssBytes: number
  rssBytes: number
  checks: Record<string, unknown>
}

export function sample(): Sample {
  return { timings: {}, peakRssBytes: 0, rssBytes: 0, checks: {} }
}

export function memory() {
  const rssBytes = process.memoryUsage().rss
  // Bun 1.4 reports maxRSS in KiB, as Node does; Bun 1.3 used bytes on macOS.
  const peakRssBytes = process.resourceUsage().maxRSS * 1024

  if (peakRssBytes < rssBytes * 0.9) {
    throw new Error('peak RSS units are not bytes on this runtime')
  }

  return { rssBytes, peakRssBytes }
}

export function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}
