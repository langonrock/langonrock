import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addToken, generateToken, loadTokens } from '../src/server/tokens.ts'

const CLI = `${import.meta.dir}/../src/cli.ts`
const ON_POSIX = process.platform !== 'win32'
const ANSI = /\[\d+m/g

const scratch = await mkdtemp(join(tmpdir(), 'lr-token-'))

let root = ''
let round = 0

beforeEach(async () => {
  round += 1
  root = join(scratch, `run-${round}`)
  await Bun.write(join(root, '.keep'), '')
})

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

async function run(args: string[]): Promise<{ out: string; err: string }> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])

  await proc.exited

  return { out, err: err.replaceAll(ANSI, '') }
}

describe('generateToken', () => {
  test('is 32 bytes of hex, which is nothing anyone guesses', () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/)
  })

  test('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateToken()))

    expect(seen.size).toBe(200)
  })
})

describe('addToken', () => {
  test('records a grant loadTokens reads back', async () => {
    const token = await addToken(root, { tenant: 'acme', write: false })

    expect(await loadTokens(root)).toEqual(
      new Map([[token, { tenant: 'acme', write: false }]])
    )
  })

  test('keeps write scope through the round trip', async () => {
    const token = await addToken(root, { tenant: 'acme', write: true })

    expect((await loadTokens(root)).get(token)?.write).toBe(true)
  })

  /**
   * A read-only grant stays a bare string, so a file this writes is still the
   * file the older format described and stays readable by hand.
   */
  test('writes a read-only grant as a bare string', async () => {
    const token = await addToken(root, { tenant: 'acme', write: false })
    const written = (await Bun.file(
      join(root, 'tokens.json')
    ).json()) as Record<string, unknown>

    expect(written[token]).toBe('acme')
  })

  test('adds to the tokens already there rather than replacing them', async () => {
    await writeFile(
      join(root, 'tokens.json'),
      JSON.stringify({ 'hand-written': 'acme' })
    )

    const token = await addToken(root, { tenant: 'ops', write: true })
    const grants = await loadTokens(root)

    expect(grants.size).toBe(2)
    expect(grants.get('hand-written')).toEqual({ tenant: 'acme', write: false })
    expect(grants.get(token)).toEqual({ tenant: 'ops', write: true })
  })

  test('leaves the file readable by nobody else', async () => {
    if (!ON_POSIX) {
      return
    }

    await addToken(root, { tenant: 'acme', write: false })

    expect((await stat(join(root, 'tokens.json'))).mode & 0o777).toBe(0o600)
  })

  /**
   * The atomic write reuses a temp path, so a world-readable one left by a
   * crash must not hand its mode to the secrets written next.
   */
  test('tightens a temp file left behind by a crash', async () => {
    if (!ON_POSIX) {
      return
    }

    await writeFile(join(root, 'tokens.json.tmp'), 'leftover', { mode: 0o644 })
    await addToken(root, { tenant: 'acme', write: false })

    expect((await stat(join(root, 'tokens.json'))).mode & 0o777).toBe(0o600)
  })
})

describe('the token command', () => {
  test('puts the token on stdout and everything else on stderr', async () => {
    const result = await run(['token', '--data', root, '--tenant', 'acme'])
    const token = result.out.trim()

    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(result.out).toBe(`${token}\n`)
    expect((await loadTokens(root)).get(token)).toEqual({
      tenant: 'acme',
      write: false
    })
  })

  test('says the running server will not see it until it restarts', async () => {
    const result = await run(['token', '--data', root, '--tenant', 'acme'])

    expect(result.err).toContain('restart')
    expect(result.err).toContain('read-only')
  })

  test('grants writing only when asked', async () => {
    const result = await run([
      'token',
      '--data',
      root,
      '--tenant',
      'acme',
      '--write'
    ])

    expect(result.err).toContain('read-write')
    expect((await loadTokens(root)).get(result.out.trim())?.write).toBe(true)
  })

  test('refuses a tenant id that could escape the data directory', async () => {
    const result = await run(['token', '--data', root, '--tenant', '../evil'])

    expect(result.err).toContain('invalid tenant id')
    expect((await loadTokens(root)).size).toBe(0)
  })

  test('requires a tenant', async () => {
    const result = await run(['token', '--data', root])

    expect(result.err).toContain('--tenant is required')
  })
})
