import { appendFile, mkdir, open, rename } from 'node:fs/promises'

import { compileBundle } from '../compile/manifest.ts'
import { splitSections } from '../compile/sections.ts'
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

import type { CompileOptions, CompileResult } from '../compile/manifest.ts'
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

function toTntConcepts(compiled: CompileResult): TntConcept[] {
  return compiled.concepts.map(concept => {
    const content = compiled.bodies.get(concept.id) ?? ''

    return { id: concept.id, content, sections: sectionMap(content) }
  })
}

function digest(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256')

  hasher.update(bytes)

  return hasher.digest('hex')
}

async function writeSynced(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, 'w')

  try {
    await handle.write(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * POSIX needs the parent directory flushed before a rename is durable. Windows
 * offers no equivalent and does not need one.
 */
async function syncDir(path: string): Promise<void> {
  if (process.platform === 'win32') {
    return
  }

  const handle = await open(path, 'r')

  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
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

function compileOptions(options: PutOptions): CompileOptions {
  const compile: CompileOptions = {}

  if (options.bundle !== undefined) {
    compile.bundle = options.bundle
  }

  if (options.summaryWidth !== undefined) {
    compile.summaryWidth = options.summaryWidth
  }

  return compile
}

/**
 * Copy on write. A new snapshot is a new immutable file, and only the tiny
 * `current` pointer is replaced, by rename. Readers therefore never observe a
 * partial state and never need a lock.
 */
export async function putBundle(
  source: string,
  options: PutOptions
): Promise<PutResult> {
  const { root, tenant } = options

  await mkdir(snapshotsDir(root, tenant), { recursive: true })

  const compiled = await compileBundle(source, compileOptions(options))
  const bytes = encodeTnt(compiled.tsv, toTntConcepts(compiled))
  const snapshot = digest(bytes)
  const target = snapshotFile(root, tenant, snapshot)
  const release = await acquireWriteLock(lockFile(root, tenant))

  try {
    const reused = await Bun.file(target).exists()

    if (!reused) {
      await writeSynced(target, bytes)
      await syncDir(snapshotsDir(root, tenant))
    }

    await setCurrent(root, tenant, snapshot)
    await appendFile(
      logFile(root, tenant),
      `${JSON.stringify({
        at: new Date().toISOString(),
        tenant,
        source,
        snapshot,
        concepts: compiled.concepts.length,
        bytes: bytes.byteLength,
        reused
      })}\n`
    )

    return {
      snapshot,
      concepts: compiled.concepts.length,
      bytes: bytes.byteLength,
      reused,
      diagnostics: compiled.diagnostics
    }
  } finally {
    await release()
  }
}
