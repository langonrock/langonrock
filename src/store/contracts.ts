import type { Diagnostic } from '../okf/types.ts'

export const DEFAULT_KEEP = 10
export const DEFAULT_GRACE_MS = 3_600_000

export interface PutOptions {
  root: string
  tenant: string
  bundle?: string
  summaryWidth?: number
}

export interface PutResult {
  snapshot: string
  bundles: string[]
  concepts: number
  bytes: number
  reused: boolean
  diagnostics: Diagnostic[]
}

export interface GcOptions {
  root: string
  tenant: string
  keep?: number
  graceMs?: number
  dryRun?: boolean
}

interface Skipped {
  name: string
  reason: string
}

export interface GcResult {
  tenant: string
  current: string
  currentCorrupt: boolean
  kept: number
  removed: string[]
  partials: string[]
  corrupt: string[]
  skipped: Skipped[]
  bytesFreed: number
}
