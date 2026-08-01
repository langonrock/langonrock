import type { Frontmatter } from '../okf/types.ts'

const FENCED_CODE = /^```[\s\S]*?^```[ \t]*$/gm
const SKIPPABLE_LINE = /^\s*(?:#|>|<!--|!\[|\||-{3,}|={3,})/
const SENTENCE_END = /[.!?](?:\s|$)/

export const EMPTY_CELL = '-'

export function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * A tab or newline inside a summary would split or truncate the row, so every
 * cell is flattened before it reaches the manifest.
 */
export function sanitizeCell(value: string): string {
  const flattened = flatten(value)

  return flattened === '' ? EMPTY_CELL : flattened
}

export function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value
  }

  const cut = value.slice(0, width)
  const lastSpace = cut.lastIndexOf(' ')
  const kept = lastSpace > width / 2 ? cut.slice(0, lastSpace) : cut

  return `${kept.trimEnd()}…`
}

export function firstSentence(body: string): string {
  const lines = body.replace(FENCED_CODE, '').split('\n')
  const line = lines.find(
    candidate => candidate.trim() !== '' && !SKIPPABLE_LINE.test(candidate)
  )

  if (line === undefined) {
    return ''
  }

  const match = SENTENCE_END.exec(line)

  return match ? line.slice(0, match.index + 1).trim() : line.trim()
}

export function normalizeKind(value: unknown): string {
  if (typeof value !== 'string') {
    return EMPTY_CELL
  }

  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return slug === '' ? EMPTY_CELL : slug
}

export function readStringField(data: Frontmatter, key: string): string {
  const value = data[key]

  return typeof value === 'string' ? value : ''
}

const CURRENT = 'current'

/**
 * Only a deviation earns a cell. A concept with no status, or one marked
 * current, is what the agent already assumes; `deprecated` and `draft` are the
 * ones it has to see before choosing the concept, which is why this is the one
 * v0.2 trust field that belongs in a row paid for on every turn.
 */
export function readStatus(data: Frontmatter): string {
  const value = sanitizeCell(readStringField(data, 'status'))

  return value.toLowerCase() === CURRENT ? EMPTY_CELL : value
}

export function deriveSummary(
  data: Frontmatter,
  body: string,
  width: number
): string {
  const described = readStringField(data, 'description')
  const source = described === '' ? firstSentence(body) : described

  return truncate(sanitizeCell(source), width)
}
