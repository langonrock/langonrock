import type { Transport } from './client/dsn.ts'
import type { Diagnostic } from './okf/types.ts'

export type { Diagnostic, DiagnosticLevel } from './okf/types.ts'

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
  /**
   * The id this file compiles to, absent when the file is not a concept
   * because it carries no frontmatter. Ids are the shortest unambiguous form
   * of a path, so this is the only reliable way to join a file an editor is
   * showing to the manifest row that describes it, and it moves with the tree:
   * adding a sibling can change it.
   */
  id?: string
}

export interface SourceFile {
  content: string
  hash: string
}

export interface SyncResult {
  snapshot: string
  concepts: number
  bundles: string[]
  /**
   * What the compiler noticed while building this snapshot: a missing `type`,
   * a link that resolves to nothing, a file skipped for having no frontmatter.
   * It is the lint an editor should show, and it is produced whether or not
   * anyone asks for it.
   */
  diagnostics: Diagnostic[]
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
