const HEADING = /^#{1,6}[ \t]+(.+?)[ \t]*$/gm
const FENCE = /^```[^\n]*$/gm

export const DEFAULT_SECTION = 'body'

export interface Section {
  name: string
  start: number
  end: number
}

export function slugify(heading: string): string {
  const slug = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return slug === '' ? DEFAULT_SECTION : slug
}

/**
 * A `# comment` line inside a SQL or shell block is not a heading. Real OKF
 * bundles are full of them, so fenced regions are excluded before scanning.
 */
function fencedRanges(body: string): [number, number][] {
  const ranges: [number, number][] = []
  let open: number | undefined

  for (const match of body.matchAll(FENCE)) {
    if (open === undefined) {
      open = match.index
    } else {
      ranges.push([open, match.index + match[0].length])
      open = undefined
    }
  }

  if (open !== undefined) {
    ranges.push([open, body.length])
  }

  return ranges
}

function isFenced(index: number, ranges: [number, number][]): boolean {
  return ranges.some(([start, end]) => index >= start && index < end)
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name)

    return name
  }

  let suffix = 2

  while (taken.has(`${name}_${suffix}`)) {
    suffix++
  }

  taken.add(`${name}_${suffix}`)

  return `${name}_${suffix}`
}

interface HeadingMark {
  name: string
  start: number
}

function headingMarks(body: string): HeadingMark[] {
  const fenced = fencedRanges(body)
  const taken = new Set([DEFAULT_SECTION])
  const marks: HeadingMark[] = []

  for (const match of body.matchAll(HEADING)) {
    if (isFenced(match.index, fenced)) {
      continue
    }

    marks.push({
      name: uniqueName(slugify(match[1] ?? ''), taken),
      start: match.index
    })
  }

  return marks
}

/**
 * Byte ranges let the reader return one section without shipping the whole
 * concept, which is the difference between a schema lookup and a full document.
 */
export function splitSections(body: string): Section[] {
  const marks = headingMarks(body)
  const sections: Section[] = []
  const firstStart = marks[0]?.start ?? body.length

  if (body.slice(0, firstStart).trim() !== '') {
    sections.push({ name: DEFAULT_SECTION, start: 0, end: firstStart })
  }

  for (const [index, mark] of marks.entries()) {
    sections.push({
      name: mark.name,
      start: mark.start,
      end: marks[index + 1]?.start ?? body.length
    })
  }

  return sections
}
