import { materialize } from '../okf.ts'
import { fetchText, gutenbergBody, paragraphs } from '../sources.ts'
import { knownItemQuestions, phraseOf } from './known.ts'

import type { Corpus, Draft } from '../okf.ts'
import type { Question } from '../questions.ts'

/**
 * Chapter markers are per edition, so each book declares its own instead of one
 * heuristic guessing across all four. Pride and Prejudice restarts its numbering
 * once per volume, which is why chapters are numbered by position rather than by
 * the marker they carry.
 */
const BOOKS = [
  {
    slug: 'alice',
    title: "Alice's Adventures in Wonderland",
    file: 'alice.txt',
    url: 'https://www.gutenberg.org/cache/epub/11/pg11.txt',
    marker: /^CHAPTER [IVXL]+\.\s*$/gm
  },
  {
    slug: 'pride',
    title: 'Pride and Prejudice',
    file: 'pride.txt',
    url: 'https://www.gutenberg.org/cache/epub/1342/pg1342.txt',
    marker: /^(?:CHAPTER|Chapter) [IVXL]+\.\]?\s*$/gm
  },
  {
    slug: 'frankenstein',
    title: 'Frankenstein',
    file: 'frankenstein.txt',
    url: 'https://www.gutenberg.org/cache/epub/84/pg84.txt',
    marker: /^(?:Letter|Chapter) \d+\s*$/gm
  },
  {
    slug: 'metamorphosis',
    title: 'The Metamorphosis',
    file: 'metamorphosis.txt',
    url: 'https://www.gutenberg.org/cache/epub/5200/pg5200.txt',
    marker: /^I{1,3}\s*$/gm
  }
] as const

type Book = (typeof BOOKS)[number]

interface ChapterText {
  id: string
  body: string
}

function split(book: Book, text: string): ChapterText[] {
  const body = gutenbergBody(text.replaceAll('\r\n', '\n'))
  const marks = [...body.matchAll(book.marker)]

  if (marks.length === 0) {
    throw new Error(`no chapter markers in ${book.slug}`)
  }

  return marks.map((mark, index) => ({
    id: `${book.slug}_${index + 1}`,
    body: paragraphs(
      body.slice(
        mark.index + mark[0].length,
        marks[index + 1]?.index ?? body.length
      )
    ).join('\n\n')
  }))
}

function toDraft(book: Book, chapter: ChapterText, index: number): Draft {
  return {
    bundle: book.slug,
    dir: 'chapters',
    id: chapter.id,
    type: 'Chapter',
    title: `${book.title}, chapter ${index + 1}`,
    links: [],
    body: chapter.body
  }
}

function middle(chapter: ChapterText): string {
  const blocks = chapter.body.split('\n\n')

  return phraseOf(blocks[Math.floor(blocks.length / 2)] ?? '', 9)
}

/** One concept per novel, chapters demoted to headings inside it. */
function toNovelDraft(book: Book, chapters: ChapterText[]): Draft {
  return {
    bundle: 'novels',
    dir: 'books',
    id: book.slug,
    type: 'Book',
    title: book.title,
    links: [],
    body: chapters
      .map((chapter, index) => `# Chapter ${index + 1}\n\n${chapter.body}`)
      .join('\n\n')
  }
}

async function load(): Promise<{ book: Book; chapters: ChapterText[] }[]> {
  return Promise.all(
    BOOKS.map(async book => ({
      book,
      chapters: split(book, await fetchText(book.file, book.url))
    }))
  )
}

export async function build(
  root: string
): Promise<{ corpus: Corpus; questions: Question[] }> {
  const loaded = await load()
  const corpus = await materialize(
    root,
    loaded.flatMap(entry =>
      entry.chapters.map((chapter, index) =>
        toDraft(entry.book, chapter, index)
      )
    )
  )
  const items = loaded
    .flatMap(entry => entry.chapters)
    .map(chapter => ({ id: chapter.id, phrase: middle(chapter) }))

  return { corpus, questions: knownItemQuestions(items, corpus.concepts) }
}

/**
 * The same text at a coarser grain. Nothing about the store changes; the corpus
 * stops being headingless chapters and becomes four documents whose chapters
 * are addressable sections.
 */
export async function buildCoarse(
  root: string
): Promise<{ corpus: Corpus; questions: Question[] }> {
  const loaded = await load()
  const corpus = await materialize(
    root,
    loaded.map(entry => toNovelDraft(entry.book, entry.chapters))
  )
  const items = loaded.flatMap(entry =>
    entry.chapters.map((chapter, index) => ({
      id: entry.book.slug,
      phrase: middle(chapter),
      section: `chapter_${index + 1}`
    }))
  )

  return { corpus, questions: knownItemQuestions(items, corpus.concepts) }
}

export const probe = 'rabbit hole tired of sitting by her sister on the bank'
