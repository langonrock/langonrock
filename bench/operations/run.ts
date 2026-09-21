import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { cpus, tmpdir, totalmem } from 'node:os'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { environment, fingerprints, tree } from '../dbms/evidence.ts'
import { fixture } from '../dbms/fixtures.ts'
import { BASELINE, SIZES, TENANT } from '../dbms/protocol.ts'
import { contention, interrupted } from './concurrent.ts'
import { peer } from './peer.ts'
import { baseline, retention } from './retention.ts'
import { check } from './types.ts'

import type { Request, Sample } from './types.ts'

const repo = resolve(import.meta.dir, '../..')
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    repetitions: { type: 'string', default: '10' },
    size: { type: 'string' },
    output: { type: 'string', default: 'bench/results/dbms/operations-v1.json' }
  }
})

if (await Bun.file(resolve(values.output)).exists()) {
  throw new Error(
    'benchmark output already exists; choose a new path to preserve raw evidence'
  )
}

const root = await mkdtemp(`${tmpdir()}/langonrock-operations-`)
const frozen = {
  ...(await fingerprints(repo, repo)),
  operationsHarness: await tree(repo, ['bench/operations/*.ts'])
}
const machine = await environment(root)
const before = await baseline(root)
const runs: (Awaited<ReturnType<typeof run>> & {
  size: number
  repetition: number
  fixture: string
  retention: Awaited<ReturnType<typeof retention>>
})[] = []
let verified = false

async function once(input: Request): Promise<Sample> {
  const child = peer(input)

  try {
    const result = await child.next<Sample>()

    await child.finish()

    return result
  } finally {
    await child.kill()
  }
}

async function run(input: Request) {
  const maintenance = await once({ ...input, role: 'maintenance' })
  const concurrent = await contention(input)

  await interrupted(input)
  const recovery = await once({ ...input, role: 'recovery' })

  check(
    recovery.checks['head'] === concurrent.head,
    'killed commit became current'
  )

  return { maintenance, concurrent, recovery }
}

async function save(extra: Record<string, unknown> = {}) {
  await Bun.write(
    resolve(values.output),
    `${JSON.stringify(
      {
        protocol: 'dbms-operations-1',
        before: BASELINE,
        verified,
        ...frozen,
        ...machine,
        bun: Bun.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
        memory: totalmem(),
        at: new Date().toISOString(),
        command: Bun.argv,
        peakRssUnit: 'bytes',
        runs,
        ...extra
      },
      null,
      2
    )}\n`
  )
}

async function main() {
  const repetitions = Number(values.repetitions)
  const sizes = values.size === undefined ? SIZES : [Number(values.size)]

  check(
    Number.isSafeInteger(repetitions) &&
      repetitions > 0 &&
      sizes.every(size => SIZES.includes(size)),
    'invalid benchmark dimensions'
  )

  for (const size of sizes) {
    const source = `${root}/source-${size}`
    const data = await fixture(source, size)

    for (let repetition = 0; repetition < repetitions; repetition++) {
      process.stderr.write(
        `${size} concepts, repetition ${repetition + 1}/${repetitions}\n`
      )
      const target = {
        root: `${root}/store-${size}-${repetition}`,
        tenant: TENANT
      }

      await mkdir(target.root)
      const input: Request = {
        target,
        source,
        bundle: data.bundle,
        path: data.path,
        role: 'maintenance'
      }

      runs.push({
        size,
        repetition,
        fixture: data.hash,
        ...(await run(input)),
        retention: await retention(input, before, repetition)
      })
      await save()
      await rm(target.root, { recursive: true })
    }

    check(
      (await tree(source, ['**/*.md'])) === data.hash,
      'original sources changed'
    )
  }

  const { schema } = await import('./schema.ts')
  const schemas = {
    default: await schema(root, false),
    optIn: await schema(root, true)
  }
  const current = {
    ...(await fingerprints(repo, repo)),
    operationsHarness: await tree(repo, ['bench/operations/*.ts'])
  }

  check(
    JSON.stringify(current) === JSON.stringify(frozen),
    'code changed during capture'
  )
  verified = true
  await save({ schemas })
}

try {
  await main()
} finally {
  await rm(root, { recursive: true, force: true })
}
