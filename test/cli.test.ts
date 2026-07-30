import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = `${import.meta.dir}/../src/cli.ts`
const FIXTURE = `${import.meta.dir}/fixtures/sales`

const scratch = await mkdtemp(join(tmpdir(), 'langonrock-'))

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

interface Run {
  stdout: string
  stderr: string
  code: number
}

async function run(args: string[]): Promise<Run> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe'
  })

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ])

  return { stdout, stderr, code }
}

describe('cli', () => {
  test('writes the manifest to stdout and stats to stderr', async () => {
    const result = await run(['compile', FIXTURE, '--bundle', 'sales'])

    expect(result.code).toBe(0)
    expect(result.stdout.startsWith('# bundle: sales\n')).toBe(true)
    expect(result.stderr).toContain('6 concepts')
    expect(result.stderr).toContain('tokens')
  })

  test('reports diagnostics but still succeeds without --strict', async () => {
    const result = await run(['compile', FIXTURE])

    expect(result.code).toBe(0)
    expect(result.stderr).toContain('missing required frontmatter field "type"')
  })

  test('exits non-zero with --strict when diagnostics exist', async () => {
    const result = await run(['compile', FIXTURE, '--strict'])

    expect(result.code).toBe(1)
    expect(result.stdout.startsWith('# bundle: sales\n')).toBe(true)
  })

  test('--out writes a file and keeps stdout clean', async () => {
    const target = join(scratch, 'manifest.tsv')
    const result = await run(['compile', FIXTURE, '--out', target])

    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
    expect(await Bun.file(target).text()).toContain('# bundle: sales\n')
  })

  test('two runs to --out produce identical bytes', async () => {
    const a = join(scratch, 'a.tsv')
    const b = join(scratch, 'b.tsv')

    await run(['compile', FIXTURE, '--out', a])
    await run(['compile', FIXTURE, '--out', b])

    expect(await Bun.file(b).text()).toBe(await Bun.file(a).text())
  })

  test('rejects an unknown command', async () => {
    const result = await run(['explode', FIXTURE])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('unknown command')
  })

  test('rejects a non-positive summary width', async () => {
    const result = await run(['compile', FIXTURE, '--summary-width', '0'])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--summary-width')
  })

  test('prints usage and exits zero for --help', async () => {
    const result = await run(['--help'])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('usage:')
  })

  test('prints usage and exits non-zero with no arguments', async () => {
    const result = await run([])

    expect(result.code).toBe(1)
    expect(result.stdout).toContain('usage:')
  })
})
