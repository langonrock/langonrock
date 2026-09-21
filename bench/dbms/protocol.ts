import type { ConceptSlice, TenantReader } from '../../src/index.ts'

export const BASELINE = '1cbcc009bd93814d56410ed3473d65c101f97d8d'
export const SIZES = [500, 5000, 20000]
export const SEED = 7
export const TENANT = 'benchmark'
export const CALLS = 100
export const EDITS = 10
export const EVALUATION_DATE = '2026-09-21T12:00:00.000Z'
export const RELEVANT_TOPICS = [
  ['orders', 'refunds'],
  ['payments'],
  ['sessions'],
  ['subscriptions'],
  ['inventory']
]
export const QUERIES = [
  'orders grain join refunds',
  'settled card wallet authorisation',
  'browsing visit anonymous traffic',
  'subscription billing cycle',
  'inventory warehouse stock'
]

export type Phase = 'import' | 'open' | 'reads' | 'edits' | 'tenants'

export interface Backend {
  put: (tenant: string) => Promise<unknown>
  reader: (tenant: string) => Promise<TenantReader>
  closeReader?: (reader: TenantReader) => void
  search: (reader: TenantReader) => Promise<(query: string) => Promise<string>>
  edit: (content: string) => Promise<void>
  original: () => Promise<string>
  restoreSource: (content: string) => Promise<void>
}

export interface WorkerRequest {
  code: string
  store: string
  source: string
  bundle: string
  path: string
  phase: Phase
  mode: 'legacy' | 'native'
}

export interface Sample {
  phase: Phase
  timings: Record<string, number[]>
  peakRssBytes: number
  steadyRssBytes: number
  checks: Record<string, string | number>
}

export function digest(value: string | Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

export function slices(value: Map<string, ConceptSlice>): string {
  return digest(JSON.stringify([...value]))
}
