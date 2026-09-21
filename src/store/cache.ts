import { createReadCache } from '../db/readcache.ts'

import type { ReadLease } from '../db/readcache.ts'
import type { TenantReader } from './reader.ts'

const finalizer = new FinalizationRegistry<ReadLease>(lease => lease.release())

export function createReaderCache(root: string) {
  const cache = createReadCache(root)

  return async (
    tenant: string
  ): Promise<TenantReader & { close: () => void }> => {
    const lease = await cache.acquire(tenant)
    let closed = false

    const active = (): TenantReader => {
      if (closed) {
        throw new Error('database reader is closed')
      }

      return lease.reader
    }

    const reader = {
      snapshot: lease.reader.snapshot,
      get ids() {
        return active().ids
      },
      get titles() {
        return active().titles
      },
      manifest: (bundle?: string) => active().manifest(bundle),
      get: (...args: Parameters<TenantReader['get']>) => active().get(...args),
      bodies: () => active().bodies(),
      close: () => {
        closed = true
        finalizer.unregister(reader)
        lease.release()
      }
    }

    finalizer.register(reader, lease, reader)

    return reader
  }
}
