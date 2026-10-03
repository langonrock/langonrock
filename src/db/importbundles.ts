import { locationKey } from './importstate.ts'

import type { DocumentChange } from '../types.ts'
import type { BaseData } from './base.ts'
import type { ScannedImport } from './importscan.ts'

function deletedInDatabase(
  name: string,
  previous: string[],
  existing: Set<string>,
  occupied: Set<string>
): boolean {
  return previous.includes(name) && !existing.has(name) && !occupied.has(name)
}

export function importedBundles(
  base: BaseData,
  scans: ScannedImport[],
  changes: DocumentChange[]
): string[] {
  const remaining = new Map(
    base.archive.entries.map(entry => [
      `${entry.bundle}/${entry.path}`,
      entry.bundle
    ])
  )

  for (const change of changes) {
    const key = `${change.bundle}/${change.path}`

    if (change.operation === 'delete') {
      remaining.delete(key)
    } else {
      remaining.set(key, change.bundle)
    }
  }

  const occupied = new Set(remaining.values())
  const existing = new Set(base.archive.bundles.map(bundle => bundle.name))
  const bundles = new Set(existing)

  for (const scan of scans) {
    const previous =
      base.imported?.get(locationKey(scan.artifact.reference))?.bundles ?? []

    for (const name of previous) {
      if (!scan.bundles.includes(name) && !occupied.has(name)) {
        bundles.delete(name)
      }
    }

    for (const name of scan.bundles) {
      if (!deletedInDatabase(name, previous, existing, occupied)) {
        bundles.add(name)
      }
    }
  }

  return [...bundles].sort()
}
