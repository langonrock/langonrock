import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  compare,
  compareGrouped,
  peakRssBytes,
  percentile
} from '../bench/dbms/metrics.ts'
import { assertEquivalent, report } from '../bench/dbms/compare.ts'
import { reciprocalRank } from '../bench/dbms/retrieval.ts'
import { validateSamples } from '../bench/dbms/validation.ts'
import { fixEvaluationDate } from '../bench/dbms/clock.ts'
import { EVALUATION_DATE } from '../bench/dbms/protocol.ts'
import { tree } from '../bench/dbms/evidence.ts'
import { memory } from '../bench/operations/types.ts'

import type { Run } from '../bench/dbms/compare.ts'
import type { Sample } from '../bench/dbms/protocol.ts'

function run(side = 'before', pair = 0): Run {
  const memory = { peakRssBytes: 1000, steadyRssBytes: 800 }
  const calls = () => new Array<number>(100).fill(1)
  const samples: Sample[] = [
    { ...memory, phase: 'import', timings: { import: [1] }, checks: {} },
    { ...memory, phase: 'open', timings: { open: [1] }, checks: {} },
    {
      ...memory,
      phase: 'reads',
      timings: {
        firstSearch: [1],
        search: [...calls().slice(0, 90), ...new Array<number>(10).fill(10)],
        get: calls(),
        section: calls(),
        slice: calls(),
        find: calls(),
        manifest: calls()
      },
      checks: {
        manifest: 'same',
        manifestChars: 4,
        get: 'same',
        section: 'same',
        slice: 'same',
        find: 'same',
        bundleManifest: 'same',
        search0: 'same',
        search1: 'same',
        search2: 'same',
        search3: 'same',
        search4: 'same'
      }
    },
    {
      ...memory,
      phase: 'edits',
      timings: { editToSearch: new Array<number>(10).fill(1) },
      checks: { visibleEdits: 10 }
    },
    { ...memory, phase: 'tenants', timings: {}, checks: { heldTenants: 5 } }
  ]

  return { size: 500, pair, side, fixture: 'a', samples }
}

