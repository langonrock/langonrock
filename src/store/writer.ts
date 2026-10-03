import { appendFile, mkdir, rename } from 'node:fs/promises'

import { toTntConcepts } from '../compile/snapshot.ts'
import { lock } from '../db/platform.ts'
import { compileTenant, discoverBundles } from '../compile/tenant.ts'
import { syncDir, writeSynced } from './atomic.ts'
import { encodeTnt } from './format.ts'
import { acquireWriteLock } from './lock.ts'
import {
  currentFile,
  lockFile,
  logFile,
  snapshotFile,
  snapshotsDir,
  tenantDir
} from './paths.ts'

import type { BundleSource, TenantCompileResult } from '../compile/tenant.ts'
import type { PutOptions, PutResult } from './contracts.ts'

export type { PutOptions, PutResult } from './contracts.ts'

const encoder = new TextEncoder()

function digest(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256')

  hasher.update(bytes)

  return hasher.digest('hex')
}

async function setCurrent(
  root: string,
  tenant: string,
  snapshot: string
): Promise<void> {
  const target = currentFile(root, tenant)
  const temp = `${target}.tmp`

  await writeSynced(temp, encoder.encode(`${snapshot}\n`))
  await rename(temp, target)
  await syncDir(tenantDir(root, tenant))
}

async function logSync(
  options: PutOptions,
  source: string,
  result: PutResult
): Promise<void> {
  await appendFile(
    logFile(options.root, options.tenant),
    `${JSON.stringify({
      at: new Date().toISOString(),
      tenant: options.tenant,
      source,
      bundles: result.bundles,
      snapshot: result.snapshot,
      concepts: result.concepts,
      bytes: result.bytes,
      reused: result.reused
    })}\n`
  )
}

/**
 * Copy on write. A new snapshot is a new immutable file named by its own
 * digest, and only the tiny `current` pointer is replaced, by rename. Readers
 * therefore never observe a partial state and never need a lock.
 */
async function commit(
  compiled: TenantCompileResult,
  options: PutOptions,
  source: string
): Promise<PutResult> {
  const { root, tenant } = options

  await mkdir(snapshotsDir(root, tenant), { recursive: true })

  const bytes = encodeTnt(compiled.tsv, toTntConcepts(compiled))
  const snapshot = digest(bytes)
  const target = snapshotFile(root, tenant, snapshot)
  const release = await acquireWriteLock(lockFile(root, tenant))

  try {
    const releaseNative = await lock(`${tenantDir(root, tenant)}/writer.lock`)

    try {
      if (await Bun.file(`${tenantDir(root, tenant)}/HEAD`).exists()) {
        throw new Error(
          'tenant uses database ownership; import sources through the native database API'
        )
      }

      const reused = await Bun.file(target).exists()

      if (!reused) {
        // Never write straight to the digest name. A crash halfway through would
        // leave a truncated file whose name still claims to be that content, and
        // the next put would see it, report "reused", and point `current` at a
        // snapshot that cannot be parsed. Writing to a temp and renaming means a
        // digest-named file only ever exists complete.
        await writeSynced(`${target}.tmp`, bytes)
        await rename(`${target}.tmp`, target)
        await syncDir(snapshotsDir(root, tenant))
      }

      await setCurrent(root, tenant, snapshot)

      const result: PutResult = {
        snapshot,
        bundles: compiled.bundles,
        concepts: compiled.concepts.length,
        bytes: bytes.byteLength,
        reused,
        diagnostics: compiled.diagnostics
      }

      await logSync(options, source, result)

      return result
    } finally {
      releaseNative()
    }
  } finally {
    await release()
  }
}

function widthOf(options: PutOptions): TenantCompileOptionsShape {
  return options.summaryWidth === undefined
    ? {}
    : { summaryWidth: options.summaryWidth }
}

type TenantCompileOptionsShape = { summaryWidth?: number }

async function putTenant(
  sources: BundleSource[],
  options: PutOptions
): Promise<PutResult> {
  const compiled = await compileTenant(
    sources,
    options.tenant,
    widthOf(options)
  )

  return commit(compiled, options, sources.map(source => source.dir).join(' '))
}

function basename(path: string): string {
  const segments = path.replaceAll('\\', '/').replace(/\/+$/, '').split('/')

  return segments[segments.length - 1] ?? path
}

/** Stores one directory as a single bundle inside the tenant. */
export async function putBundle(
  source: string,
  options: PutOptions
): Promise<PutResult> {
  const name = options.bundle ?? basename(source)

  return putTenant([{ name, dir: source }], options)
}

/** Stores every immediate subdirectory of `sourceRoot` as its own bundle. */
export async function putTenantRoot(
  sourceRoot: string,
  options: PutOptions
): Promise<PutResult> {
  const compiled = await compileTenant(
    await discoverBundles(sourceRoot),
    options.tenant,
    widthOf(options)
  )

  return commit(compiled, options, sourceRoot)
}
