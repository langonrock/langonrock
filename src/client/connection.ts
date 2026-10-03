import { requireNative, transact } from '../db/api.ts'
import { history } from '../db/history.ts'
import { createReadCache, withReader } from '../db/readcache.ts'
import { restore } from '../db/restore.ts'
import { searchTenant } from '../search/tenant.ts'
import { resolveDataDir } from '../store/datadir.ts'
import { assertTenantId } from '../store/paths.ts'
import { parseDsn } from './dsn.ts'
import { remoteConnection } from './remote.ts'
import { sourceWriting } from './sourcewriting.ts'

import type { DatabaseConnection } from '../types.ts'
import type { Target } from './dsn.ts'

export type { Connection, DatabaseConnection, GetOptions } from '../types.ts'

const NPIPE_UNSUPPORTED =
  'npipe transport is unavailable: Bun.serve has no Windows named pipe support. ' +
  'On Windows run the daemon on loopback TCP and connect with okf+http://127.0.0.1:PORT?token=...'

function embeddedConnection(target: Target): DatabaseConnection {
  if (target.tenant === undefined) {
    throw new Error('embedded dsn needs ?tenant=')
  }

  const root = resolveDataDir(target.path)
  const tenant = assertTenantId(target.tenant)
  const database = { root, tenant }
  const cache = createReadCache(root)
  let closed = false

  const active = () => {
    if (closed) {
      throw new Error('database connection is closed')
    }

    return database
  }

  const writing = sourceWriting(database, active)

  return {
    transport: 'embedded',
    snapshot: () =>
      withReader(cache, tenant, ({ reader }) =>
        Promise.resolve(reader.snapshot)
      ),
    manifest: bundle =>
      withReader(cache, tenant, ({ reader }) => reader.manifest(bundle)),
    get: (ids, options) =>
      withReader(cache, tenant, ({ reader }) => reader.get(ids, options)),
    search: (query, options) =>
      withReader(cache, tenant, async ({ reader, index }) =>
        searchTenant(await index(), query, options ?? {}, reader.get)
      ),
    ...writing,
    transact: request => transact(active(), request),
    history: async options => {
      active()
      await requireNative(database)

      return history(database, options)
    },
    restore: async request => {
      active()
      await requireNative(database)

      return restore(database, request)
    },
    close: async () => {
      closed = true
      cache.close()

      return Promise.resolve()
    }
  }
}

export function open(dsn: string): DatabaseConnection {
  const target = parseDsn(dsn)

  if (target.transport === 'npipe') {
    throw new Error(NPIPE_UNSUPPORTED)
  }

  return target.transport === 'embedded'
    ? embeddedConnection(target)
    : remoteConnection(target)
}
