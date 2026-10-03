import { compareGrouped } from './metrics.ts'
import { validateSamples } from './validation.ts'

import type { Sample } from './protocol.ts'

export interface Run {
  protocol?: number
  size: number
  pair: number
  side: string
  fixture: string
  samples: Sample[]
}

export function assertEquivalent(before: Run, after: Run): void {
  validateSamples(before.samples, before.protocol)
  validateSamples(after.samples, after.protocol)

  if (
    before.protocol !== after.protocol ||
    before.fixture !== after.fixture ||
    before.samples.length !== after.samples.length
  ) {
    throw new Error('benchmark fixture or workload mismatch')
  }

  for (const old of before.samples) {
    const current = after.samples.find(sample => sample.phase === old.phase)

    if (
      current === undefined ||
      JSON.stringify(old.checks) !== JSON.stringify(current.checks)
    ) {
      throw new Error(`correctness mismatch for ${old.phase}`)
    }
  }
}

function metrics(
  run: Run
): Map<string, { values: number[]; limit: number; fraction: number }> {
  const result = new Map<
    string,
    { values: number[]; limit: number; fraction: number }
  >()
  const readMetrics = new Set(['search', 'get', 'section', 'slice', 'find'])

  for (const sample of run.samples) {
    result.set(`${sample.phase}.peakRssBytes`, {
      values: [sample.peakRssBytes],
      fraction: 0.5,
      limit: 1.1
    })
    result.set(`${sample.phase}.steadyRssBytes`, {
      values: [sample.steadyRssBytes],
      fraction: 0.5,
      limit: 1.1
    })

    for (const [key, values] of Object.entries(sample.timings)) {
      if (key === 'manifest') {
        continue
      }

      for (const fraction of [0.5, 0.95]) {
        const name = key === 'processStartup' ? `${sample.phase}.${key}` : key

        result.set(`${name}.p${fraction * 100}`, {
          values,
          fraction,
          limit: readMetrics.has(key) ? 1.05 : 1.1
        })
      }
    }
  }

  return result
}

export function report(runs: Run[]): string {
  const identities = runs.map(run => `${run.size}/${run.pair}/${run.side}`)

  if (
    runs.length === 0 ||
    new Set(identities).size !== runs.length ||
    runs.some(run => !['before', 'after'].includes(run.side))
  ) {
    throw new Error('duplicate, empty, or invalid benchmark runs')
  }

  const lines = [
    '# DBMS benchmark comparison',
    '',
    '| Concepts | Metric | Before | After | Difference | Change | 95% ratio interval | Verdict |',
    '| ---: | --- | ---: | ---: | ---: | ---: | --- | --- |'
  ]

  for (const size of [...new Set(runs.map(run => run.size))]) {
    const before = runs.filter(
      run => run.size === size && run.side === 'before'
    )
    const candidates = runs.filter(
      run => run.size === size && run.side === 'after'
    )

    if (before.length !== candidates.length) {
      throw new Error('missing candidate pair or unmatched candidate')
    }

    const after = before.map(old => {
      const current = runs.find(
        run =>
          run.size === size && run.side === 'after' && run.pair === old.pair
      )

      if (current === undefined) {
        throw new Error('missing candidate pair')
      }

      assertEquivalent(old, current)

      return current
    })
    const oldMetrics = before.map(metrics)
    const newMetrics = after.map(metrics)

    for (const [name, metric] of oldMetrics[0] ?? []) {
      const old = oldMetrics.map(values => values.get(name)?.values ?? [])
      const current = newMetrics.map(values => values.get(name)?.values ?? [])
      const comparison = compareGrouped(
        old,
        current,
        metric.limit,
        metric.fraction
      )

      lines.push(
        `| ${size} | ${name} | ${comparison.before.toFixed(3)} | ${comparison.after.toFixed(3)} | ${comparison.delta.toFixed(3)} | ${((comparison.ratio - 1) * 100).toFixed(2)}% | ${comparison.interval.map(value => value.toFixed(4)).join('–')} | ${comparison.verdict} |`
      )
    }
  }

  return `${lines.join('\n')}\n`
}

if (import.meta.main) {
  const input = (await Bun.file(Bun.argv[2] ?? '').json()) as {
    protocol?: number
    runs: Run[]
    verified?: boolean
  }

  if (
    input.verified === false ||
    (input.protocol === 2 && input.verified !== true)
  ) {
    throw new Error(
      'benchmark capture is incomplete or changed during execution'
    )
  }

  process.stdout.write(report(input.runs))
}
