import { ConflictError } from './errors.ts'
import { hash } from './format.ts'
import { locationKey } from './importstate.ts'
import { readText } from './text.ts'

import type { DocumentChange } from '../types.ts'
import type { BaseData } from './base.ts'
import type { ScannedFile, ScannedImport } from './importscan.ts'
import type { ImportedFile } from './importstate.ts'

const key = (file: { bundle: string; path: string }): string =>
  `${file.bundle}/${file.path}`

async function replacement(
  file: ScannedFile,
  previous: string | undefined
): Promise<DocumentChange> {
  const content = await readText(Bun.file(file.filename))

  if (hash(content) !== file.hash) {
    throw new ConflictError(
      `folder changed during import: ${file.filename}; scan it again`
    )
  }

  return {
    operation: 'write',
    bundle: file.bundle,
    path: file.path,
    content,
    ...(previous === undefined ? {} : { replaces: previous })
  }
}

async function changeFor(
  before: ImportedFile | undefined,
  file: ScannedFile | undefined,
  stored: ImportedFile | undefined
): Promise<DocumentChange | undefined> {
  const previousHash = before?.hash
  const fileHash = file?.hash
  const storedHash = stored?.hash

  if (previousHash === fileHash || storedHash === fileHash) {
    return undefined
  }

  if (storedHash !== previousHash) {
    const document = file ?? before

    throw new ConflictError(
      `folder and database both changed ${document === undefined ? '' : key(document)}; reconcile the source hashes before importing`
    )
  }

  if (file !== undefined) {
    return replacement(file, storedHash)
  }

  return stored === undefined
    ? undefined
    : {
        operation: 'delete',
        bundle: stored.bundle,
        path: stored.path,
        replaces: stored.hash
      }
}

async function changesFor(
  base: BaseData,
  scan: ScannedImport
): Promise<DocumentChange[]> {
  const previous = new Map(
    (base.imported?.get(locationKey(scan.artifact.reference))?.files ?? []).map(
      file => [key(file), file]
    )
  )
  const current = new Map(base.archive.entries.map(file => [key(file), file]))
  const files = new Map(scan.files.map(file => [key(file), file]))
  const changes: DocumentChange[] = []

  for (const path of new Set([...previous.keys(), ...files.keys()])) {
    const change = await changeFor(
      previous.get(path),
      files.get(path),
      current.get(path)
    )

    if (change !== undefined) {
      changes.push(change)
    }
  }

  return changes
}

export async function importChanges(
  base: BaseData,
  scans: ScannedImport[]
): Promise<DocumentChange[]> {
  const changed: DocumentChange[] = []
  const keys = new Set<string>()

  for (const scan of scans) {
    for (const change of await changesFor(base, scan)) {
      const target = key(change).toLowerCase()

      if (keys.has(target)) {
        throw new Error('import locations overlap on a document')
      }

      keys.add(target)
      changed.push(change)
    }
  }

  return changed
}
