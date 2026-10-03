import { CALLS, EDITS, QUERIES } from './protocol.ts'

import type { Phase, Sample } from './protocol.ts'

export const PHASES: Phase[] = ['import', 'open', 'reads', 'edits', 'tenants']

const TIMINGS: Record<Phase, Record<string, number>> = {
  import: { import: 1 },
  open: { open: 1 },
  reads: {
    firstSearch: 1,
    search: CALLS,
    get: CALLS,
    section: CALLS,
    slice: CALLS,
    find: CALLS,
    manifest: CALLS
  },
  edits: { editToSearch: EDITS },
  tenants: {}
}

function requireChecks(sample: Sample, protocol: number): void {
  const keys =
    sample.phase === 'reads'
      ? [
          'manifest',
          'manifestChars',
          'get',
          'section',
          'slice',
          'find',
          'bundleManifest',
          ...QUERIES.map((_, index) => `search${index}`)
        ]
      : []

  if (protocol >= 2 && sample.phase === 'reads') {
    keys.push('bundleManifests', 'hitRate', 'mrr')
  }

  if (keys.some(key => sample.checks[key] === undefined)) {
    throw new Error(`missing correctness check for ${sample.phase}`)
  }

  if (
    (sample.phase === 'edits' && sample.checks['visibleEdits'] !== EDITS) ||
    (sample.phase === 'tenants' && sample.checks['heldTenants'] !== 5)
  ) {
    throw new Error(`incomplete workload for ${sample.phase}`)
  }
}

function validMemory(sample: Sample): boolean {
  return (
    Number.isFinite(sample.peakRssBytes) &&
    sample.peakRssBytes > 0 &&
    Number.isFinite(sample.steadyRssBytes) &&
    sample.steadyRssBytes > 0
  )
}

function validateTimings(sample: Sample, protocol: number): void {
  const required = {
    ...TIMINGS[sample.phase],
    ...(protocol >= 2 ? { processStartup: 1 } : {})
  }

  if (
    Object.keys(sample.timings).sort().join(',') !==
    Object.keys(required).sort().join(',')
  ) {
    throw new Error(`missing or unexpected timing for ${sample.phase}`)
  }

  for (const [key, count] of Object.entries(required)) {
    const values = sample.timings[key]

    if (
      values?.length !== count ||
      values.some(value => !Number.isFinite(value) || value <= 0)
    ) {
      throw new Error(`invalid timing samples for ${sample.phase}.${key}`)
    }
  }
}

export function validateSamples(samples: Sample[], protocol = 1): void {
  if (
    samples.length !== PHASES.length ||
    new Set(samples.map(sample => sample.phase)).size !== PHASES.length
  ) {
    throw new Error('benchmark needs every phase exactly once')
  }

  for (const sample of samples) {
    if (!PHASES.includes(sample.phase) || !validMemory(sample)) {
      throw new Error('invalid benchmark phase or memory measurement')
    }

    validateTimings(sample, protocol)
    requireChecks(sample, protocol)
  }
}
