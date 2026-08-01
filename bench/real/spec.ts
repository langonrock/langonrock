import { slugify } from '../../src/compile/sections.ts'
import { materialize } from '../okf.ts'
import { fetchText } from '../sources.ts'

import type { Corpus, Draft, GeneratedConcept } from '../okf.ts'
import type { Question } from '../questions.ts'

/**
 * One bundle, because links only resolve inside one, and these documents cite
 * each other constantly. Titles are declared rather than scraped: the centred
 * title line of an RFC is not distinguishable from an author address.
 */
const SPECS: [number, string][] = [
  [2119, 'Key words for use in RFCs'],
  [3986, 'Uniform Resource Identifier: Generic Syntax'],
  [5322, 'Internet Message Format'],
  [5789, 'PATCH Method for HTTP'],
  [6265, 'HTTP State Management Mechanism'],
  [6749, 'The OAuth 2.0 Authorization Framework'],
  [6750, 'OAuth 2.0 Bearer Token Usage'],
  [7515, 'JSON Web Signature'],
  [7516, 'JSON Web Encryption'],
  [7517, 'JSON Web Key'],
  [7518, 'JSON Web Algorithms'],
  [7519, 'JSON Web Token'],
  [7540, 'Hypertext Transfer Protocol Version 2'],
  [7636, 'Proof Key for Code Exchange by OAuth Public Clients'],
  [8174, 'Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words'],
  [8259, 'The JavaScript Object Notation Data Interchange Format'],
  [8288, 'Web Linking'],
  [8446, 'The Transport Layer Security Protocol Version 1.3'],
  [8615, 'Well-Known Uniform Resource Identifiers'],
  [9110, 'HTTP Semantics'],
  [9111, 'HTTP Caching'],
  [9112, 'HTTP/1.1'],
  [9113, 'HTTP/2'],
  [9114, 'HTTP/3'],
  [9205, 'Building Protocols with HTTP'],
  [9293, 'Transmission Control Protocol'],
  [9457, 'Problem Details for HTTP APIs'],
  [9562, 'Universally Unique IDentifiers']
]

const HEADING = /^(\d+(?:\.\d+)*)\.\s+(\S.*)$/gm
const CITATION = /\[RFC(\d{3,4})\]/g
const PAGINATION = /^.*\[Page \d+\]\s*$|^RFC \d+\s{2,}.*\d{4}\s*$/gm
const ABSTRACT = /^Abstract\s*\n\n([\s\S]*?)\n\n/m

/**
 * A section heading stands alone: long enough to be a paragraph is not a title,
 * and neither is a numbered definition that runs straight into its own text,
 * which is all RFC 2119 contains.
 */
const TITLE_LIMIT = 70

interface Spec {
  number: number
  title: string
  abstract: string
  sections: string[]
  links: number[]
  body: string
}

function id(number: number): string {
  return `rfc${number}`
}

function clean(text: string): string {
  return text
    .replaceAll('\r\n', '\n')
    .replace(/\f/g, '')
    .replace(PAGINATION, '')
}

function abstractOf(text: string): string {
  return (ABSTRACT.exec(text)?.[1] ?? '').replace(/\s+/g, ' ').trim()
}

interface Heading {
  index: number
  length: number
  number: string
  title: string
}

function headingsOf(text: string): Heading[] {
  return [...text.matchAll(HEADING)]
    .filter(
      match =>
        (match[2] ?? '').length <= TITLE_LIMIT &&
        text.startsWith('\n\n', match.index + match[0].length)
    )
    .map(match => ({
      index: match.index,
      length: match[0].length,
      number: match[1] as string,
      title: match[2] as string
    }))
}

function markdown(text: string, headings: Heading[]): string {
  const parts: string[] = []

  for (const [index, heading] of headings.entries()) {
    const depth = heading.number.split('.').length
    const to = headings[index + 1]?.index ?? text.length

    parts.push(
      `${'#'.repeat(Math.min(depth, 6))} ${heading.number}. ${heading.title}`,
      text.slice(heading.index + heading.length, to).replace(/\n{3,}/g, '\n\n')
    )
  }

  return parts.join('\n')
}

