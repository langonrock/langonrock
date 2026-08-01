import { materialize } from '../okf.ts'
import { fetchText, gutenbergBody, paragraphs } from '../sources.ts'

import type { Corpus, Draft, GeneratedConcept } from '../okf.ts'
import type { Question } from '../questions.ts'

const URL = 'https://www.gutenberg.org/cache/epub/10136/pg10136.txt'

const RECIPE = /^(\d+)\.\s+INGREDIENTS\.--/gim
const MODE = /_Mode_\.--/
const FIELD = /_(Time|Average cost|Seasonable|Sufficient|Note)_\.?-{0,2}\s*/
const REFERENCE = /\bNo\.\s+(\d+)/g
const TITLE = /^[A-Z0-9][A-Z0-9 ,.'&À-Ý-]{3,}$/
const ROMAN = /^[IVXL]+\.?$/

interface Recipe {
  number: number
  title: string
  ingredients: string
  mode: string
  facts: [string, string][]
  note: string
  links: number[]
}

function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function isTitle(line: string): boolean {
  const head = (line.split('(')[0] ?? '').trim()

  return head.length >= 4 && TITLE.test(head)
}

/**
 * The nearest all-caps line above the recipe, searched back only as far as the
 * previous one. A parenthetical qualifier keeps its own case, so only the part
 * before the bracket has to be capitals.
 */
function titleAt(body: string, from: number, to: number): string {
  for (const line of body.slice(from, to).split('\n').reverse()) {
    const text = line.trim()

    if (text === '' || ROMAN.test(text) || line.startsWith('    ')) {
      continue
    }

    if (isTitle(text)) {
      return text.replace(/\.$/, '')
    }
  }

  return ''
}

/** Drops the next recipe's heading and the boxed asides that trail a block. */
function trimBlock(block: string): string {
  const lines = block.split('\n')

  while (lines.length > 0) {
    const last = lines[lines.length - 1] ?? ''
    const text = last.trim()

    if (text === '' || last.startsWith('    ') || ROMAN.test(text)) {
      lines.pop()
    } else if (isTitle(text)) {
      lines.pop()
    } else {
      break
    }
  }

  return lines.join('\n')
}

function tailFields(tail: string): { facts: [string, string][]; note: string } {
  const marks = [...tail.matchAll(new RegExp(FIELD, 'g'))]
  const facts: [string, string][] = []
  let note = ''

  for (const [index, mark] of marks.entries()) {
    const value = flatten(
      tail.slice(mark.index + mark[0].length, marks[index + 1]?.index)
    ).replace(/\.$/, '')

    if (mark[1] === 'Note') {
      note = value
    } else {
      facts.push([mark[1] as string, value])
    }
  }

  return { facts, note }
}

function toRecipe(block: string, number: number): Recipe | undefined {
  const mode = MODE.exec(block)

  if (mode === null) {
    return undefined
  }

  const rest = block.slice(mode.index + mode[0].length)
  const stop = FIELD.exec(rest)
  const { facts, note } = tailFields(
    stop === null ? '' : rest.slice(stop.index)
  )

  return {
    number,
    title: '',
    ingredients: flatten(block.slice(block.indexOf('--') + 2, mode.index)),
    mode: paragraphs(stop === null ? rest : rest.slice(0, stop.index)).join(
      '\n\n'
    ),
    facts,
    note,
    links: [
      ...new Set([...block.matchAll(REFERENCE)].map(match => Number(match[1])))
    ].filter(target => target !== number)
  }
}

function parse(text: string): Recipe[] {
  const body = gutenbergBody(text.replaceAll('\r\n', '\n'))
  const heads = [...body.matchAll(RECIPE)]
  const numbers = new Set(heads.map(head => Number(head[1])))
  const recipes: Recipe[] = []
  let title = ''

  for (const [index, head] of heads.entries()) {
    const end = heads[index + 1]?.index ?? body.length
    const parsed = toRecipe(
      trimBlock(body.slice(head.index, end)),
      Number(head[1])
    )

    title = titleAt(body, heads[index - 1]?.index ?? 0, head.index) || title

    if (parsed !== undefined) {
      recipes.push({
        ...parsed,
        title,
        links: parsed.links.filter(target => numbers.has(target))
      })
    }
  }

  return recipes
}

function id(number: number): string {
  return `recipe_${number}`
}

/** Mrs Beeton's own "No. 105" cross-references, as real OKF links. */
function withLinks(text: string, links: number[]): string {
  return text.replace(REFERENCE, (match, target: string) =>
    links.includes(Number(target))
      ? `[${match}](./${id(Number(target))}.md)`
      : match
  )
}

function factsTable(facts: [string, string][]): string[] {
  if (facts.length === 0) {
    return []
  }

  return [
    '# Facts',
    '',
    '| field | value |',
    '| --- | --- |',
    ...facts.map(([field, value]) => `| ${field} | ${value} |`),
    ''
  ]
}

function toDraft(recipe: Recipe, untitled = false): Draft {
  const title = recipe.title === '' ? id(recipe.number) : recipe.title
  const lines = [
    ...(untitled ? [`# ${title}`, ''] : []),
    '# Ingredients',
    '',
    withLinks(recipe.ingredients, recipe.links),
    '',
    '# Mode',
    '',
    withLinks(recipe.mode, recipe.links),
    '',
    ...factsTable(recipe.facts)
  ]

  if (recipe.note !== '') {
    lines.push('# Notes', '', recipe.note)
  }

  return {
    bundle: 'beeton',
    dir: 'recipes',
    id: id(recipe.number),
    type: 'Recipe',
    title,
    untitled,
    links: recipe.links.map(id),
    body: lines.join('\n')
  }
}

function at<T>(items: T[], step: number, index: number): T {
  return items[(index * step) % items.length] as T
}

/**
 * The same four archetypes the reference corpus uses, because this shape
 * supports all four: prose to slice, a table to address, a link graph to batch,
 * and a links column `index.md` cannot answer from.
 */
function questionsFor(
  recipes: Recipe[],
  concepts: GeneratedConcept[]
): Question[] {
  const summary = new Map(
    concepts.map(concept => [concept.id, concept.description])
  )
  const linked = recipes.filter(recipe => recipe.links.length > 0)
  const tabled = recipes.filter(recipe => recipe.facts.length >= 2)
  const out: Question[] = []

  const add = (
    recipe: Recipe,
    targets: { id: string; section: string }[],
    named: string,
    manifestOnly = false
  ): void => {
    out.push({
      targets,
      manifestOnly,
      named,
      described: summary.get(id(recipe.number)) ?? '',
      wanted: id(recipe.number)
    })
  }

  for (let index = 0; index < 7; index++) {
    const recipe = at(recipes, 137, index)

    add(
      recipe,
      [{ id: id(recipe.number), section: 'mode' }],
      `How do I make ${recipe.title}?`
    )
  }

  for (let index = 0; index < 6; index++) {
    const recipe = at(linked, 29, index + 1)

    add(
      recipe,
      [
        { id: id(recipe.number), section: 'mode' },
        ...recipe.links.map(link => ({ id: id(link), section: 'ingredients' }))
      ],
      `What does ${recipe.title} build on, and what goes into it?`
    )
  }

  for (let index = 0; index < 4; index++) {
    const recipe = at(linked, 41, index + 2)

    add(
      recipe,
      [{ id: id(recipe.number), section: 'ingredients' }],
      `Which recipes build on ${recipe.title}?`,
      true
    )
  }

  for (let index = 0; index < 3; index++) {
    const recipe = at(tabled, 53, index + 1)

    add(
      recipe,
      [{ id: id(recipe.number), section: 'facts' }],
      `How long does ${recipe.title} take and what does it cost?`
    )
  }

  return out
}

async function assemble(
  root: string,
  untitled: boolean
): Promise<{ corpus: Corpus; questions: Question[] }> {
  const recipes = parse(await fetchText('beeton.txt', URL))
  const corpus = await materialize(
    root,
    recipes.map(recipe => toDraft(recipe, untitled))
  )

  return { corpus, questions: questionsFor(recipes, corpus.concepts) }
}

export async function build(
  root: string
): Promise<{ corpus: Corpus; questions: Question[] }> {
  return assemble(root, false)
}

/**
 * The same bundle with no `title` field, the recipe name kept as an H1 at the
 * top of the body instead. This is what a downloaded document looks like, and
 * it isolates whether the retrieval loss is about the title field or about
 * text the compiler strips out of the searchable content.
 */
export async function buildUntitled(
  root: string
): Promise<{ corpus: Corpus; questions: Question[] }> {
  return assemble(root, true)
}

export const probe =
  'rabbit soup stock savoury herbs celery carrots average cost'
