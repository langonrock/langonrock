import { percentile } from '../dbms/metrics.ts'
import { check } from './types.ts'

import type { Sample } from './types.ts'

interface Run {
  size: number
  repetition: number
  fixture: string
  maintenance: Sample
  recovery: Sample
  concurrent: {
    simultaneousWorkerRssBytes: number
    coordinatorRssBytes: number
    writers: { outcome: string; elapsed: number; peakRssBytes: number }[]
    reader: { peakRssBytes: number }
  }
  retention: Record<
    string,
    {
      before: { logical: number; allocated: number }
      after: { logical: number; allocated: number }
      source: { logical: number; allocated: number }
    }
  >
}

function metrics(run: Run): Record<string, number[]> {
  const result: Record<string, number[]> = {
    ...run.maintenance.timings,
    ...run.recovery.timings,
    maintenancePeakRssBytes: [run.maintenance.peakRssBytes],
    recoveryPeakRssBytes: [run.recovery.peakRssBytes],
    simultaneousWorkerRssBytes: [run.concurrent.simultaneousWorkerRssBytes],
    coordinatorRssBytes: [run.concurrent.coordinatorRssBytes],
    manifestBytes: [Number(run.maintenance.checks['manifestBytes'])],
    manifestTokenEstimate: [
      Number(run.maintenance.checks['manifestTokenEstimate'])
    ]
  }

  for (const writer of run.concurrent.writers) {
    result[`${writer.outcome}Publication`] = [writer.elapsed]
    result[`${writer.outcome}PeakRssBytes`] = [writer.peakRssBytes]
  }

  for (const metric of ['diskBeforeGc', 'diskAfterGc']) {
    const value = run.recovery.checks[metric] as {
      logical: number
      allocated: number
    }

    result[`${metric}.logicalBytes`] = [value.logical]
    result[`${metric}.allocatedBytes`] = [value.allocated]
  }

  for (const [side, disk] of Object.entries(run.retention)) {
    result[`${side}.equalEditsStoreLogicalBytes`] = [disk.before.logical]
    result[`${side}.equalEditsStoreAllocatedBytes`] = [disk.before.allocated]
    result[`${side}.equalRetentionStoreLogicalBytes`] = [disk.after.logical]
    result[`${side}.equalRetentionStoreAllocatedBytes`] = [disk.after.allocated]
    result[`${side}.originalSourceLogicalBytes`] = [disk.source.logical]
    result[`${side}.originalSourceAllocatedBytes`] = [disk.source.allocated]
    result[`${side}.totalRetainedLogicalBytes`] = [
      disk.after.logical + disk.source.logical
    ]
    result[`${side}.totalRetainedAllocatedBytes`] = [
      disk.after.allocated + disk.source.allocated
    ]
  }

  return result
}

const capture = (await Bun.file(Bun.argv[2] ?? '').json()) as {
  verified: boolean
  runs: Run[]
  schemas: Record<
    string,
    { count: number; bytes: number; tokenEstimate: number }
  >
}

check(
  capture.verified && capture.runs.length > 0,
  'capture has not passed verification'
)
const lines = [
  '# Native DBMS operation costs',
  '',
  'Native maintenance operations have no legacy equivalent and show absolute costs. Before/after disk rows use ten identical edits and ten retained versions on each side. Times are milliseconds; RSS and disk values are bytes. Token estimates use characters / 4, rounded up, not a model tokenizer.',
  '',
  '| Concepts | Metric | Samples | p50 | p95 |',
  '| ---: | --- | ---: | ---: | ---: |'
]

for (const size of [...new Set(capture.runs.map(run => run.size))]) {
  const selected = capture.runs.filter(run => run.size === size).map(metrics)

  for (const name of Object.keys(selected[0] ?? {})) {
    const values = selected.flatMap(row => row[name] ?? [])

    lines.push(
      `| ${size} | ${name} | ${values.length} | ${percentile(values, 0.5).toFixed(3)} | ${percentile(values, 0.95).toFixed(3)} |`
    )
  }
}

lines.push(
  '',
  '## MCP tool schemas',
  '',
  '| Configuration | Tools | JSON bytes | Estimated tokens |',
  '| --- | ---: | ---: | ---: |'
)

for (const [name, value] of Object.entries(capture.schemas)) {
  lines.push(
    `| ${name} | ${value.count} | ${value.bytes} | ${value.tokenEstimate} |`
  )
}

process.stdout.write(`${lines.join('\n')}\n`)
