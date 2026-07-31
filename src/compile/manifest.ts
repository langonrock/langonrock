import { hasFrontmatter, parseFrontmatter } from '../okf/frontmatter.ts'
import { deriveIds } from '../okf/ids.ts'
import { resolveLinks } from '../okf/links.ts'
import { basename, scanBundle, toPosix } from '../okf/scan.ts'
import {
  EMPTY_CELL,
  deriveSummary,
  normalizeKind,
  readStatus,
  readStringField,
  sanitizeCell
} from './summary.ts'

import type { Concept, Diagnostic } from '../okf/types.ts'

export const COLUMNS = [
  'id',
  'kind',
  'status',
  'grain',
  'summary',
  'links'
] as const

export const DEFAULT_SUMMARY_WIDTH = 120

export interface CompileOptions {
  bundle?: string
  summaryWidth?: number
}

export interface CompileResult {
  concepts: Concept[]
  diagnostics: Diagnostic[]
  tsv: string
  bodies: Map<string, string>
}

interface ConceptContext {
  pathToId: Map<string, string>
  summaryWidth: number
}

interface ConceptResult {
  concept: Concept
  diagnostics: Diagnostic[]
  body: string
}

interface SourceFile {
  path: string
  source: string
}

function toConcept(
  file: SourceFile,
  id: string,
  context: ConceptContext
): ConceptResult {
  const { path, source } = file
  const { data, body, error } = parseFrontmatter(source)
  const diagnostics: Diagnostic[] = []

  if (error !== undefined) {
    diagnostics.push({ level: 'warn', path, message: error })
  }

  const kind = normalizeKind(data['type'])

  if (kind === EMPTY_CELL) {
    diagnostics.push({
      level: 'warn',
      path,
      message: 'missing required frontmatter field "type"'
    })
  }

  const { ids, broken } = resolveLinks(body, path, context.pathToId)

  for (const target of broken) {
    diagnostics.push({
      level: 'warn',
      path,
      message: `unresolved link "${target}"`
    })
  }

  const grain = sanitizeCell(readStringField(data, 'grain'))
  const summary = deriveSummary(data, body, context.summaryWidth)

  return {
    concept: {
      id,
      path,
      kind,
      status: readStatus(data),
      grain,
      summary,
      links: ids
    },
    diagnostics,
    body
  }
}

function byId(a: Concept, b: Concept): number {
  if (a.id === b.id) {
    return 0
  }

  return a.id < b.id ? -1 : 1
}

function toRow(concept: Concept): string {
  const links = concept.links.join(' ')

  return [
    concept.id,
    concept.kind,
    concept.status,
    concept.grain,
    concept.summary,
    links === '' ? EMPTY_CELL : links
  ].join('\t')
}

/**
 * Output must be byte-identical for identical input. Prompt caching is the
 * whole point of the manifest, and a timestamp or an unstable row order would
 * invalidate the cache on every rebuild.
 */
export function serialize(concepts: Concept[], bundle: string): string {
  const lines = [`# bundle: ${bundle}`, COLUMNS.join('\t')]

  for (const concept of concepts) {
    lines.push(toRow(concept))
  }

  return `${lines.join('\n')}\n`
}

function defaultBundleName(root: string): string {
  const trimmed = toPosix(root).replace(/\/+$/, '')

  return basename(trimmed) || trimmed
}

async function readSources(
  root: string,
  paths: string[]
): Promise<SourceFile[]> {
  return Promise.all(
    paths.map(async path => ({
      path,
      source: await Bun.file(`${root}/${path}`).text()
    }))
  )
}

function skippedDiagnostic(file: SourceFile): Diagnostic {
  return {
    level: 'warn',
    path: file.path,
    message: 'skipped: no frontmatter, so not an OKF concept'
  }
}

export async function compileBundle(
  root: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const summaryWidth = options.summaryWidth ?? DEFAULT_SUMMARY_WIDTH
  const bundle = options.bundle ?? defaultBundleName(root)
  const sources = await readSources(root, await scanBundle(root))
  const files: SourceFile[] = []
  const skipped: SourceFile[] = []

  for (const file of sources) {
    ;(hasFrontmatter(file.source) ? files : skipped).push(file)
  }

  // Ids are derived after the filter so a skipped README cannot push a real
  // concept from a bare id onto a longer one.
  const pathToId = deriveIds(files.map(file => file.path))
  const context: ConceptContext = { pathToId, summaryWidth }
  const results = files.map(file =>
    toConcept(file, pathToId.get(file.path) ?? file.path, context)
  )

  const concepts = results.map(result => result.concept).sort(byId)
  const diagnostics = [
    ...skipped.map(skippedDiagnostic),
    ...results.flatMap(result => result.diagnostics)
  ]
  const bodies = new Map(
    results.map(result => [result.concept.id, result.body])
  )

  return { concepts, diagnostics, tsv: serialize(concepts, bundle), bodies }
}
