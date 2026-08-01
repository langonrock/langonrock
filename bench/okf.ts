import { mkdir, rm, writeFile } from 'node:fs/promises'

import { DEFAULT_SUMMARY_WIDTH } from '../src/compile/manifest.ts'
import { deriveSummary, normalizeKind } from '../src/compile/summary.ts'

export interface GeneratedConcept {
  id: string
  path: string
  bundle: string
  kind: string
  grain: string
  links: string[]
  title: string
  description: string
}

export interface Corpus {
  root: string
  concepts: GeneratedConcept[]
  bundles: string[]
}

/**
 * One concept before it becomes a file. Real documents carry no `grain` and
 * usually no `description`, and leaving those out is the point: the summary
 * then falls back to the first sentence, which is what a prose bundle really
 * gives the manifest.
 */
export interface Draft {
  bundle: string
  dir: string
  id: string
  type: string
  title: string
  description?: string
  links: string[]
  body: string
  /**
   * Keep the title out of the frontmatter, the way a downloaded document has
   * none. The title is still needed for the index, so it stays on the draft.
   */
  untitled?: boolean
}

/** Real titles and abstracts contain colons, which bare YAML scalars cannot. */
function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function frontmatter(draft: Draft): string {
  const lines = ['---', `type: ${quote(draft.type)}`]

  if (draft.untitled !== true) {
    lines.push(`title: ${quote(draft.title)}`)
  }

  if (draft.description !== undefined) {
    lines.push(`description: ${quote(draft.description)}`)
  }

  lines.push('---')

  return lines.join('\n')
}

function toConcept(draft: Draft): GeneratedConcept {
  return {
    id: draft.id,
    path: `${draft.dir}/${draft.id}.md`,
    bundle: draft.bundle,
    kind: normalizeKind(draft.type),
    grain: '-',
    links: draft.links,
    title: draft.title,
    // The row the manifest will carry, so a described query targets the same
    // text on both sides of the benchmark.
    description: deriveSummary(
      { description: draft.description },
      draft.body,
      DEFAULT_SUMMARY_WIDTH
    )
  }
}

/**
 * The baseline's navigation artifact. It carries the same summary the manifest
 * will, because a hand-kept OKF index does, and charging the baseline for a
 * worse index would flatter the store.
 */
function indexFile(bundle: string, items: GeneratedConcept[]): string {
  return [
    '---',
    'type: Index',
    `title: ${bundle}`,
    '---',
    '',
    `# ${bundle}`,
    '',
    ...items.map(
      item => `- [${item.title}](./${item.path}) — ${item.description}`
    )
  ].join('\n')
}

function group(drafts: Draft[]): Map<string, Draft[]> {
  const byBundle = new Map<string, Draft[]>()

  for (const draft of drafts) {
    const list = byBundle.get(draft.bundle)

    if (list === undefined) {
      byBundle.set(draft.bundle, [draft])
    } else {
      list.push(draft)
    }
  }

  return byBundle
}

/** Writes drafts as an OKF tree of one directory per bundle. */
export async function materialize(
  root: string,
  drafts: Draft[]
): Promise<Corpus> {
  await rm(root, { recursive: true, force: true })

  const byBundle = group(drafts)
  const concepts: GeneratedConcept[] = []

  for (const [bundle, items] of byBundle) {
    const compiled = items.map(toConcept)
    const dirs = new Set(items.map(draft => draft.dir))

    for (const dir of dirs) {
      await mkdir(`${root}/${bundle}/${dir}`, { recursive: true })
    }

    await writeFile(`${root}/${bundle}/index.md`, indexFile(bundle, compiled))
    await Promise.all(
      items.map((draft, index) =>
        writeFile(
          `${root}/${bundle}/${compiled[index]?.path}`,
          `${frontmatter(draft)}\n\n${draft.body.trim()}\n`
        )
      )
    )

    concepts.push(...compiled)
  }

  return { root, concepts, bundles: [...byBundle.keys()] }
}
