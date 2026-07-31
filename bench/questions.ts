import type { GeneratedConcept } from './corpus.ts'

export interface Question {
  targets: { id: string; section: string }[]
  /** True when the manifest row alone answers it, with no body fetch. */
  manifestOnly: boolean
  /** A query that names the concept, the way someone who knows it would ask. */
  named: string
  /** A query that describes it instead, to test retrieval without the id. */
  described: string
  wanted: string
}

function at<T>(items: T[], step: number, index: number): T {
  return items[(index * step) % items.length] as T
}

/**
 * Twenty fixed questions whose ground truth is stated as the concepts and
 * sections that must reach the model, so both read paths are charged for
 * delivering the same answer rather than an arbitrary payload.
 */
export function buildQuestions(concepts: GeneratedConcept[]): Question[] {
  const tables = concepts.filter(concept => concept.kind === 'table')
  const metrics = concepts.filter(concept => concept.kind === 'metric')
  const out: Question[] = []

  const add = (
    concept: GeneratedConcept,
    targets: { id: string; section: string }[],
    named: string,
    manifestOnly = false
  ): void => {
    out.push({
      targets,
      manifestOnly,
      named,
      described: concept.description,
      wanted: concept.id
    })
  }

  for (let index = 0; index < 7; index++) {
    const concept = at(tables, 13, index)

    add(
      concept,
      [{ id: concept.id, section: 'schema' }],
      `What is the grain of ${concept.id} and which columns does it carry?`
    )
  }

  for (let index = 0; index < 6; index++) {
    const concept = at(tables, 29, index + 1)

    add(
      concept,
      [
        { id: concept.id, section: 'joins' },
        ...concept.links.map(link => ({ id: link, section: 'schema' }))
      ],
      `How do I join ${concept.id} to the tables it relates to?`
    )
  }

  for (let index = 0; index < 4; index++) {
    const concept = at(tables, 41, index + 2)

    add(
      concept,
      [{ id: concept.id, section: 'schema' }],
      `Which concept holds ${concept.id.split('_')[0]} data, and what is its grain?`,
      true
    )
  }

  for (let index = 0; index < 3; index++) {
    const concept = at(metrics, 7, index + 1)

    add(
      concept,
      [
        { id: concept.id, section: 'definition' },
        ...concept.links.map(link => ({ id: link, section: 'schema' }))
      ],
      `How is the ${concept.id} metric defined and what does it read from?`
    )
  }

  return out
}
