import type { ConceptSlice, GetOptions } from '../types.ts'

/**
 * What a `find` returns when the caller did not size the window: enough text
 * around the match to quote a passage and name who said it, while staying an
 * order of magnitude cheaper than the documents that need locating at all.
 */
export const FIND_WINDOW = 2_000

/**
 * A one-letter needle matches a novel tens of thousands of times, and a list
 * that long is its own token blowup. The full count is still reported, so a
 * capped list is visible as such rather than passing for exhaustive.
 */
export const MATCH_CAP = 20

/**
 * Case folding must not move offsets: `toLowerCase` can change a string's
 * length (one code unit of dotted I becomes two), and an offset found in the
 * folded text would then point mid-word in the original. Equal length proves
 * every mapping was one-to-one, so indexes align; otherwise the caller falls
 * back to searching the original text case-sensitively.
 */
export function folded(text: string): string | undefined {
  const lowered = text.toLowerCase()

  return lowered.length === text.length ? lowered : undefined
}

function locate(text: string, needle: string): number[] {
  const foldedText = folded(text)
  const foldedNeedle = folded(needle)
  const [haystack, phrase] =
    foldedText === undefined || foldedNeedle === undefined
      ? [text, needle]
      : [foldedText, foldedNeedle]

  const offsets: number[] = []
  let cursor = haystack.indexOf(phrase)

  while (cursor !== -1) {
    offsets.push(cursor)
    cursor = haystack.indexOf(phrase, cursor + phrase.length)
  }

  return offsets
}

function windowAround(
  match: number,
  needleLength: number,
  limit: number,
  total: number
): { start: number; end: number } {
  const half = Math.floor(Math.max(0, limit - needleLength) / 2)
  const end = Math.min(total, Math.max(0, match - half) + limit)

  return { start: Math.max(0, end - limit), end }
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/**
 * A boundary that lands between the halves of a surrogate pair would ship a
 * replacement character instead of the character it split. The window grows by
 * one unit rather than shrinking, so a slice never loses the match it was
 * centred on.
 */
function cut(text: string, from: number, to: number): ConceptSlice {
  const start =
    from > 0 && isLowSurrogate(text.charCodeAt(from)) ? from - 1 : from
  const end =
    to < text.length && isLowSurrogate(text.charCodeAt(to)) ? to + 1 : to

  return { text: text.slice(start, end), start, end, total: text.length }
}

function found(text: string, needle: string, limit: number): ConceptSlice {
  const offsets = locate(text, needle)

  if (offsets.length === 0) {
    return {
      text: '',
      start: 0,
      end: 0,
      total: text.length,
      matches: [],
      matchCount: 0
    }
  }

  const { start, end } = windowAround(
    offsets[0] ?? 0,
    needle.length,
    Math.max(0, Math.floor(limit)),
    text.length
  )

  return {
    ...cut(text, start, end),
    matches: offsets.slice(0, MATCH_CAP),
    matchCount: offsets.length
  }
}

/**
 * Turns one addressed text into the slice the caller asked for. `find` wins
 * over `offset` because a located window already is a position; the reported
 * match offsets are how a caller reaches the occurrences it did not get.
 */
export function sliceConcept(
  text: string,
  options: GetOptions = {}
): ConceptSlice {
  if (options.find !== undefined && options.find !== '') {
    return found(text, options.find, options.limit ?? FIND_WINDOW)
  }

  const total = text.length
  const start = Math.min(Math.max(0, Math.floor(options.offset ?? 0)), total)
  const end =
    options.limit === undefined
      ? total
      : Math.min(total, start + Math.max(0, Math.floor(options.limit)))

  return cut(text, start, end)
}

/**
 * The frame is the slice explaining itself: a partial read names its range so
 * the caller knows how to continue, and a `find` names every occurrence so the
 * caller can jump instead of paging. A full, unsearched read stays the bare
 * `@@ id` it always was.
 */
export function frameSlice(id: string, slice: ConceptSlice): string {
  const partial = slice.start > 0 || slice.end < slice.total
  const range = partial
    ? ` [${slice.start}..${slice.end} of ${slice.total}]`
    : ''

  if (slice.matchCount === undefined) {
    return `@@ ${id}${range}`
  }

  if (slice.matchCount === 0) {
    return `@@ ${id} no match in ${slice.total} chars`
  }

  const shown = slice.matches ?? []
  const count =
    slice.matchCount > shown.length
      ? `first ${shown.length} of ${slice.matchCount}`
      : `${slice.matchCount}`
  const word = slice.matchCount === 1 ? 'match' : 'matches'

  return `@@ ${id}${range} ${count} ${word} at ${shown.join(' ')}`
}

export function renderConcepts(
  requested: string[],
  found: Map<string, ConceptSlice>
): string {
  const chunks = [...found].map(([id, slice]) =>
    slice.text === ''
      ? frameSlice(id, slice)
      : `${frameSlice(id, slice)}\n${slice.text}`
  )
  const missing = requested.filter(id => !found.has(id))

  if (missing.length > 0) {
    chunks.push(`@@ missing\n${missing.join(' ')}`)
  }

  return chunks.join('\n')
}
