import { statfs } from 'node:fs/promises'
import { release } from 'node:os'

import {
  CALLS,
  EDITS,
  EVALUATION_DATE,
  QUERIES,
  RELEVANT_TOPICS,
  SEED,
  digest
} from './protocol.ts'

export async function tree(root: string, patterns: string[]): Promise<string> {
  const found = await Promise.all(
    patterns.map(pattern =>
      Array.fromAsync(
        new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })
      )
    )
  )
  const files = [...new Set(found.flat())]
  const hashes: string[] = []

  if (files.length === 0 || found.some(matches => matches.length === 0)) {
    throw new Error(`fingerprint pattern matched no files: ${root}`)
  }

  for (const path of files.sort()) {
    hashes.push(
      `${path}\0${digest(new Uint8Array(await Bun.file(`${root}/${path}`).arrayBuffer()))}`
    )
  }

  return digest(hashes.join('\n'))
}

export async function fingerprints(repo: string, candidate: string) {
  const [sourceTree, harness, nativeBuild] = await Promise.all([
    tree(candidate, [
      'src/**/*',
      'native/**/*',
      'scripts/build-native.ts',
      'package.json',
      'bun.lock'
    ]),
    tree(repo, ['bench/dbms/*.ts', 'bench/corpus.ts', 'bench/okf.ts']),
    tree(candidate, ['native/bin/*.node'])
  ])

  return { sourceTree, harness, nativeBuild }
}

export async function environment(root: string) {
  const filesystem = await statfs(root)

  return {
    osRelease: release(),
    filesystem: { type: filesystem.type, blockSize: filesystem.bsize },
    evaluationDate: EVALUATION_DATE,
    operations: digest(
      JSON.stringify({
        SEED,
        CALLS,
        EDITS,
        QUERIES,
        RELEVANT_TOPICS,
        EVALUATION_DATE
      })
    ),
    durability: {
      before: 'legacy file fsync and pointer rename',
      after:
        'artifact fsync, ordered root replacement, native durability barrier'
    },
    cache: 'fresh processes; OS filesystem cache is not cleared'
  }
}
