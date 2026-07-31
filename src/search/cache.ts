import { createReaderCache } from '../store/cache.ts'
import { buildTenantIndex } from './tenant.ts'

import type { TenantIndex } from './tenant.ts'

/**
 * The index is derived and disposable, so it is rebuilt in memory rather than
 * persisted. Keying it on the snapshot digest means a rebuilt tenant gets a
 * fresh index automatically, with no invalidation logic to get wrong.
 */
export function createSearchCache(root: string) {
  const readers = createReaderCache(root)
  const indexes = new Map<string, TenantIndex>()

  return async (tenant: string): Promise<TenantIndex> => {
    const reader = await readers(tenant)
    const cached = indexes.get(tenant)

    if (cached?.snapshot === reader.snapshot) {
      return cached
    }

    const built = await buildTenantIndex(reader)

    indexes.set(tenant, built)

    return built
  }
}

export type SearchCache = ReturnType<typeof createSearchCache>
