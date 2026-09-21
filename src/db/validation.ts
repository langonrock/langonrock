import { assertBundleName } from '../store/sourcepaths.ts'
import { corruption } from './errors.ts'

import type { Diagnostic } from '../types.ts'
import type { SnapshotChecksums } from '../store/integrity.ts'

export function assertSummaryWidth(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('summary width must be a non-negative integer')
  }
}

export function uint32(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffffff
  )
}

export function validateChecksums(value: SnapshotChecksums): void {
  if (
    !value ||
    !uint32(value.header) ||
    !uint32(value.directory) ||
    !uint32(value.manifest)
  ) {
    throw corruption('invalid snapshot checksums')
  }
}

export function validateBundles(bundles: string[]): void {
  const names = new Set<string>()

  for (const name of bundles) {
    if (typeof name !== 'string') {
      throw corruption('invalid bundle name')
    }

    assertBundleName(name)

    if (names.has(name.toLowerCase())) {
      throw corruption('duplicate bundle')
    }

    names.add(name.toLowerCase())
  }
}

export function validateDiagnostics(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    if (
      !diagnostic ||
      !['warn', 'error'].includes(diagnostic.level) ||
      typeof diagnostic.path !== 'string' ||
      typeof diagnostic.message !== 'string'
    ) {
      throw corruption('invalid diagnostic')
    }
  }
}
