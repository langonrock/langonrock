import { readdir } from 'node:fs/promises'

import { generate } from '../corpus.ts'
import { SEED, digest } from './protocol.ts'

export async function fixture(source: string, concepts: number) {
  const corpus = await generate(source, {
    bundles: concepts / 500,
    perBundle: 500,
    seed: SEED
  })
  const paths = await Array.fromAsync(
    new Bun.Glob('**/*.md').scan({ cwd: source })
  )
  const hashes: string[] = []

  for (const path of paths.sort()) {
    hashes.push(
      `${path}\0${digest(new Uint8Array(await Bun.file(`${source}/${path}`).arrayBuffer()))}`
    )
  }

  const first = corpus.concepts[0]

  if (first === undefined) {
    throw new Error('benchmark fixture is empty')
  }

  return {
    hash: digest(hashes.join('\n')),
    bundle: first.bundle,
    path: first.path
  }
}

export async function disk(
  root: string
): Promise<{ logical: number; allocated: number }> {
  const { stat } = await import('node:fs/promises')
  let logical = 0
  let allocated = 0

  for (const item of await readdir(root, {
    recursive: true,
    withFileTypes: true
  })) {
    if (!item.isFile()) {
      continue
    }

    const info = await stat(`${item.parentPath}/${item.name}`)

    logical += info.size
    allocated += info.blocks * 512
  }

  return { logical, allocated }
}
