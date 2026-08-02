import { hasFrontmatter, parseFrontmatter } from '../okf/frontmatter.ts'
import { deriveIds } from '../okf/ids.ts'
import { resolveLinks } from '../okf/links.ts'
import { basename, scanBundle, toPosix } from '../okf/scan.ts'
import {
  EMPTY_CELL,
  deriveSummary,
  flatten,
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

const TITLE_HEADING = /^#{1,6}[ \t]+(.+?)[ \t]*$/m

/**
 * The first heading, unless a code fence opens before it: real documents put
 * their name there, and a `# comment` inside a fenced SQL block is not a name.
 */
function headingTitle(body: string): string {
  const match = TITLE_HEADING.exec(body)

  if (match === null) {
    return ''
  }

  const fence = body.indexOf('```')

  return fence !== -1 && fence < match.index ? '' : flatten(match[1] ?? '')
}

function toConcept(
  file: SourceFile,
  id: string,
  context: ConceptContext
): ConceptResult {
  const { path, source } = file
  const { data, body, error } = parseFrontmatter(source)
  const diagnostics: Diagnostic[] = []
  const conformant = hasFrontmatter(source)

  if (error !== undefined) {
    diagnostics.push({ level: 'warn', path, message: error })
  }

  const kind = normalizeKind(data['type'])

  if (!conformant) {
    diagnostics.push({
      level: 'warn',
      path,
      message: 'no frontmatter, compiled as plain markdown, not an OKF concept'
    })
  } else if (kind === EMPTY_CELL) {
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
      // A plain markdown file has no frontmatter title, but its first heading
      // does the same retrieval work, and only for these files: a conformant
      // concept's output must not change because its body gained a heading.
      title: conformant
        ? flatten(readStringField(data, 'title'))
        : headingTitle(body),
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

/**
 * Every Markdown file compiles, frontmatter or not: a docs folder is knowledge
 * before anyone annotates it, and OKF conformance is what `--strict` checks
 * rather than the price of admission. A file with no frontmatter still gets an
 * id, a summary from its first sentence, and its links.
 */
export async function compileBundle(
  root: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const summaryWidth = options.summaryWidth ?? DEFAULT_SUMMARY_WIDTH
  const bundle = options.bundle ?? defaultBundleName(root)
  const files = await readSources(root, await scanBundle(root))
  const pathToId = deriveIds(files.map(file => file.path))
  const context: ConceptContext = { pathToId, summaryWidth }
  const results = files.map(file =>
    toConcept(file, pathToId.get(file.path) ?? file.path, context)
  )

  const concepts = results.map(result => result.concept).sort(byId)
  const diagnostics = results.flatMap(result => result.diagnostics)
  const bodies = new Map(
    results.map(result => [result.concept.id, result.body])
  )

  return { concepts, diagnostics, tsv: serialize(concepts, bundle), bodies }
}
