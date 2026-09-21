import { realpath } from 'node:fs/promises'

import { releaseBuffer } from '../buffers.ts'
import { discoverBundles } from '../compile/tenant.ts'
import { assertBundleName } from '../store/sourcepaths.ts'
import { hash } from './format.ts'
import { encodeImport } from './importstate.ts'
import { bundlePaths } from './input.ts'
import { visit } from './workers.ts'
import { readText } from './text.ts'

import type {
  ImportArtifact,
  ImportLocation,
  ImportedFile
} from './importstate.ts'

export interface ScannedFile extends ImportedFile {
  filename: string
}

export interface ScannedImport {
  artifact: ImportArtifact
  files: ScannedFile[]
  bundles: string[]
}

export async function scanImport(
  location: ImportLocation
): Promise<ScannedImport> {
  const source = await realpath(location.source)
  const bundles =
    location.bundle === undefined
      ? await discoverBundles(source)
      : [{ name: assertBundleName(location.bundle), dir: source }]
  const files: ScannedFile[] = []

  for (const bundle of bundles) {
    const paths = await bundlePaths(bundle.dir)

    await visit(paths, async path => {
      const filename = `${bundle.dir}/${path}`

      files.push({
        bundle: bundle.name,
        path,
        filename,
        hash: hash(await readText(Bun.file(filename)))
      })
    })
  }

  return {
    files,
    bundles: bundles.map(bundle => bundle.name),
    artifact: encodeImport(
      { ...location, source },
      files,
      bundles.map(bundle => bundle.name)
    )
  }
}

export async function scanImports(
  locations: ImportLocation[]
): Promise<ScannedImport[]> {
  const outcomes = await Promise.allSettled(locations.map(scanImport))
  const scans: ScannedImport[] = []
  const failed = outcomes.find(outcome => outcome.status === 'rejected')

  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') {
      scans.push(outcome.value)
    }
  }

  if (failed?.status === 'rejected') {
    for (const scan of scans) {
      releaseBuffer(scan.artifact.bytes)
    }

    throw failed.reason
  }

  return scans
}
