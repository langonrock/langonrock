import { readFile } from 'node:fs/promises'

import { currentFile } from './paths.ts'
import { openTenant } from './reader.ts'

import type { TenantReader } from './reader.ts'

/**
 * A daemon should not re-parse the directory on every request, but it must not
 * serve a stale snapshot either. Reading the tiny `current` pointer costs one
 * syscall and tells us whether the cached reader is still the right one.
 */
export function createReaderCache(root: string) {
  const readers = new Map<string, TenantReader>()

  return async (tenant: string): Promise<TenantReader> => {
    const snapshot = (await readFile(currentFile(root, tenant), 'utf8')).trim()
    const cached = readers.get(tenant)

    if (cached?.snapshot === snapshot) {
      return cached
    }

    const reader = await openTenant(root, tenant)

    readers.set(tenant, reader)

    return reader
  }
}

export type ReaderCache = ReturnType<typeof createReaderCache>
