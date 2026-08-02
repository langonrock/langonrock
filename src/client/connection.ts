import { createSearchCache } from '../search/cache.ts'
import { searchTenant } from '../search/tenant.ts'
import { loadSources } from '../server/sources.ts'
import { createReaderCache } from '../store/cache.ts'
import { resolveDataDir } from '../store/datadir.ts'
import {
  deleteBundle,
  deleteSource,
  hashOf,
  listSource,
  readSource,
  writeSource
} from '../store/source.ts'
import { putTenantRoot } from '../store/writer.ts'
import { parseDsn } from './dsn.ts'
import { remoteConnection } from './remote.ts'

import type { Connection } from '../types.ts'
import type { Target } from './dsn.ts'

export type {
  ConceptSlice,
  Connection,
  GetOptions,
  SearchOptions,
  SourceEntry,
  SourceFile,
  SyncResult
} from '../types.ts'

const NPIPE_UNSUPPORTED =
  'npipe transport is unavailable: Bun.serve has no Windows named pipe support. ' +
  'On Windows run the daemon on loopback TCP and connect with okf+http://127.0.0.1:PORT?token=...'

function required(value: string | undefined, message: string): string {
  if (value === undefined) {
    throw new Error(message)
  }

  return value
}

function conflict(what: string): Error {
  return new Error(`${what}: re-read the concept and retry with its new hash`)
}

/**
 * Embedded and remote enforce the same rule. If only the server checked, an
 * editor developed against a local path would lose edits the moment it was
 * pointed at a server, which is exactly the bug this is meant to prevent.
 */
function assertReplaces(current: string | undefined, replaces?: string): void {
  if (replaces === undefined) {
    if (current !== undefined) {
      throw conflict('concept already exists')
    }

    return
  }

  if (current === undefined) {
    throw conflict('concept does not exist')
  }

  if (current !== replaces) {
    throw conflict('concept changed since it was read')
  }
}

function embeddedConnection(target: Target): Connection {
  // An embedded dsn with no path means the default store, so `okf://?tenant=x`
  // works the same way `--data` being absent does.
  const root = resolveDataDir(target.path)
  const tenant = required(target.tenant, 'embedded dsn needs ?tenant=')
  const cache = createReaderCache(root)
  const indexes = createSearchCache(root)

  const sourceDir = async (): Promise<string> => {
    const dir = (await loadSources(root)).get(tenant)

    if (dir === undefined) {
      throw new Error(
        `tenant "${tenant}" has no source directory: add it to ${root}/sources.json to make it writable`
      )
    }

    return dir
  }

  return {
    transport: 'embedded',
    snapshot: async () => (await cache(tenant)).snapshot,
    manifest: async bundle => (await cache(tenant)).manifest(bundle),
    get: async (ids, options) => (await cache(tenant)).get(ids, options),
    search: async (query, options) =>
      searchTenant(await indexes(tenant), query, options ?? {}, async ids =>
        (await cache(tenant)).get(ids)
      ),
    listSource: async () => listSource(await sourceDir()),
    readSource: async (bundle, path) =>
      readSource(await sourceDir(), bundle, path),
    writeSource: async (bundle, path, content, replaces) => {
      const dir = await sourceDir()

      assertReplaces(await hashOf(dir, bundle, path), replaces)

      return writeSource(dir, bundle, path, content)
    },
    deleteSource: async (bundle, path, replaces) => {
      const dir = await sourceDir()

      assertReplaces(await hashOf(dir, bundle, path), replaces)
      await deleteSource(dir, bundle, path)
    },
    deleteBundle: async bundle => {
      await deleteBundle(await sourceDir(), bundle)
    },
    sync: async () => {
      const result = await putTenantRoot(await sourceDir(), { root, tenant })

      return {
        snapshot: result.snapshot,
        concepts: result.concepts,
        bundles: result.bundles,
        diagnostics: result.diagnostics
      }
    },
    close: async () => undefined
  }
}

/**
 * One interface across every transport. Develop against a local directory,
 * deploy against a remote server, and the calling code does not change.
 *
 * An app that only ever talks to a server should import `langonrock/client`
 * instead: same interface, no filesystem underneath it, and no Bun.
 */
export function open(dsn: string): Connection {
  const target = parseDsn(dsn)

  if (target.transport === 'npipe') {
    throw new Error(NPIPE_UNSUPPORTED)
  }

  return target.transport === 'embedded'
    ? embeddedConnection(target)
    : remoteConnection(target)
}
