import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { releaseBuffer } from '../buffers.ts'
import { bundleDir, sourceFile } from '../store/sourcepaths.ts'
import { pinSources, reconstruct } from './reader.ts'
import { visit } from './workers.ts'

import type { DatabaseTarget } from './types.ts'

export interface ExportResult {
  revision: string
  destination: string
  files: number
  bytes: number
}

async function requireAbsent(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }

    throw cause
  }

  throw new Error(
    'export destination already exists; choose a new directory to preserve existing files'
  )
}

export async function exportFolder(
  target: DatabaseTarget,
  destination: string
): Promise<ExportResult> {
  const output = resolve(destination)

  await requireAbsent(output)

  const pinned = await pinSources(target)
  const stage = `${output}.langonrock-${crypto.randomUUID()}`
  let bytes = 0

  try {
    await mkdir(dirname(output), { recursive: true })
    await mkdir(stage, { mode: 0o700 })

    for (const bundle of pinned.archive.bundles) {
      await mkdir(bundleDir(stage, bundle.name), { mode: 0o700 })
    }

    await visit(pinned.archive.entries, async entry => {
      const body =
        entry.id === undefined
          ? ''
          : ((await pinned.reader.get([entry.id])).get(entry.id)?.text ?? '')
      const file = reconstruct(pinned.archive, entry, body)
      const path = sourceFile(stage, file.bundle, file.path)

      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeFile(path, file.source, { flag: 'wx', mode: 0o600 })
      bytes += Buffer.byteLength(file.source)
    })
    await requireAbsent(output)
    await rename(stage, output)

    return {
      revision: pinned.reader.head.revision,
      destination: output,
      files: pinned.archive.entries.length,
      bytes
    }
  } finally {
    pinned.reader.close()
    releaseBuffer(pinned.archive.payload)
    await rm(stage, { recursive: true, force: true })
  }
}
