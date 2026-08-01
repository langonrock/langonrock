import { materialize } from '../okf.ts'
import { fetchText, gutenbergBody } from '../sources.ts'
import { knownItemQuestions, phraseOf } from './known.ts'

import type { Corpus, Draft } from '../okf.ts'
import type { Question } from '../questions.ts'

const URL = 'https://www.gutenberg.org/cache/epub/10/pg10.txt'

/**
 * The edition names books as "The Fourth Book of the Kings", which would put a
 * forty character string in the bundle column of every one of 1,189 rows. The
 * canonical order is fixed, so the short names are positional.
 */
const BOOKS = [
  'Genesis',
  'Exodus',
  'Leviticus',
  'Numbers',
  'Deuteronomy',
  'Joshua',
  'Judges',
  'Ruth',
  '1 Samuel',
  '2 Samuel',
  '1 Kings',
  '2 Kings',
  '1 Chronicles',
  '2 Chronicles',
  'Ezra',
  'Nehemiah',
  'Esther',
  'Job',
  'Psalms',
  'Proverbs',
  'Ecclesiastes',
  'Song of Solomon',
  'Isaiah',
  'Jeremiah',
  'Lamentations',
  'Ezekiel',
  'Daniel',
  'Hosea',
  'Joel',
  'Amos',
  'Obadiah',
  'Jonah',
  'Micah',
  'Nahum',
  'Habakkuk',
  'Zephaniah',
  'Haggai',
  'Zechariah',
  'Malachi',
  'Matthew',
  'Mark',
  'Luke',
  'John',
  'Acts',
  'Romans',
  '1 Corinthians',
  '2 Corinthians',
  'Galatians',
  'Ephesians',
  'Philippians',
  'Colossians',
  '1 Thessalonians',
  '2 Thessalonians',
  '1 Timothy',
  '2 Timothy',
  'Titus',
  'Philemon',
  'Hebrews',
  'James',
  '1 Peter',
  '2 Peter',
  '1 John',
  '2 John',
  '3 John',
  'Jude',
  'Revelation'
] as const

/**
 * A chapter can open partway through a wrapped line, so verse marks are found
 * anywhere rather than at line starts. Anchoring to line starts silently loses
 * Genesis 28 and thirty-three other chapters.
 */
const VERSE = /(?:^|\s)(\d+):(\d+)\s/g

interface Chapter {
  book: string
  slug: string
  number: number
  verses: string[]
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** A book title is a line whose next non-empty line opens with verse 1:1. */
function bookStarts(lines: string[]): number[] {
  const starts: number[] = []

  for (const [index, line] of lines.entries()) {
    if (line.trim() === '' || /^\d+:\d+/.test(line)) {
      continue
    }

    let next = index + 1

    while (lines[next]?.trim() === '') {
      next++
    }

    if (lines[next]?.startsWith('1:1 ') === true) {
      starts.push(index)
    }
  }

  return starts
}

function chaptersOf(segment: string, book: string): Chapter[] {
  const marks = [...segment.matchAll(VERSE)]
  const byNumber = new Map<number, string[]>()

  for (const [index, mark] of marks.entries()) {
    const number = Number(mark[1])
    const from = mark.index + mark[0].length
    const to = marks[index + 1]?.index ?? segment.length
    const text = segment.slice(from, to).replace(/\s+/g, ' ').trim()
    const verses = byNumber.get(number)

    if (verses === undefined) {
      byNumber.set(number, [`${mark[2]} ${text}`])
    } else {
      verses.push(`${mark[2]} ${text}`)
    }
  }

  return [...byNumber].map(([number, verses]) => ({
    book,
    slug: slugify(book),
    number,
    verses
  }))
}

function parse(text: string): Chapter[] {
  const lines = gutenbergBody(text.replaceAll('\r\n', '\n')).split('\n')
  const starts = bookStarts(lines)

  if (starts.length !== BOOKS.length) {
    throw new Error(`expected ${BOOKS.length} books, found ${starts.length}`)
  }

  return starts.flatMap((start, index) =>
    chaptersOf(
      lines.slice(start + 1, starts[index + 1] ?? lines.length).join('\n'),
      BOOKS[index] as string
    )
  )
}

function toDraft(chapter: Chapter): Draft {
  return {
    bundle: chapter.slug,
    dir: 'chapters',
    id: `${chapter.slug}_${chapter.number}`,
    type: 'Chapter',
    title: `${chapter.book} ${chapter.number}`,
    links: [],
    body: chapter.verses.join('\n\n')
  }
}

function middle(chapter: Chapter): string {
  return phraseOf(
    chapter.verses[Math.floor(chapter.verses.length / 2)] ?? '',
    9
  )
}

/** One concept per book, chapters demoted to headings inside it. */
function toBookDraft(chapters: Chapter[]): Draft {
  const first = chapters[0] as Chapter

  return {
    bundle: 'kjv',
    dir: 'books',
    id: first.slug,
    type: 'Book',
    title: first.book,
    links: [],
    body: chapters
      .map(
        chapter =>
          `# Chapter ${chapter.number}\n\n${chapter.verses.join('\n\n')}`
      )
      .join('\n\n')
  }
}

function byBook(chapters: Chapter[]): Chapter[][] {
  const grouped = new Map<string, Chapter[]>()

  for (const chapter of chapters) {
    const list = grouped.get(chapter.slug)

    if (list === undefined) {
      grouped.set(chapter.slug, [chapter])
    } else {
      list.push(chapter)
    }
  }

  return [...grouped.values()]
}

export async function build(
  root: string
): Promise<{ corpus: Corpus; questions: Question[] }> {
  const chapters = parse(await fetchText('kjv.txt', URL))
  const corpus = await materialize(root, chapters.map(toDraft))
  const items = chapters.map(chapter => ({
    id: `${chapter.slug}_${chapter.number}`,
    phrase: middle(chapter)
  }))

  return { corpus, questions: knownItemQuestions(items, corpus.concepts) }
}

/**
 * The same text at a coarser grain. Nothing about the store changes; the
 * corpus stops being 1,189 headingless documents and becomes 66 documents
 * whose chapters are addressable sections.
 */
export async function buildCoarse(
  root: string
): Promise<{ corpus: Corpus; questions: Question[] }> {
  const chapters = parse(await fetchText('kjv.txt', URL))
  const corpus = await materialize(root, byBook(chapters).map(toBookDraft))
  const items = chapters.map(chapter => ({
    id: chapter.slug,
    phrase: middle(chapter),
    section: `chapter_${chapter.number}`
  }))

  return { corpus, questions: knownItemQuestions(items, corpus.concepts) }
}

export const probe = 'the beginning God created the heaven and the earth'
