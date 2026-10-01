import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { flushDirectory } from './platform.ts'
import { directory } from './head.ts'

import type { DatabaseTarget } from './types.ts'

/**
 * Found by walking up `path` itself, so the result is always one of its own
 * ancestors. The first directory `mkdirSync` reports creating need not be:
 * on Windows it can come back with a different spelling of a short-name
 * temp path, and walking up to it never ended.
 */
export function existingAncestor(path: string): string {
  let cursor = path

  while (!existsSync(cursor) && dirname(cursor) !== cursor) {
    cursor = dirname(cursor)
  }

  return cursor
}

export function ensureLayout(target: DatabaseTarget): void {
  const root = resolve(directory(target))
  const boundary = existingAncestor(root)

  for (const folder of [
    'snapshots',
    'sources',
    'revisions',
    'staging',
    'imports'
  ]) {
    mkdirSync(`${root}/${folder}`, { recursive: true })
  }

  for (let cursor = root; ; cursor = dirname(cursor)) {
    flushDirectory(cursor)

    if (cursor === boundary || dirname(cursor) === cursor) {
      break
    }
  }
}
