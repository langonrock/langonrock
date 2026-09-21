import { lstat, readdir, rm } from 'node:fs/promises'

import { directory } from './head.ts'
import { flushDirectory } from './platform.ts'

import type { GcResult } from '../store/gc.ts'
import type { DatabaseTarget } from './types.ts'

interface Garbage {
  name: string
  size: number
}

async function sizeOf(path: string): Promise<number> {
  const stat = await lstat(path)

  if (!stat.isDirectory()) {
    return stat.size
  }

  let bytes = stat.size

  for (const name of await readdir(path)) {
    bytes += await sizeOf(`${path}/${name}`)
  }

  return bytes
}

export async function garbage(
  target: DatabaseTarget,
  kept: Set<string>
): Promise<Garbage[]> {
  const result: Garbage[] = []

  for (const folder of [
    'snapshots',
    'sources',
    'revisions',
    'staging',
    'imports'
  ]) {
    for (const entry of await readdir(`${directory(target)}/${folder}`)) {
      const name = `${folder}/${entry}`

      if (kept.has(name)) {
        continue
      }

      if (
        folder !== 'staging' &&
        !/^[a-f0-9]{64}\.(tnt|src|rev|imp)$/.test(entry)
      ) {
        continue
      }

      result.push({ name, size: await sizeOf(`${directory(target)}/${name}`) })
    }
  }

  return result
}

export async function sweep(
  target: DatabaseTarget,
  candidates: Garbage[],
  options: { dryRun: boolean; observe?: () => Promise<void> }
): Promise<Pick<GcResult, 'removed' | 'partials' | 'skipped' | 'bytesFreed'>> {
  const result: Pick<
    GcResult,
    'removed' | 'partials' | 'skipped' | 'bytesFreed'
  > = { removed: [], partials: [], skipped: [], bytesFreed: 0 }

  for (const candidate of candidates) {
    try {
      if (!options.dryRun) {
        await rm(`${directory(target)}/${candidate.name}`, { recursive: true })
      }
    } catch (cause) {
      result.skipped.push({ name: candidate.name, reason: String(cause) })
      continue
    }

    const names = candidate.name.startsWith('staging/')
      ? result.partials
      : result.removed

    names.push(candidate.name)
    result.bytesFreed += candidate.size
    await options.observe?.()
  }

  if (!options.dryRun) {
    for (const folder of [
      'snapshots',
      'sources',
      'revisions',
      'staging',
      'imports'
    ]) {
      flushDirectory(`${directory(target)}/${folder}`)
    }
  }

  return result
}
