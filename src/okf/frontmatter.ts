import type { Frontmatter, ParsedFile } from './types.ts'

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

function isPlainObject(value: unknown): value is Frontmatter {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(value) === false
  )
}

/**
 * An OKF concept carries frontmatter. A Markdown file with none is repository
 * furniture, and a cloned bundle always brings some: README, CONTRIBUTING,
 * LICENSE. Indexing those as knowledge pollutes both the manifest and search.
 */
export function hasFrontmatter(source: string): boolean {
  return FRONTMATTER.test(source)
}

export function parseFrontmatter(source: string): ParsedFile {
  const match = FRONTMATTER.exec(source)

  if (!match) {
    return { data: {}, body: source }
  }

  const body = source.slice(match[0].length)
  const raw = match[1] ?? ''

  try {
    const parsed = Bun.YAML.parse(raw)

    if (!isPlainObject(parsed)) {
      return { data: {}, body, error: 'frontmatter is not a mapping' }
    }

    return { data: parsed, body }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)

    return { data: {}, body, error: `invalid YAML frontmatter: ${message}` }
  }
}
