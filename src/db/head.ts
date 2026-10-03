import { assertHash, frame, unframe } from './format.ts'
import { validateChecksums } from './validation.ts'
import { validateImports } from './importstate.ts'
import { directory } from './paths.ts'

import type { DatabaseTarget, Head } from './types.ts'

export { directory, artifact } from './paths.ts'

export function encodeHead(head: Head): Uint8Array {
  const bytes = frame('LRH1', head)

  if (bytes.length > 1048576) {
    throw new Error('head exceeds size limit; run gc to bound history')
  }

  return bytes
}

export function decodeHead(bytes: Uint8Array): Head {
  const { metadata, payload } = unframe(bytes, 'LRH1')

  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    payload.length !== 0
  ) {
    throw new Error('database corruption: invalid head')
  }

  const head = metadata as Head

  if (head.version !== 1) {
    throw new Error('unsupported database version')
  }

  assertHash(head.revision)
  assertHash(head.snapshot)
  assertHash(head.archive)

  validateChecksums(head.checksums)

  if (head.imports !== undefined) {
    validateImports(head.imports)
  }

  if (head.retained !== undefined) {
    if (
      !Array.isArray(head.retained) ||
      !head.retained.includes(head.revision) ||
      new Set(head.retained).size !== head.retained.length
    ) {
      throw new Error('database corruption: invalid retention boundary')
    }

    head.retained.forEach(assertHash)
  }

  return head
}

export async function readHead(
  target: DatabaseTarget
): Promise<Head | undefined> {
  try {
    const bytes = new Uint8Array(
      await Bun.file(`${directory(target)}/HEAD`)
        .slice(0, 1048577)
        .arrayBuffer()
    )

    if (bytes.length > 1048576) {
      throw new Error('database corruption: head exceeds size limit')
    }

    return decodeHead(bytes)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }

    throw cause
  }
}
