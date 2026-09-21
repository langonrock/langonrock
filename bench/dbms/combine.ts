import { resolve } from 'node:path'

import { report } from './compare.ts'
import { digest } from './protocol.ts'

import type { Run } from './compare.ts'

interface Capture {
  [key: string]: unknown
  verified: boolean
  runs: Run[]
}

const FIELDS = [
  'protocol',
  'sourceTree',
  'harness',
  'nativeBuild',
  'before',
  'bun',
  'platform',
  'arch',
  'cpu',
  'memory',
  'osRelease',
  'filesystem',
  'evaluationDate',
  'operations',
  'durability',
  'cache'
]
const output = Bun.argv[2]
const files = Bun.argv.slice(3)
const runs: Run[] = []
const captures: Record<string, unknown>[] = []
let first: Capture | undefined

if (
  output === undefined ||
  !output.endsWith('.json') ||
  files.length < 2 ||
  (await Bun.file(output).exists())
) {
  throw new Error(
    'choose a new output file and at least two verified input captures'
  )
}

for (const path of files) {
  if (resolve(path) === resolve(output)) {
    throw new Error('output must not replace an input capture')
  }

  const bytes = await Bun.file(path).text()
  const capture = JSON.parse(bytes) as Capture

  if (capture.verified !== true) {
    throw new Error(`unverified capture: ${path}`)
  }

  first ??= capture

  for (const field of FIELDS) {
    if (JSON.stringify(first[field]) !== JSON.stringify(capture[field])) {
      throw new Error(`incompatible capture ${path}: ${field}`)
    }
  }

  const offsets = new Map(
    [...new Set(capture.runs.map(run => run.size))].map(size => [
      size,
      Math.max(
        -1,
        ...runs.filter(run => run.size === size).map(run => run.pair)
      ) + 1
    ])
  )

  runs.push(
    ...capture.runs.map(run => ({
      ...run,
      pair: run.pair + (offsets.get(run.size) ?? 0)
    }))
  )
  captures.push({
    path,
    sha256: digest(bytes),
    at: capture.at,
    command: capture.command
  })
}

const markdown = report(runs)

await Bun.write(
  output,
  `${JSON.stringify({ ...first, command: Bun.argv, captures, runs }, null, 2)}\n`
)
await Bun.write(output.replace(/\.json$/, '.md'), markdown)
process.stdout.write(
  markdown
    .split('\n')
    .filter(line => /fail|inconclusive/.test(line))
    .join('\n') || 'All measured rows pass\n'
)
