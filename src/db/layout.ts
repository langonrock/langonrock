import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { flushDirectory } from './platform.ts'
import { directory } from './head.ts'

import type { DatabaseTarget } from './types.ts'

export function ensureLayout(target: DatabaseTarget): void {
  const root = resolve(directory(target))
  const firstCreated = mkdirSync(root, { recursive: true })

  for (const folder of [
    'snapshots',
    'sources',
    'revisions',
    'staging',
    'imports'
  ]) {
    mkdirSync(`${root}/${folder}`, { recursive: true })
  }

  const boundary = firstCreated === undefined ? root : dirname(firstCreated)
  let cursor = root

  for (;;) {
    flushDirectory(cursor)

    if (cursor === boundary) {
      break
    }

    cursor = dirname(cursor)
  }
}
