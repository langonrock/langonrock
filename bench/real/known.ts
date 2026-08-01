import type { GeneratedConcept } from '../okf.ts'
import type { Question } from '../questions.ts'

export interface KnownItem {
  id: string
  /** A phrase the document really contains, used as the retrieval query. */
  phrase: string
  /** Defaults to the whole body, which is all a headingless concept has. */
  section?: string
}

/**
 * The question set a corpus with no headings and no links can support: find the
 * document that contains a phrase, then read it whole. There is no section to
 * address and no link to batch, and the manifest carries no column `index.md`
 * lacks, so both read paths do the same work. That is the measurement.
 */
export function knownItemQuestions(
  items: KnownItem[],
  concepts: GeneratedConcept[]
): Question[] {
  const summary = new Map(
    concepts.map(concept => [concept.id, concept.description])
  )
  const stride = Math.max(1, Math.floor(items.length / 20))

  return items
    .filter((_, index) => index % stride === 0)
    .slice(0, 20)
    .map(item => ({
      targets: [{ id: item.id, section: item.section ?? 'body' }],
      manifestOnly: false,
      named: item.phrase,
      described: summary.get(item.id) ?? '',
      wanted: item.id
    }))
}

/** The first `count` words of a passage, with any leading marker removed. */
export function phraseOf(passage: string, count: number): string {
  return passage
    .replace(/^\d+\s/, '')
    .split(/\s+/)
    .slice(0, count)
    .join(' ')
}