describe('benchmark verdicts', () => {
  test('capture runners refuse to replace existing evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'langonrock-evidence-'))
    const output = `${root}/capture.json`

    try {
      await Bun.write(output, 'preserve every byte')

      for (const folder of ['dbms', 'operations']) {
        const child = Bun.spawn(
          [
            process.execPath,
            `${import.meta.dir}/../bench/${folder}/run.ts`,
            '--output',
            output
          ],
          { stdout: 'pipe', stderr: 'pipe' }
        )
        const [, error, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited
        ])

        expect(code).toBe(1)
        expect(error).toContain('output already exists')
        expect(await Bun.file(output).text()).toBe('preserve every byte')
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('protocol 2 reports require an explicit completed verification marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'langonrock-evidence-'))
    const input = `${root}/capture.json`

    try {
      await Bun.write(
        input,
        JSON.stringify({
          protocol: 2,
          runs: [
            run('before', 0),
            run('after', 0),
            run('before', 1),
            run('after', 1)
          ]
        })
      )
      const child = Bun.spawn(
        [
          process.execPath,
          `${import.meta.dir}/../bench/dbms/compare.ts`,
          input
        ],
        { stdout: 'pipe', stderr: 'pipe' }
      )
      const [, error, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited
      ])

      expect(code).toBe(1)
      expect(error).toContain('capture is incomplete')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('source fingerprints cover real files, detect changes, and reject unmatched patterns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'langonrock-fingerprint-'))

    try {
      await Bun.write(`${root}/src/a.ts`, 'one')
      await Bun.write(`${root}/native/a.c`, 'two')

      const original = await tree(root, ['src/**/*', 'native/**/*'])

      expect(original).not.toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      )
      expect(await tree(root, ['native/**/*', 'src/**/*'])).toBe(original)
      await Bun.write(`${root}/native/a.c`, 'changed')
      expect(await tree(root, ['src/**/*', 'native/**/*'])).not.toBe(original)
      await expect(tree(root, ['src/**/*', 'absent/**/*'])).rejects.toThrow(
        'matched no files'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('passes at the fixed budget and fails beyond it', () => {
    expect(compare([100, 100], [105, 105], 1.05).verdict).toBe('pass')
    expect(compare([100, 100], [106, 106], 1.05).verdict).toBe('fail')
  })

  test('does not turn noisy measurements into a pass', () => {
    expect(compare([100, 100, 100], [80, 105, 130], 1.05).verdict).toBe(
      'inconclusive'
    )
  })

  test('rejects missing, negative, or invalid metrics', () => {
    expect(() => compare([1, 2], [1], 1.05)).toThrow()
    expect(() => compare([0, 1], [1, 1], 1.05)).toThrow()
    expect(() => compare([-1, -1], [-1, -1], 1.05)).toThrow()
    expect(() => percentile([], 0.95)).toThrow()
    expect(() => percentile([NaN], 0.95)).toThrow()
    expect(() => percentile([1], 0)).toThrow()
  })

  test('computes tails across fresh processes and retains process pairs in uncertainty estimates', () => {
    const groups = [[1], [2], [3], [4], [100]]

    expect(compareGrouped(groups, groups, 1.1).before).toBe(3)
    expect(compareGrouped(groups, groups, 1.1, 0.95).before).toBe(100)
    expect(compareGrouped(groups, groups, 1.1, 0.95).interval).toEqual([1, 1])
    expect(
      percentile(
        Array.from({ length: 100 }, (_, index) => index + 1),
        0.95
      )
    ).toBe(95)
  })

  test('rejects a different corpus, a missing candidate, and duplicate pairs', () => {
    const before = run()

    expect(() =>
      assertEquivalent(before, { ...before, fixture: 'b' })
    ).toThrow()
    expect(() => report([before])).toThrow('missing candidate')
    expect(() => report([before, before])).toThrow('duplicate')
    expect(() => report([])).toThrow('empty')
  })

  test('rejects duplicate or missing phases and omitted metrics or correctness checks', () => {
    const complete = run()
    const sample = complete.samples[2]

    expect(() => validateSamples(complete.samples.slice(1))).toThrow(
      'every phase'
    )
    expect(() =>
      validateSamples([
        ...complete.samples.slice(1),
        complete.samples[1] as Sample
      ])
    ).toThrow('every phase')

    if (sample === undefined) {
      throw new Error('missing fixture')
    }

    delete sample.timings['get']
    expect(() => validateSamples(complete.samples)).toThrow('timing')
    sample.timings['get'] = new Array<number>(100).fill(1)
    delete sample.checks['find']
    expect(() => validateSamples(complete.samples)).toThrow('correctness')
  })

  test('checks content and reports latency tails, intervals, and native memory', () => {
    const before = run()
    const changed = run('after')
    const sample = changed.samples[2]

    if (sample !== undefined) {
      sample.checks['manifest'] = 'different'
    }

    expect(() => assertEquivalent(before, changed)).toThrow(
      'correctness mismatch'
    )

    const output = report([
      before,
      run('before', 1),
      run('after'),
      run('after', 1)
    ])

    expect(output).toContain(
      'search.p95 | 10.000 | 10.000 | 0.000 | 0.00% | 1.0000–1.0000 | pass'
    )
    expect(output).toContain('reads.peakRssBytes | 1000.000')
    expect(output).not.toContain('manifest.p')
  })

  test('ground truth counts direct results and excludes linked expansion', () => {
    const response =
      '# hits: 2 direct, 1 linked\nid\tbundle\norders\tdocs\npayments_b1\tdocs\ninventory\tdocs\n'

    expect(reciprocalRank(response, 1)).toBe(0.5)
    expect(reciprocalRank(response, 4)).toBe(0)
    expect(() => reciprocalRank('invalid', 0)).toThrow('hit count')
  })

  test('both harnesses record peak RSS in bytes on this runtime', () => {
    const steady = process.memoryUsage().rss
    const operations = memory()

    for (const peak of [peakRssBytes(steady), operations.peakRssBytes]) {
      expect(peak).toBeGreaterThanOrEqual(steady * 0.9)
      expect(peak).toBeLessThan(steady * 64)
    }
  })

  test('fixes the evaluation date without changing explicit date parsing', () => {
    const original = Date

    try {
      fixEvaluationDate()
      expect(new Date().toISOString()).toBe(EVALUATION_DATE)
      expect(Date.now()).toBe(original.parse(EVALUATION_DATE))
      expect(new Date('2000-01-01').getUTCFullYear()).toBe(2000)
      expect(new original() instanceof Date).toBe(true)
    } finally {
      globalThis.Date = original
    }
  })
})
