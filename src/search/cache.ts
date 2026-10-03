import { createReadCache, withReader } from '../db/readcache.ts'

import type { TenantIndex } from './tenant.ts'

/**
 * The index is derived and disposable, so it is rebuilt in memory rather than
 * persisted. Keying it on the snapshot digest means a rebuilt tenant gets a
 * fresh index automatically, with no invalidation logic to get wrong.
 */
export function createSearchCache(root: string) {
  const readers = createReadCache(root)

  const index = (tenant: string): Promise<TenantIndex> =>
    withReader(readers, tenant, lease => lease.index())

  return Object.assign(index, { close: readers.close })
}

export type SearchCache = (tenant: string) => Promise<TenantIndex>
