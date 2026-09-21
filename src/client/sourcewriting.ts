import * as database from '../db/api.ts'
import { hash } from '../db/format.ts'
import { readHead } from '../db/head.ts'
import { assertSourceVersion } from '../db/preconditions.ts'
import { loadSources } from '../server/sources.ts'
import { currentFile } from '../store/paths.ts'
import * as source from '../store/source.ts'
import { putTenantRoot } from '../store/writer.ts'

import type { Connection } from '../types.ts'
import type { DatabaseTarget } from '../db/types.ts'

type Writing = Pick<
  Connection,
  | 'listSource'
  | 'readSource'
  | 'writeSource'
  | 'deleteSource'
  | 'deleteBundle'
  | 'sync'
>

async function legacyDirectory(target: DatabaseTarget): Promise<string> {
  const directory = (await loadSources(target.root)).get(target.tenant)

  if (directory === undefined) {
    throw new Error(
      `tenant "${target.tenant}" has no source directory; add its originals to sources.json or migrate before writing, or its source would be replaced by an empty one`
    )
  }

  return directory
}

async function assertHash(
  target: DatabaseTarget,
  change: { bundle: string; path: string; replaces?: string }
): Promise<string> {
  const directory = await legacyDirectory(target)
  const current = await source.hashOf(directory, change.bundle, change.path)

  assertSourceVersion(current, change.replaces)

  return directory
}

function legacyWriting(target: DatabaseTarget): Writing {
  return {
    listSource: async () => source.listSource(await legacyDirectory(target)),
    readSource: async (bundle, path) =>
      source.readSource(await legacyDirectory(target), bundle, path),
    writeSource: async (bundle, path, content, replaces) =>
      source.writeSource(
        await assertHash(target, {
          bundle,
          path,
          ...(replaces === undefined ? {} : { replaces })
        }),
        bundle,
        path,
        content
      ),
    deleteSource: async (bundle, path, replaces) => {
      await source.deleteSource(
        await assertHash(target, { bundle, path, replaces }),
        bundle,
        path
      )
    },
    deleteBundle: async bundle => {
      await source.deleteBundle(await legacyDirectory(target), bundle)
    },
    sync: async () => {
      const result = await putTenantRoot(await legacyDirectory(target), target)

      return {
        snapshot: result.snapshot,
        concepts: result.concepts,
        bundles: result.bundles,
        diagnostics: result.diagnostics
      }
    }
  }
}

function nativeWriting(target: DatabaseTarget): Writing {
  return {
    listSource: () => database.listSource(target),
    readSource: (bundle, path) => database.readSource(target, bundle, path),
    writeSource: async (bundle, path, content, replaces) => {
      await database.transact(target, {
        changes: [
          {
            operation: 'write',
            bundle,
            path,
            content,
            ...(replaces === undefined ? {} : { replaces })
          }
        ]
      })

      return hash(content)
    },
    deleteSource: async (bundle, path, replaces) => {
      await database.transact(target, {
        changes: [{ operation: 'delete', bundle, path, replaces }]
      })
    },
    deleteBundle: async bundle => {
      await database.deleteBundle(target, bundle)
    },
    sync: () => database.sync(target)
  }
}

export function sourceWriting(
  target: DatabaseTarget,
  active: () => void
): Writing {
  const native = nativeWriting(target)
  const legacy = legacyWriting(target)

  const current = async (): Promise<Writing> => {
    active()

    return (await readHead(target)) !== undefined ||
      !(await Bun.file(currentFile(target.root, target.tenant)).exists())
      ? native
      : legacy
  }

  return {
    listSource: async () => (await current()).listSource(),
    readSource: async (bundle, path) =>
      (await current()).readSource(bundle, path),
    writeSource: async (bundle, path, content, replaces) =>
      (await current()).writeSource(bundle, path, content, replaces),
    deleteSource: async (bundle, path, replaces) =>
      (await current()).deleteSource(bundle, path, replaces),
    deleteBundle: async bundle => (await current()).deleteBundle(bundle),
    sync: async () => (await current()).sync()
  }
}
