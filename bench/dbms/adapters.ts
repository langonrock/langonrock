import { pathToFileURL } from 'node:url'

import { TENANT } from './protocol.ts'

import type { Backend, WorkerRequest } from './protocol.ts'
import type * as Legacy from '../../src/index.ts'
import type * as Native from '../../src/db/api.ts'
import type * as NativeReader from '../../src/db/reader.ts'

async function nativeAdapter(
  request: WorkerRequest,
  api: typeof Legacy
): Promise<Backend> {
  const { code, source, store, bundle, path } = request
  const native = (await import(
    pathToFileURL(`${code}/src/db/api.ts`).href
  )) as typeof Native
  const readers = (await import(
    pathToFileURL(`${code}/src/db/reader.ts`).href
  )) as typeof NativeReader
  const target = { root: store, tenant: TENANT }

  return {
    put: tenant => native.importInitial({ ...target, tenant }, source),
    reader: tenant => readers.pinReader({ ...target, tenant }),
    closeReader: reader => (reader as NativeReader.PinnedReader).close(),
    search: async reader => {
      const built = await api.buildTenantIndex(reader)

      return query => api.searchTenant(built, query, { k: 8 }, reader.get)
    },
    original: async () =>
      (await native.readSource(target, bundle, path))?.content ?? '',
    edit: async content => {
      const previous = await native.readSource(target, bundle, path)

      await native.transact(target, {
        changes: [
          {
            operation: 'write',
            bundle,
            path,
            content,
            ...(previous === undefined ? {} : { replaces: previous.hash })
          }
        ]
      })
    },
    restoreSource: async () => undefined
  }
}

export async function adapter(request: WorkerRequest): Promise<Backend> {
  const { code, source, store, bundle, path } = request
  const api = (await import(
    pathToFileURL(`${code}/src/index.ts`).href
  )) as typeof Legacy

  if (request.mode === 'native') {
    return nativeAdapter(request, api)
  }

  return {
    put: tenant => api.putTenantRoot(source, { root: store, tenant }),
    reader: tenant => api.openTenant(store, tenant),
    search: async reader => {
      const built = await api.buildTenantIndex(reader)

      return query => api.searchTenant(built, query, { k: 8 }, reader.get)
    },
    original: async () =>
      (await api.readSource(source, bundle, path))?.content ?? '',
    edit: async content => {
      await api.readSource(source, bundle, path)
      await api.writeSource(source, bundle, path, content)
      await api.putTenantRoot(source, { root: store, tenant: TENANT })
    },
    restoreSource: async content => {
      await api.writeSource(source, bundle, path, content)
    }
  }
}
