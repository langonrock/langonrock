import { parseFrontmatter } from '../okf/frontmatter.ts'
import { deriveIds } from '../okf/ids.ts'
import { resolveLinks } from '../okf/links.ts'
import { basename, scanBundle, toPosix } from '../okf/scan.ts'
import {
  EMPTY_CELL,
  deriveSummary,
  normalizeKind,
  readStringField,
  sanitizeCell
} from './summary.ts'

import type { Concept, Diagnostic } from '../okf/types.ts'

export const COLUMNS = ['id', 'kind', 'grain', 'summary', 'links'] as const

export const DEFAULT_SUMMARY_WIDTH = 120

export interface CompileOptions {
  bundle?: string
  summaryWidth?: number
}

export interface CompileResult {
  concepts: Concept[]
  diagnostics: Diagnostic[]
  tsv: string
}

interface ConceptContext {
  root: string
  pathToId: Map<string, string>
  summaryWidth: number
}

interface ConceptResult {
  concept: Concept
  diagnostics: Diagnostic[]
}

async function readConcept(
  path: string,
  id: string,
  context: ConceptContext
): Promise<ConceptResult> {
  const source = await Bun.file(`${context.root}/${path}`).text()
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
    concept: { id, path, kind, grain, summary, links: ids },
    diagnostics
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

export async function compileBundle(
  root: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const summaryWidth = options.summaryWidth ?? DEFAULT_SUMMARY_WIDTH
  const bundle = options.bundle ?? defaultBundleName(root)
  const paths = await scanBundle(root)
  const pathToId = deriveIds(paths)
  const context: ConceptContext = { root, pathToId, summaryWidth }

  const results = await Promise.all(
    paths.map(path => readConcept(path, pathToId.get(path) ?? path, context))
  )

  const concepts = results.map(result => result.concept).sort(byId)
  const diagnostics = results.flatMap(result => result.diagnostics)

  return { concepts, diagnostics, tsv: serialize(concepts, bundle) }
}