function parse(number: number, title: string, raw: string): Spec {
  const text = clean(raw)
  const headings = headingsOf(text)
  const body = markdown(text, headings)

  return {
    number,
    title: `RFC ${number}: ${title}`,
    abstract: abstractOf(text),
    sections: headings.map(
      heading => `${slugify(heading.number)}_${slugify(heading.title)}`
    ),
    links: [
      ...new Set([...body.matchAll(CITATION)].map(match => Number(match[1])))
    ].filter(target => target !== number),
    body
  }
}

function withLinks(body: string, links: number[]): string {
  return body.replace(CITATION, (match, target: string) =>
    links.includes(Number(target))
      ? `[RFC ${target}](./${id(Number(target))}.md)`
      : match
  )
}

function toDraft(spec: Spec): Draft {
  return {
    bundle: 'rfcs',
    dir: 'specs',
    id: id(spec.number),
    type: 'Specification',
    title: spec.title,
    description: spec.abstract,
    links: spec.links.map(id),
    body: withLinks(spec.body, spec.links)
  }
}

function at<T>(items: T[], step: number, index: number): T {
  return items[(index * step) % items.length] as T
}

function sectionAt(spec: Spec, offset: number): string {
  return spec.sections[offset % spec.sections.length] ?? 'body'
}

function securitySection(spec: Spec): string {
  return (
    spec.sections.find(name => name.endsWith('security_considerations')) ??
    sectionAt(spec, 0)
  )
}

/**
 * The shape section addressing was built for: a handful of very large documents
 * whose own numbering already names every slice, and a citation graph the
 * manifest can carry in one column.
 */
function questionsFor(specs: Spec[], concepts: GeneratedConcept[]): Question[] {
  const summary = new Map(
    concepts.map(concept => [concept.id, concept.description])
  )
  const byNumber = new Map(specs.map(spec => [spec.number, spec]))
  const linked = specs.filter(spec => spec.links.length > 0)
  const out: Question[] = []

  const add = (
    spec: Spec,
    targets: { id: string; section: string }[],
    named: string,
    manifestOnly = false
  ): void => {
    out.push({
      targets,
      manifestOnly,
      named,
      described: summary.get(id(spec.number)) ?? '',
      wanted: id(spec.number)
    })
  }

  for (let index = 0; index < 7; index++) {
    const spec = at(specs, 11, index)
    const section = sectionAt(spec, 3 + index * 5)

    add(
      spec,
      [{ id: id(spec.number), section }],
      `In ${spec.title}, what does section ${section.replace(/_/g, ' ')} specify?`
    )
  }

  for (let index = 0; index < 6; index++) {
    const spec = at(linked, 5, index + 1)
    const cited = spec.links
      .map(target => byNumber.get(target))
      .filter(target => target !== undefined)
      .slice(0, 2)

    add(
      spec,
      [
        { id: id(spec.number), section: sectionAt(spec, 2) },
        ...cited.map(target => ({
          id: id(target.number),
          section: sectionAt(target, 1)
        }))
      ],
      `What does ${spec.title} require, and what do the specs it cites say about it?`
    )
  }

  for (let index = 0; index < 4; index++) {
    const spec = at(linked, 7, index + 2)

    add(
      spec,
      [{ id: id(spec.number), section: sectionAt(spec, 0) }],
      `Which other specifications does ${spec.title} cite?`,
      true
    )
  }

  for (let index = 0; index < 3; index++) {
    const spec = at(specs, 13, index + 1)

    add(
      spec,
      [{ id: id(spec.number), section: securitySection(spec) }],
      `What are the security considerations in ${spec.title}?`
    )
  }

  return out
}

export async function build(
  root: string
): Promise<{ corpus: Corpus; questions: Question[] }> {
  const numbers = new Set(SPECS.map(([number]) => number))
  const loaded = await Promise.all(
    SPECS.map(async ([number, title]) =>
      parse(
        number,
        title,
        await fetchText(
          `rfc${number}.txt`,
          `https://www.rfc-editor.org/rfc/rfc${number}.txt`
        )
      )
    )
  )
  const specs = loaded.map(spec => ({
    ...spec,
    links: spec.links.filter(target => numbers.has(target))
  }))
  const corpus = await materialize(root, specs.map(toDraft))

  return { corpus, questions: questionsFor(specs, corpus.concepts) }
}

export const probe =
  'cache control header field directive stale response revalidate'
