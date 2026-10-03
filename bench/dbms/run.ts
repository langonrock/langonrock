import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir, cpus, totalmem } from 'node:os'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { disk, fixture } from './fixtures.ts'
import { BASELINE, SIZES } from './protocol.ts'
import { environment, fingerprints } from './evidence.ts'
import { runWorker } from './process.ts'
import { PHASES, validateSamples } from './validation.ts'

import type { Sample, WorkerRequest } from './protocol.ts'

const repo = resolve(import.meta.dir, '../..')
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    before: { type: 'string', default: BASELINE },
    after: { type: 'string', default: repo },
    pairs: { type: 'string', default: '10' },
    size: { type: 'string' },
    output: { type: 'string', default: 'bench/results/dbms/comparison.json' },
    'baseline-only': { type: 'boolean' },
    'self-check': { type: 'boolean' }
  }
})

if (await Bun.file(resolve(values.output)).exists()) {
  throw new Error(
    'benchmark output already exists; choose a new path to preserve raw evidence'
  )
}

const root = await mkdtemp(`${tmpdir()}/langonrock-benchmark-`)
const frozen = await fingerprints(repo, resolve(values.after))
const machine = await environment(root)
let verified = false

async function command(argv: string[]): Promise<string> {
  const child = Bun.spawn(argv, {
    cwd: repo,
    stdout: 'pipe',
    stderr: 'inherit'
  })
  const output = await new Response(child.stdout).text()

  if ((await child.exited) !== 0) {
    throw new Error(`benchmark command failed: ${argv[0]}`)
  }

  return output.trim()
}

async function baseline(): Promise<string> {
  const target = `${root}/before`

  await mkdir(target)
  await command([
    'git',
    'archive',
    values.before,
    '--output',
    `${root}/before.tar`,
    'src',
    'package.json',
    'bun.lock'
  ])
  await command(['tar', '-xf', `${root}/before.tar`, '-C', target])
  await symlink(`${repo}/node_modules`, `${target}/node_modules`, 'dir')

  return target
}

async function runSide(request: Omit<WorkerRequest, 'phase'>) {
  await mkdir(request.store, { recursive: true })

  const samples: Sample[] = []
  let editedDisk = { logical: 0, allocated: 0 }

  for (const phase of PHASES) {
    samples.push(await runWorker({ ...request, phase }))

    if (phase === 'edits') {
      editedDisk = await disk(request.store)
    }
  }

  validateSamples(samples, 2)

  return {
    samples,
    diskAfterEdits: editedDisk,
    sourceDisk: await disk(request.source)
  }
}

async function main() {
  const before = await baseline()
  const pairs = Number(values.pairs)
  const sizes = values.size === undefined ? SIZES : [Number(values.size)]
  const runs = []

  if (
    !Number.isInteger(pairs) ||
    pairs < 1 ||
    sizes.some(size => !SIZES.includes(size))
  ) {
    throw new Error('invalid benchmark pair count or size')
  }

  for (const size of sizes) {
    const source = `${root}/source-${size}`
    const data = await fixture(source, size)

    for (let pair = 0; pair < pairs; pair++) {
      const sides = order(pair)

      for (const side of sides) {
        process.stderr.write(
          `${size} concepts, pair ${pair + 1}/${pairs}, ${side}\n`
        )

        const legacy = side === 'before' || values['self-check'] === true
        const code = legacy ? before : resolve(values.after)
        const store = `${root}/store-${size}-${pair}-${side}`
        const mode = legacy ? 'legacy' : 'native'
        const result = await runSide({
          code,
          store,
          source,
          bundle: data.bundle,
          path: data.path,
          mode
        })

        runs.push({
          protocol: 2,
          size,
          pair,
          side,
          fixture: data.hash,
          ...result
        })
        await save(runs)
        await rm(store, { recursive: true })
      }
    }
  }

  const current = await fingerprints(repo, resolve(values.after))

  if (JSON.stringify(current) !== JSON.stringify(frozen)) {
    throw new Error(
      'benchmark source or protocol changed during capture; results are invalid'
    )
  }

  verified = true
  await save(runs)
}

function order(pair: number): string[] {
  if (values['baseline-only']) {
    return ['before']
  }

  return pair % 2 === 0 ? ['before', 'after'] : ['after', 'before']
}

async function save(runs: unknown[]) {
  await Bun.write(
    resolve(values.output),
    `${JSON.stringify(
      {
        protocol: 2,
        verified,
        ...frozen,
        ...machine,
        before: values.before,
        candidate: await command(['git', 'rev-parse', 'HEAD']),
        bun: Bun.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
        memory: totalmem(),
        at: new Date().toISOString(),
        command: Bun.argv,
        peakRssUnit: 'bytes',
        runs
      },
      null,
      2
    )}\n`
  )
}

try {
  await main()
} finally {
  await rm(root, { recursive: true, force: true })
}
