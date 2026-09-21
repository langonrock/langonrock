import {
  collectConcepts,
  compileContents,
  compileSource
} from '../compile/manifest.ts'
import { discoverBundles } from '../compile/tenant.ts'
import { isConceptPath } from '../okf/scan.ts'
import { deriveIds } from '../okf/ids.ts'
import { assertBundleName, assertConceptPath } from '../store/sourcepaths.ts'
import { hash } from './format.ts'
import { visit } from './workers.ts'
import { readText } from './text.ts'

import type { CompileData, ConceptResult } from '../compile/manifest.ts'
import type { OriginalSource } from './sourcearchive.ts'
import type { DocumentRecord } from './types.ts'

export async function readBundle(
  name: string,
  dir: string
): Promise<DocumentRecord[]> {
  assertBundleName(name)

  const paths = await bundlePaths(dir)

  return Promise.all(
    paths.map(async path => ({
      bundle: name,
      path,
      source: await readText(Bun.file(`${dir}/${path}`))
    }))
  )
}

export async function bundlePaths(dir: string): Promise<string[]> {
  const paths: string[] = []

  for await (const path of new Bun.Glob('**/*.md').scan({
    cwd: dir,
    onlyFiles: true
  })) {
    const normalized = path.replaceAll('\\', '/')

    if (!/(^|\/)\./.test(normalized)) {
      paths.push(assertConceptPath(normalized))
    }
  }

  return paths.sort()
}

export async function compileFolder(
  name: string,
  dir: string,
  summaryWidth: number
): Promise<CompiledInput> {
  assertBundleName(name)

  const paths = await bundlePaths(dir)
  const ids = deriveIds(paths.filter(isConceptPath))
  const parts = new Array<{
    compiled: ConceptResult | undefined
    source: OriginalSource
  }>(paths.length)

  await visit(paths.entries(), async ([index, path]) => {
    const source = await readText(Bun.file(`${dir}/${path}`))
    const file = { bundle: name, path, source }
    const compiled = isConceptPath(path)
      ? compileSource(file, ids, summaryWidth)
      : undefined

    parts[index] = {
      compiled,
      source: originalSource(file, compiled?.body ?? '')
    }
  })

  return {
    name,
    sources: parts.map(part => part.source),
    result: collectConcepts(
      parts
        .map(part => part.compiled)
        .filter((part): part is ConceptResult => part !== undefined)
    )
  }
}

export async function scanDocuments(root: string): Promise<DocumentRecord[]> {
  const bundles = await discoverBundles(root)

  return (
    await Promise.all(bundles.map(({ name, dir }) => readBundle(name, dir)))
  ).flat()
}

export interface CompiledInput {
  name: string
  result: CompileData
  sources: OriginalSource[]
}

export function compileInput(
  name: string,
  files: DocumentRecord[],
  summaryWidth: number,
  knownIds?: Map<string, string>
): CompiledInput {
  const result = compileContents(
    files.filter(file => isConceptPath(file.path)),
    { bundle: name, summaryWidth },
    knownIds
  )
  const bodies = new Map(
    result.concepts.map(concept => [
      concept.path,
      result.bodies.get(concept.id) ?? ''
    ])
  )
  const sources = files.map(file => {
    const body = bodies.get(file.path) ?? ''

    return originalSource(file, body)
  })

  return { name, result, sources }
}

function originalSource(file: DocumentRecord, body: string): OriginalSource {
  if (!file.source.endsWith(body)) {
    throw new Error(
      'compiler transformed source body; source archive format must change'
    )
  }

  return {
    bundle: file.bundle,
    path: file.path,
    prefix: file.source.slice(0, file.source.length - body.length),
    hash: hash(file.source),
    bytes: Buffer.byteLength(file.source)
  }
}

export function mergeInput(
  previous: CompiledInput,
  current: CompiledInput
): CompiledInput {
  const sources = new Map(current.sources.map(source => [source.path, source]))
  const untouched = <T extends { path: string }>(entries: T[]): T[] =>
    entries.filter(entry => !sources.has(entry.path))
  const concepts = [
    ...untouched(previous.result.concepts),
    ...current.result.concepts
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const diagnostics = [
    ...untouched(previous.result.diagnostics),
    ...current.result.diagnostics
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return {
    name: previous.name,
    sources: previous.sources.map(source => sources.get(source.path) ?? source),
    result: { concepts, diagnostics, bodies: current.result.bodies }
  }
}
