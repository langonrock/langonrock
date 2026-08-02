const ASCII_TOKEN = /[a-z0-9]+/g
const TOKEN = /[\p{L}\p{N}]+/gu
const NON_ASCII = /[^\x00-\x7f]/
const MARKS = /\p{M}+/gu

export const K1 = 1.2
export const B = 0.75

/**
 * How many times a manifest cell counts against a word of prose. Compiling the
 * frontmatter away removes the id repetitions that `resource` and `sources`
 * URLs used to contribute, so an id or summary match has to be told apart from
 * an incidental body match.
 *
 * Swept over a 500 concept corpus, hit rate at 8 for queries naming a concept:
 * 65% unweighted, 75% at 2, and no further gain above it. Weights of 4 and up
 * start costing recall on queries that describe a concept instead of naming
 * one, so this is the smallest value that captures the gain.
 */
export const FIELD_WEIGHT = 2

/**
 * How many times the concept's own names — its id and its frontmatter title —
 * count against a word of prose. A query that names a concept should land on
 * the concept itself, not on a neighbour that mentions the name in passing,
 * which is why names weigh more than the other manifest cells.
 *
 * Swept over the reference, handbook and spec corpora at k = 8. The hit rate
 * for naming queries is already captured at 2, but the top position keeps
 * improving to 4: reference MRR 0.39 at 2, 0.43 at 4. Above 4 nothing moves
 * outside noise, and describing queries never move at all — the recall cost
 * that capped FIELD_WEIGHT does not apply to a concept's own name.
 */
export const NAME_WEIGHT = 4

export interface Document {
  id: string
  text: string
  /** Manifest cells, counted FIELD_WEIGHT times against the body text. */
  fields?: string
  /** The concept's id and title, counted NAME_WEIGHT times. */
  names?: string
}

export interface Hit {
  id: string
  score: number
}

/**
 * Postings are parallel typed arrays, not one object per posting. At twenty
 * thousand concepts the index holds millions of postings, and the per-object
 * overhead was most of the process's memory ceiling.
 */
interface PostingList {
  documents: Uint32Array
  frequencies: Uint32Array
  length: number
}

export interface Bm25Index {
  ids: string[]
  lengths: number[]
  averageLength: number
  postings: Map<string, PostingList>
}

/**
 * Splitting on every non-alphanumeric run means `order_id` and `order id`
 * tokenize identically, so a query written either way matches either form.
 * The query goes through this same function, which is what keeps that true.
 *
 * Accents fold away before splitting, so `operações` and `operacoes` are the
 * same token whichever way the document or the query spells it. Pure ASCII
 * text skips the normalization and keeps the exact behaviour and cost the
 * index build always had.
 *
 * No stemming, and that is measured rather than assumed: a minimal plural
 * fold lifted the identifier-heavy reference corpus (+5pp hit rate, +0.12
 * MRR) but cost the prose corpora rank quality across the board (handbook
 * −5pp, MRR −0.06; scripture-coarse MRR −0.08), because folding blurs the
 * exact words a known-item phrase matches on.
 */
export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase()

  if (!NON_ASCII.test(lowered)) {
    return lowered.match(ASCII_TOKEN) ?? []
  }

  return lowered.normalize('NFKD').replace(MARKS, '').match(TOKEN) ?? []
}

function addWeighted(
  counts: Map<string, number>,
  tokens: string[],
  weight: number
): void {
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + weight)
  }
}

function createList(): PostingList {
  return {
    documents: new Uint32Array(2),
    frequencies: new Uint32Array(2),
    length: 0
  }
}

function push(list: PostingList, document: number, frequency: number): void {
  if (list.length === list.documents.length) {
    const documents = new Uint32Array(list.length * 2)
    const frequencies = new Uint32Array(list.length * 2)

    documents.set(list.documents)
    frequencies.set(list.frequencies)
    list.documents = documents
    list.frequencies = frequencies
  }

  list.documents[list.length] = document
  list.frequencies[list.length] = frequency
  list.length += 1
}

