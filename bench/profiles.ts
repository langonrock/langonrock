import { generate } from './corpus.ts'
import { buildQuestions } from './questions.ts'
import * as book from './real/book.ts'
import * as handbook from './real/handbook.ts'
import * as scripture from './real/scripture.ts'
import * as spec from './real/spec.ts'

import type { Corpus } from './okf.ts'
import type { Question } from './questions.ts'

export interface Built {
  corpus: Corpus
  questions: Question[]
}

export interface SizeOptions {
  bundles: number
  perBundle: number
}

export interface Profile {
  /** A representative query, used only to time the retriever. */
  probe: string
  build(root: string, options: SizeOptions): Promise<Built>
}

/**
 * Document shapes, not sizes. The reference profile is generated to a requested
 * size; the other four are real public-domain corpora whose shape is whatever
 * the document actually is, so they ignore the size arguments.
 */
export const PROFILES: Record<string, Profile> = {
  reference: {
    probe: 'orders grain join refunds',
    build: async (root, options) => {
      const corpus = await generate(root, options)

      return { corpus, questions: buildQuestions(corpus.concepts) }
    }
  },
  scripture: { probe: scripture.probe, build: root => scripture.build(root) },
  'scripture-coarse': {
    probe: scripture.probe,
    build: root => scripture.buildCoarse(root)
  },
  book: { probe: book.probe, build: root => book.build(root) },
  'book-coarse': { probe: book.probe, build: root => book.buildCoarse(root) },
  handbook: { probe: handbook.probe, build: root => handbook.build(root) },
  'handbook-untitled': {
    probe: handbook.probe,
    build: root => handbook.buildUntitled(root)
  },
  spec: { probe: spec.probe, build: root => spec.build(root) }
}
