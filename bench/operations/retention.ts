import { mkdir, symlink } from 'node:fs/promises'
import { resolve } from 'node:path'

import { BASELINE } from '../dbms/protocol.ts'
import { check } from './types.ts'

import type { Request } from './types.ts'

const repo = resolve(import.meta.dir, '../..')

async function command(args: string[]): Promise<string> {
  const child = Bun.spawn(args, {
    cwd: repo,
    stdout: 'pipe',
    stderr: 'inherit'
  })
  const output = await new Response(child.stdout).text()

  check((await child.exited) === 0, `retention command failed: ${args[0]}`)

  return output
}

export async function baseline(root: string): Promise<string> {
  const before = `${root}/before`

  await mkdir(before)
  await command([
    'git',
    'archive',
    BASELINE,
    '--output',
    `${root}/before.tar`,
    'src',
    'package.json',
    'bun.lock'
  ])
  await command(['tar', '-xf', `${root}/before.tar`, '-C', before])
  await symlink(`${repo}/node_modules`, `${before}/node_modules`, 'dir')

  return before
}

interface DiskSample {
  before: { logical: number; allocated: number }
  after: { logical: number; allocated: number }
  source: { logical: number; allocated: number }
  manifest: string
  retained: number
  edits: number
}

export async function retention(
  input: Request,
  before: string,
  repetition: number
) {
  const result: Record<string, DiskSample> = {}
  const sides = repetition % 2 === 0 ? ['before', 'after'] : ['after', 'before']

  for (const side of sides) {
    const store = `${input.target.root}/equal-retention-${side}`
    const request = {
      code: side === 'before' ? before : repo,
      store,
      source: input.source,
      bundle: input.bundle,
      path: input.path,
      phase: 'edits',
      mode: side === 'before' ? 'legacy' : 'native'
    }

    await mkdir(store)
    result[side] = JSON.parse(
      await command([
        process.execPath,
        `${import.meta.dir}/retention-worker.ts`,
        JSON.stringify(request)
      ])
    ) as DiskSample
  }

  check(
    result['before']?.manifest === result['after']?.manifest,
    'equal retention read outputs differ'
  )

  return result
}
