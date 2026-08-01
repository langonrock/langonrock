import { mkdir, rm, stat, unlink } from 'node:fs/promises'

import { globalKey, resolveGlobalIds } from '../compile/tenant.ts'
import { hasFrontmatter } from '../okf/frontmatter.ts'
import { deriveIds } from '../okf/ids.ts'
import { writeAtomic } from './atomic.ts'
import { assertBundleName, bundleDir, sourceFile } from './sourcepaths.ts'

import type { SourceEntry, SourceFile } from '../types.ts'

export type { SourceEntry, SourceFile } from '../types.ts'

const encoder = new TextEncoder()

/**
 * The same primitive the snapshot writer uses for its digest, so a source hash
 * and a snapshot digest are the same kind of value and compare the same way.
 */
export function hashContent(content: string): string {
  const hasher = new Bun.CryptoHasher('sha256')

  hasher.update(content)

  return hasher.digest('hex')
}

function parentOf(path: string): string {
  const cut = path.replaceAll('\\', '/').lastIndexOf('/')

  return cut <= 0 ? path : path.slice(0, cut)
}

/**
 * Every Markdown file under the source root, grouped by the bundle it sits in.
 * Dot directories are skipped for the same reason the watcher ignores them:
 * `.git` and `.obsidian` are not knowledge.
 */
interface Scanned {
  bundle: string
  path: string
  content: string
  concept: boolean
}

async function scanSource(dir: string): Promise<Scanned[]> {
  const glob = new Bun.Glob('*/**/*.md')
  const found: Scanned[] = []

  for await (const entry of glob.scan({ cwd: dir, onlyFiles: true })) {
    const posix = entry.replaceAll('\\', '/')

    if (posix.split('/').some(segment => segment.startsWith('.'))) {
      continue
    }

    const cut = posix.indexOf('/')
    const content = await Bun.file(`${dir}/${posix}`).text()

    found.push({
      bundle: posix.slice(0, cut),
      path: posix.slice(cut + 1),
      content,
      concept: hasFrontmatter(content)
    })
  }

  return found.sort((a, b) =>
    `${a.bundle}/${a.path}` < `${b.bundle}/${b.path}` ? -1 : 1
  )
}

/**
 * Runs the compiler's own id derivation over the files it would accept, so the
 * listing names each concept exactly as the manifest will. Files without
 * frontmatter take part in neither, which is what makes a README visibly not a
 * concept instead of an unexplained absence.
 */
function idsFor(scanned: Scanned[]): Map<string, string> {
  const perBundle = new Map<string, string[]>()

  for (const file of scanned.filter(file => file.concept)) {
    perBundle.set(file.bundle, [
      ...(perBundle.get(file.bundle) ?? []),
      file.path
    ])
  }

  const local = new Map<string, Map<string, string>>()

  for (const [bundle, paths] of perBundle) {
    local.set(bundle, deriveIds(paths))
  }

  const global = resolveGlobalIds(
    [...local].map(([name, ids]) => ({ name, ids: [...ids.values()] }))
  )
  const byFile = new Map<string, string>()

  for (const [bundle, ids] of local) {
    for (const [path, id] of ids) {
      const resolved = global.get(globalKey(bundle, id))

      byFile.set(`${bundle}/${path}`, resolved ?? id)
    }
  }

  return byFile
}

export async function listSource(dir: string): Promise<SourceEntry[]> {
  const scanned = await scanSource(dir)
  const ids = idsFor(scanned)

  return scanned.map(file => {
    const id = ids.get(`${file.bundle}/${file.path}`)
    const entry: SourceEntry = {
      bundle: file.bundle,
      path: file.path,
      bytes: Buffer.byteLength(file.content),
      hash: hashContent(file.content)
    }

    return id === undefined ? entry : { ...entry, id }
  })
}

export async function readSource(
  dir: string,
  bundle: string,
  path: string
): Promise<SourceFile | undefined> {
  const file = Bun.file(sourceFile(dir, bundle, path))

  if (!(await file.exists())) {
    return undefined
  }

  const content = await file.text()

  return { content, hash: hashContent(content) }
}

/** The hash a caller must present to overwrite, or undefined if absent. */
export async function hashOf(
  dir: string,
  bundle: string,
  path: string
): Promise<string | undefined> {
  return (await readSource(dir, bundle, path))?.hash
}

/**
 * Writing the first file into a folder is what creates a bundle, which is the
 * same rule the watcher already lives by: every immediate subdirectory is one.
 */
export async function writeSource(
  dir: string,
  bundle: string,
  path: string,
  content: string
): Promise<string> {
  const target = sourceFile(dir, bundle, path)

  await mkdir(parentOf(target), { recursive: true })
  await writeAtomic(target, encoder.encode(content))

  return hashContent(content)
}

export async function deleteSource(
  dir: string,
  bundle: string,
  path: string
): Promise<boolean> {
  try {
    await unlink(sourceFile(dir, bundle, path))

    return true
  } catch {
    return false
  }
}

export async function deleteBundle(
  dir: string,
  bundle: string
): Promise<boolean> {
  const target = bundleDir(dir, assertBundleName(bundle))

  try {
    await stat(target)
  } catch {
    return false
  }

  await rm(target, { recursive: true, force: true })

  return true
}
