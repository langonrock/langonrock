import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DATA_ENV,
  platformDataDir,
  resolveDataDir
} from '../src/store/datadir.ts'

const original = process.env[DATA_ENV]

afterEach(() => {
  if (original === undefined) {
    delete process.env[DATA_ENV]
  } else {
    process.env[DATA_ENV] = original
  }
})

describe('platformDataDir', () => {
  test('follows the Apple convention on macOS', () => {
    expect(
      platformDataDir({ platform: 'darwin', env: {}, home: '/Users/me' })
    ).toBe('/Users/me/Library/Application Support/langonrock')
  })

  test('honours XDG_DATA_HOME on Linux', () => {
    expect(
      platformDataDir({
        platform: 'linux',
        env: { XDG_DATA_HOME: '/custom/share' },
        home: '/home/me'
      })
    ).toBe('/custom/share/langonrock')
  })

  test('falls back to ~/.local/share when XDG is unset or empty', () => {
    const home = '/home/me'

    expect(platformDataDir({ platform: 'linux', env: {}, home })).toBe(
      '/home/me/.local/share/langonrock'
    )
    expect(
      platformDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '' }, home })
    ).toBe('/home/me/.local/share/langonrock')
  })

  test('uses LOCALAPPDATA and backslashes on Windows', () => {
    expect(
      platformDataDir({
        platform: 'win32',
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
        home: 'C:\\Users\\me'
      })
    ).toBe('C:\\Users\\me\\AppData\\Local\\langonrock')
  })

  test('reconstructs the Windows path when LOCALAPPDATA is missing', () => {
    expect(
      platformDataDir({ platform: 'win32', env: {}, home: 'C:\\Users\\me' })
    ).toBe('C:\\Users\\me\\AppData\\Local\\langonrock')
  })

  test('treats an unknown platform as Linux rather than failing', () => {
    expect(
      platformDataDir({ platform: 'freebsd', env: {}, home: '/home/me' })
    ).toBe('/home/me/.local/share/langonrock')
  })
})

describe('resolveDataDir', () => {
  test('prefers an explicit flag over everything', () => {
    process.env[DATA_ENV] = '/from/env'

    expect(resolveDataDir('/from/flag')).toBe('/from/flag')
  })

  test('falls back to the environment when no flag is given', () => {
    process.env[DATA_ENV] = '/from/env'

    expect(resolveDataDir()).toBe('/from/env')
    expect(resolveDataDir('')).toBe('/from/env')
  })

  test('falls back to the platform directory when neither is set', () => {
    delete process.env[DATA_ENV]

    expect(resolveDataDir()).toBe(
      platformDataDir({
        platform: process.platform,
        env: process.env,
        home: homedir()
      })
    )
  })
})

describe('the CLI no longer demands --data', () => {
  let scratch = ''

  afterAll(async () => {
    if (scratch !== '') {
      await rm(scratch, { recursive: true, force: true })
    }
  })

  test('a put and a read agree on the resolved store', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'lr-datadir-'))

    const cli = `${import.meta.dir}/../src/cli.ts`
    const env = { ...process.env, [DATA_ENV]: join(scratch, 'store') }

    const put = Bun.spawn(
      [
        'bun',
        cli,
        'put',
        `${import.meta.dir}/fixtures/sales`,
        '--tenant',
        'acme'
      ],
      { env, stdout: 'pipe', stderr: 'pipe' }
    )

    expect(await put.exited).toBe(0)

    const read = Bun.spawn(['bun', cli, 'manifest', '--tenant', 'acme'], {
      env,
      stdout: 'pipe',
      stderr: 'pipe'
    })

    expect(await read.exited).toBe(0)
    expect(await new Response(read.stdout).text()).toContain('# tenant: acme')
  })
})
