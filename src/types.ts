import type { Transport } from './client/dsn.ts'

/**
 * The contract shared by every transport, kept free of any runtime import so a
 * client can be built against it without pulling the store, and therefore
 * without needing Bun. Everything here is types only.
 */
export interface SearchOptions {
  k?: number
  expand?: boolean
  bundle?: string
}

export interface SourceEntry {
  bundle: string
  path: string
  bytes: number
  hash: string
}

export interface SourceFile {
  content: string
  hash: string
}

export interface SyncResult {
  snapshot: string
  concepts: number
  bundles: string[]
}

/**
 * The same four verbs for reading, plus the source side an editor needs. A
 * write names the version it replaces, or nothing at all to create, so losing
 * someone else's edit takes deliberate effort rather than a forgotten header.
 */
export interface Connection {
  readonly transport: Transport
  snapshot: () => Promise<string>
  manifest: (bundle?: string) => Promise<string>
  get: (ids: string[], section?: string) => Promise<Map<string, string>>
  search: (query: string, options?: SearchOptions) => Promise<string>
  listSource: () => Promise<SourceEntry[]>
  readSource: (bundle: string, path: string) => Promise<SourceFile | undefined>
  writeSource: (
    bundle: string,
    path: string,
    content: string,
    replaces?: string
  ) => Promise<string>
  deleteSource: (
    bundle: string,
    path: string,
    replaces: string
  ) => Promise<void>
  deleteBundle: (bundle: string) => Promise<void>
  sync: () => Promise<SyncResult>
  close: () => Promise<void>
}
