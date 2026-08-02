import { appendFile, mkdir, rename } from 'node:fs/promises'

import { splitSections } from '../compile/sections.ts'
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
import type { Diagnostic } from '../okf/types.ts'
import type { SectionRange, TntConcept } from './format.ts'

const encoder = new TextEncoder()

export interface PutOptions {
  root: string
  tenant: string
  bundle?: string
  summaryWidth?: number
}

export interface PutResult {
  snapshot: string
  bundles: string[]
  concepts: number
  bytes: number
  reused: boolean
  diagnostics: Diagnostic[]
}

function sectionMap(body: string): Record<string, SectionRange> {
  const map: Record<string, SectionRange> = {}

  for (const section of splitSections(body)) {
    map[section.name] = { start: section.start, end: section.end }
  }

  return map
}

function toTntConcepts(compiled: TenantCompileResult): TntConcept[] {
  return compiled.concepts.map(concept => {
    const content = compiled.bodies.get(concept.id) ?? ''
    const tnt: TntConcept = {
      id: concept.id,
      content,
      sections: sectionMap(content)
    }

    if (concept.title !== '') {
      tnt.title = concept.title
    }

    if (concept.staleAfter !== '') {
      tnt.staleAfter = concept.staleAfter
    }

    return tnt
  })
}

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
    await release()
  }
}

function widthOf(options: PutOptions): TenantCompileOptionsShape {
  return options.summaryWidth === undefined
    ? {}
    : { summaryWidth: options.summaryWidth }
}

type TenantCompileOptionsShape = { summaryWidth?: number }

export async function putTenant(
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
