import { FIND_WINDOW, folded } from '../store/slice.ts'

const WORD = /[\p{L}\p{N}]+/gu
const WORDLIKE = /[\p{L}\p{N}]/u

/**
 * The query's words as typed, lowercased but never accent-stripped. The result
 * is an offset into the stored text, and NFKD folding can change a string's
 * length, which would make every offset after the first accent point mid-word.
 * Matching accents across spellings stays BM25's job; this only has to find
 * where the typed words sit.
 */
function wordsOf(query: string): string[] {
  return [...new Set(query.match(WORD) ?? [])]
}

function bounded(haystack: string, offset: number, length: number): boolean {
  const before = haystack[offset - 1]
  const after = haystack[offset + length]

  return (
    (before === undefined || !WORDLIKE.test(before)) &&
    (after === undefined || !WORDLIKE.test(after))
  )
}

interface Occurrence {
  offset: number
  word: number
  length: number
}

function occurrencesOf(haystack: string, words: string[]): Occurrence[] {
  const found: Occurrence[] = []

  for (const [word, needle] of words.entries()) {
    let cursor = haystack.indexOf(needle)

    while (cursor !== -1) {
      if (bounded(haystack, cursor, needle.length)) {
        found.push({ offset: cursor, word, length: needle.length })
      }

      cursor = haystack.indexOf(needle, cursor + needle.length)
    }
  }

  return found.sort((a, b) => a.offset - b.offset)
}

interface Cluster {
  start: number
  end: number
  distinct: number
}

/**
 * Two pointers over the sorted occurrences: for each occurrence taken as the
 * first one in a window of `width`, count how many distinct query words fit
 * entirely inside it. Ties break toward the earliest window, so the same query
 * against the same text always names the same passage.
 */
function densest(occurrences: Occurrence[], width: number): Cluster {
  const counts = new Map<number, number>()
  let best: Cluster = { start: 0, end: 0, distinct: 0 }
  let last = -1

  for (const anchor of occurrences) {
    while (last + 1 < occurrences.length) {
      const next = occurrences[last + 1] as Occurrence

      if (next.offset + next.length > anchor.offset + width) {
        break
      }

      last++
      counts.set(next.word, (counts.get(next.word) ?? 0) + 1)
    }

    if (counts.size > best.distinct) {
      const tail = occurrences[last] as Occurrence

      best = {
        start: anchor.offset,
        end: tail.offset + tail.length,
        distinct: counts.size
      }
    }

    const count = counts.get(anchor.word) ?? 0

    if (count <= 1) {
      counts.delete(anchor.word)
    } else {
      counts.set(anchor.word, count - 1)
    }
  }

  return best
}

/**
 * Where a reader should start a window of FIND_WINDOW characters to see the
 * passage where the query's words cluster densest. Returned as an offset for
 * `get(ids, { offset, limit })`, so search can point at a passage without ever
 * returning one. Undefined when no query word occurs in the text.
 */
export function bestWindowStart(
  text: string,
  query: string
): number | undefined {
  const words = wordsOf(query)

  if (text === '' || words.length === 0) {
    return undefined
  }

  const foldedText = folded(text)
  const needles =
    foldedText === undefined
      ? words
      : [...new Set(words.map(word => word.toLowerCase()))]
  const occurrences = occurrencesOf(foldedText ?? text, needles)

  if (occurrences.length === 0) {
    return undefined
  }

  const cluster = densest(occurrences, FIND_WINDOW)
  const slack = Math.floor((FIND_WINDOW - (cluster.end - cluster.start)) / 2)
  const start = Math.min(
    Math.max(0, cluster.start - Math.max(0, slack)),
    Math.max(0, text.length - FIND_WINDOW)
  )

  return start
}