function trim(list: PostingList): PostingList {
  if (list.length === list.documents.length) {
    return list
  }

  return {
    documents: list.documents.slice(0, list.length),
    frequencies: list.frequencies.slice(0, list.length),
    length: list.length
  }
}

export interface IndexBuilder {
  add: (document: Document) => void
  build: () => Bm25Index
}

/**
 * Documents are added one at a time so the caller never has to hold every
 * body in memory at once: tokenize, count, drop the text, move on.
 */
export function createIndexBuilder(): IndexBuilder {
  const ids: string[] = []
  const lengths: number[] = []
  const postings = new Map<string, PostingList>()

  return {
    add: entry => {
      const document = ids.length
      const body = tokenize(entry.text)
      const fields = entry.fields === undefined ? [] : tokenize(entry.fields)
      const names = entry.names === undefined ? [] : tokenize(entry.names)

      ids.push(entry.id)
      lengths.push(
        body.length + fields.length * FIELD_WEIGHT + names.length * NAME_WEIGHT
      )

      const counts = new Map<string, number>()

      addWeighted(counts, body, 1)
      addWeighted(counts, fields, FIELD_WEIGHT)
      addWeighted(counts, names, NAME_WEIGHT)

      for (const [term, frequency] of counts) {
        let list = postings.get(term)

        if (list === undefined) {
          list = createList()
          postings.set(term, list)
        }

        push(list, document, frequency)
      }
    },
    build: () => {
      for (const [term, list] of postings) {
        postings.set(term, trim(list))
      }

      const total = lengths.reduce((sum, length) => sum + length, 0)

      return {
        ids,
        lengths,
        averageLength: ids.length === 0 ? 0 : total / ids.length,
        postings
      }
    }
  }
}

export function buildIndex(documents: Document[]): Bm25Index {
  const builder = createIndexBuilder()

  for (const document of documents) {
    builder.add(document)
  }

  return builder.build()
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

  for (let entry = 0; entry < list.length; entry++) {
    const document = list.documents[entry] ?? 0
    const frequency = list.frequencies[entry] ?? 0
    const length = index.lengths[document] ?? 0
    const norm =
      index.averageLength === 0 ? 1 : 1 - B + (B * length) / index.averageLength
    const weight = (frequency * (K1 + 1)) / (frequency + K1 * norm)

    scores.set(document, (scores.get(document) ?? 0) + idf * weight)
  }
}

/**
 * Ties break by id so the same query against the same snapshot always returns
 * the same order. An agent that reruns a search should not see results shuffle.
 */
function ranksBefore(id: string, score: number, hit: Hit): boolean {
  if (score !== hit.score) {
    return score > hit.score
  }

  return id < hit.id
}

/**
 * Bounded selection: keeps the best k seen so far in rank order, so a query
 * matching most of a large tenant costs one comparison per match instead of
 * sorting every match. Same total order as a full sort, identical results.
 */
function insertBounded(top: Hit[], id: string, score: number, k: number): void {
  const last = top[top.length - 1]

  if (
    top.length === k &&
    (last === undefined || !ranksBefore(id, score, last))
  ) {
    return
  }

  let low = 0
  let high = top.length

  while (low < high) {
    const middle = (low + high) >>> 1
    const there = top[middle]

    if (there === undefined || ranksBefore(id, score, there)) {
      high = middle
    } else {
      low = middle + 1
    }
  }

  top.splice(low, 0, { id, score })

  if (top.length > k) {
    top.pop()
  }
}

/**
 * `keep` filters before the cut to k, so a narrowed search still returns k
 * matches rather than whatever survives of the global top k.
 */
export function search(
  index: Bm25Index,
  query: string,
  k: number,
  keep?: (id: string) => boolean
): Hit[] {
  const scores = new Map<number, number>()

  for (const term of new Set(tokenize(query))) {
    accumulate(index, term, scores)
  }

  const top: Hit[] = []

  for (const [document, score] of scores) {
    const id = index.ids[document]

    if (id !== undefined && (keep === undefined || keep(id))) {
      insertBounded(top, id, score, k)
    }
  }

  return top
}
