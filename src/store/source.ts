import { mkdir, rm, stat, unlink } from 'node:fs/promises'

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
export async function listSource(dir: string): Promise<SourceEntry[]> {
  const glob = new Bun.Glob('*/**/*.md')
  const found: SourceEntry[] = []

  for await (const entry of glob.scan({ cwd: dir, onlyFiles: true })) {
    const posix = entry.replaceAll('\\', '/')
    const cut = posix.indexOf('/')
    const bundle = posix.slice(0, cut)

    if (posix.split('/').some(segment => segment.startsWith('.'))) {
      continue
    }

    const content = await Bun.file(`${dir}/${posix}`).text()

    found.push({
      bundle,
      path: posix.slice(cut + 1),
      bytes: Buffer.byteLength(content),
      hash: hashContent(content)
    })
  }

  return found.sort((a, b) =>
    `${a.bundle}/${a.path}` < `${b.bundle}/${b.path}` ? -1 : 1
  )
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
