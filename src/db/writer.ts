import { basename } from 'node:path'

import { artifact, readHead } from './head.ts'
import { importFolders } from './import.ts'

import type { BundleSource } from '../compile/tenant.ts'
import type { PutOptions, PutResult } from '../store/contracts.ts'
import type { ImportLocation } from './importstate.ts'

async function put(
  locations: ImportLocation[],
  options: PutOptions
): Promise<PutResult> {
  const previous = await readHead(options)
  const result = await importFolders(
    options,
    locations,
    options.summaryWidth === undefined
      ? {}
      : { summaryWidth: options.summaryWidth }
  )
  const bytes = Bun.file(artifact(options, 'snapshot', result.snapshot)).size

  return { ...result, bytes, reused: result.snapshot === previous?.snapshot }
}

export function putTenantRoot(
  source: string,
  options: PutOptions
): Promise<PutResult> {
  return put([{ source }], options)
}

export function putBundle(
  source: string,
  options: PutOptions
): Promise<PutResult> {
  return put(
    [
      {
        source,
        bundle:
          options.bundle ??
          basename(source.replaceAll('\\', '/').replace(/\/+$/, ''))
      }
    ],
    options
  )
}

export function putTenant(
  sources: BundleSource[],
  options: PutOptions
): Promise<PutResult> {
  return put(
    sources.map(source => ({ source: source.dir, bundle: source.name })),
    options
  )
}
