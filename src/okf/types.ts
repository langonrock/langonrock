export type Frontmatter = Record<string, unknown>

export interface ParsedFile {
  data: Frontmatter
  body: string
  error?: string
}

export interface Concept {
  id: string
  path: string
  kind: string
  status: string
  grain: string
  summary: string
  /** Frontmatter title. Never a manifest cell; carried for the search index. */
  title: string
  /**
   * ISO date after which the concept is no longer trusted, empty when none.
   * Stored rather than judged: comparing it to the clock at compile time
   * would make the snapshot bytes depend on the day, so the reader demotes.
   */
  staleAfter: string
  links: string[]
}

export type DiagnosticLevel = 'warn' | 'error'

export interface Diagnostic {
  level: DiagnosticLevel
  path: string
  message: string
}
