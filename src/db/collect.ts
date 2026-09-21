import { collect as legacyCollect, listTenants } from '../store/gc.ts'
import { collect as nativeCollect } from './gc.ts'
import { readHead } from './head.ts'

import type { GcOptions, GcResult } from '../store/gc.ts'

export async function collect(options: GcOptions): Promise<GcResult> {
  return (await readHead(options)) === undefined
    ? legacyCollect(options)
    : nativeCollect(options)
}

export async function collectAll(
  options: Omit<GcOptions, 'tenant'>
): Promise<GcResult[]> {
  const results: GcResult[] = []

  for (const tenant of await listTenants(options.root)) {
    results.push(await collect({ ...options, tenant }))
  }

  return results
}
