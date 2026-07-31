const TOKEN = /[a-z0-9]+/g

export const K1 = 1.2
export const B = 0.75

export interface Document {
  id: string
  text: string
}

export interface Hit {
  id: string
  score: number
}

interface Posting {
  document: number
  frequency: number
}

export interface Bm25Index {
  ids: string[]
  lengths: number[]
  averageLength: number
  postings: Map<string, Posting[]>
}

/**
 * Splitting on every non-alphanumeric run means `order_id` and `order id`
 * tokenize identically, so a query written either way matches either form.
 * The query goes through this same function, which is what keeps that true.
 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN) ?? []
}

function countTerms(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>()

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }

  return counts
}

export function buildIndex(documents: Document[]): Bm25Index {
  const ids: string[] = []
  const lengths: number[] = []
  const postings = new Map<string, Posting[]>()

  for (const [document, entry] of documents.entries()) {
    const tokens = tokenize(entry.text)

    ids.push(entry.id)
    lengths.push(tokens.length)

    for (const [term, frequency] of countTerms(tokens)) {
      const list = postings.get(term) ?? []

      list.push({ document, frequency })
      postings.set(term, list)
    }
  }

  const total = lengths.reduce((sum, length) => sum + length, 0)

  return {
    ids,
    lengths,
    averageLength: ids.length === 0 ? 0 : total / ids.length,
    postings
  }
}

function inverseDocumentFrequency(matching: number, total: number): number {
  return Math.log(1 + (total - matching + 0.5) / (matching + 0.5))
}

function accumulate(
  index: Bm25Index,
  term: string,
  scores: Map<number, number>
): void {
  const list = index.postings.get(term)

  if (list === undefined) {
    return
  }

  const idf = inverseDocumentFrequency(list.length, index.ids.length)

  for (const posting of list) {
    const length = index.lengths[posting.document] ?? 0
    const norm =
      index.averageLength === 0 ? 1 : 1 - B + (B * length) / index.averageLength
    const weight =
      (posting.frequency * (K1 + 1)) / (posting.frequency + K1 * norm)

    scores.set(
      posting.document,
      (scores.get(posting.document) ?? 0) + idf * weight
    )
  }
}

/**
 * Ties break by id so the same query against the same snapshot always returns
 * the same order. An agent that reruns a search should not see results shuffle.
 */
function byScoreThenId(a: Hit, b: Hit): number {
  if (a.score !== b.score) {
    return b.score - a.score
  }

  return a.id < b.id ? -1 : 1
}

export function search(index: Bm25Index, query: string, k: number): Hit[] {
  const scores = new Map<number, number>()

  for (const term of new Set(tokenize(query))) {
    accumulate(index, term, scores)
  }

  const hits: Hit[] = []

  for (const [document, score] of scores) {
    const id = index.ids[document]

    if (id !== undefined) {
      hits.push({ id, score })
    }
  }

  return hits.sort(byScoreThenId).slice(0, k)
}
