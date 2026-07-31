import { readFile } from 'node:fs/promises'

import { buildIndex, search } from '../src/index.ts'

import type { Bm25Index } from '../src/index.ts'

/**
 * The OKF reference consumption pattern: a directory of Markdown read with
 * read_index, read_concept and a retriever, which is what kcmd and okf-agents
 * expose. The retriever is the same BM25 the store uses, over the raw files, so
 * the comparison is about what each side indexes rather than about the scoring
 * function.
 */
export interface OkfBundle {
  root: string
  paths: string[]
  files: Map<string, string>
}

export async function loadBundle(
  root: string,
  paths: string[]
): Promise<OkfBundle> {
  const files = new Map<string, string>()

  for (const path of paths) {
    files.set(path, await readFile(`${root}/${path}`, 'utf8'))
  }

  return { root, paths, files }
}

export async function readIndex(root: string, bundle: string): Promise<string> {
  return readFile(`${root}/${bundle}/index.md`, 'utf8')
}

export async function readConcept(root: string, path: string): Promise<string> {
  return readFile(`${root}/${path}`, 'utf8')
}

function field(content: string, name: string): string {
  return new RegExp(`^${name}: (.+)$`, 'm').exec(content)?.[1] ?? ''
}

export function buildOkfIndex(bundle: OkfBundle): Bm25Index {
  return buildIndex(
    bundle.paths.map(path => ({
      id: path,
      text: bundle.files.get(path) ?? ''
    }))
  )
}

export function searchConcepts(
  bundle: OkfBundle,
  index: Bm25Index,
  query: string,
  k: number
): { paths: string[]; text: string } {
  const paths = search(index, query, k).map(hit => hit.id)
  const lines = paths.map(path => {
    const content = bundle.files.get(path) ?? ''

    return `${path} — ${field(content, 'title')} — ${field(content, 'description')}`
  })

  return { paths, text: lines.join('\n') }
}
