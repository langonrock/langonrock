import { adapter } from './adapters.ts'
import { fixEvaluationDate } from './clock.ts'
import { measure, peakRssBytes } from './metrics.ts'
import { TENANT } from './protocol.ts'
import { edits, reads, tenants } from './workloads.ts'

import type { Sample, WorkerRequest } from './protocol.ts'

const request = JSON.parse(Bun.argv[2] ?? '{}') as WorkerRequest

fixEvaluationDate()

const backend = await adapter(request)
const sample: Sample = {
  phase: request.phase,
  timings: {},
  peakRssBytes: 0,
  steadyRssBytes: 0,
  checks: {}
}

process.stdout.write('ready\n')

switch (request.phase) {
  case 'import':
    sample.timings['import'] = [await measure(() => backend.put(TENANT))]
    break
  case 'open':
    sample.timings['open'] = [await measure(() => backend.reader(TENANT))]
    break
  case 'reads':
    await reads(backend, sample)
    break
  case 'edits':
    await edits(backend, sample)
    break
  case 'tenants':
    await tenants(backend, sample)
    break
  default:
    throw new Error('unknown benchmark phase')
}

sample.steadyRssBytes ||= process.memoryUsage().rss
sample.peakRssBytes = peakRssBytes(sample.steadyRssBytes)

process.stdout.write(`${JSON.stringify(sample)}\n`)
