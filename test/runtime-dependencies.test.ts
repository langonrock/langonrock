import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import {
  checkRuntimeDependencies,
  packageViolations,
  sourceViolations
} from '../scripts/check-runtime-dependencies.ts'

describe('runtime dependency constraints', () => {
  test('rejects engines including runtime builtins', () => {
    expect(
      sourceViolations('src/db.ts', 'import { Database } from "bun:sqlite"')
    ).toHaveLength(1)
    expect(
      sourceViolations('src/db.ts', 'const db = require("better-sqlite3")')
    ).toHaveLength(1)
    expect(packageViolations({ 'node-gyp': '*', zod: '*' })).toEqual([
      'node-gyp'
    ])
  })

  test('rejects Python files and subprocesses without banning prose', () => {
    expect(sourceViolations('bench/test.py', '')).toHaveLength(1)
    expect(
      sourceViolations('bench/test.ts', 'Bun.spawn(["python", "test.py"])')
    ).toHaveLength(1)
    expect(sourceViolations('docs/note.md', 'Do not use Python.')).toEqual([])
    expect(
      sourceViolations(
        'src/test.ts',
        'import { readFile } from "node:fs/promises"'
      )
    ).toEqual([])
  })

  test('checks the delivered runtime and lockfile', async () => {
    expect(
      await checkRuntimeDependencies(resolve(import.meta.dir, '..'))
    ).toEqual([])
  })

  test('actually scans each delivered source directory', async () => {
    const root = await mkdtemp(`${tmpdir()}/langonrock-dependency-scan-`)

    try {
      await Bun.write(
        `${root}/package.json`,
        JSON.stringify({ dependencies: {} })
      )
      await Bun.write(`${root}/bun.lock`, JSON.stringify({ packages: {} }))

      for (const folder of ['src', 'scripts', 'bench', 'native']) {
        await Bun.write(`${root}/${folder}/forbidden.ts`, 'import "bun:sqlite"')
      }

      // Build output and raw captures are skipped on every OS, including
      // Windows, where the scan reports backslash separators.
      for (const skipped of ['native/bin', 'bench/results']) {
        await Bun.write(`${root}/${skipped}/ignored.ts`, 'import "bun:sqlite"')
      }

      const violations = await checkRuntimeDependencies(root)

      expect(violations.sort()).toEqual(
        ['src', 'scripts', 'bench', 'native']
          .map(
            folder => `${folder}/forbidden.ts: forbidden dependency bun:sqlite`
          )
          .sort()
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
