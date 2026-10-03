export function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)

  if (
    fraction <= 0 ||
    fraction > 1 ||
    !Number.isFinite(fraction) ||
    sorted.length === 0 ||
    sorted.some(value => !Number.isFinite(value))
  ) {
    throw new Error('metrics require nonempty finite samples')
  }

  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
    ] ?? 0
  )
}

export function peakRssBytes(steadyRssBytes: number): number {
  // Bun 1.4 reports maxRSS in KiB, as Node does; Bun 1.3 used bytes on macOS.
  const peak = process.resourceUsage().maxRSS * 1024

  if (peak < steadyRssBytes * 0.9) {
    throw new Error('peak RSS units need validation on this runtime/platform')
  }

  return peak
}

export async function measure(run: () => Promise<unknown>): Promise<number> {
  const started = Bun.nanoseconds()

  await run()

  return (Bun.nanoseconds() - started) / 1e6
}

function random(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0

    return state / 4294967296
  }
}

export interface Comparison {
  before: number
  after: number
  delta: number
  ratio: number
  interval: [number, number]
  verdict: 'pass' | 'fail' | 'inconclusive'
}

export function compare(
  before: number[],
  after: number[],
  limit: number
): Comparison {
  return compareGrouped(
    before.map(value => [value]),
    after.map(value => [value]),
    limit
  )
}

interface OrderedSample {
  value: number
  pair: number
}

function ordered(groups: number[][]): OrderedSample[] {
  if (
    groups.some(
      group =>
        group.length === 0 ||
        group.some(value => !Number.isFinite(value) || value <= 0)
    )
  ) {
    throw new Error('comparison needs positive finite measurements')
  }

  return groups
    .flatMap((group, pair) => group.map(value => ({ value, pair })))
    .sort((a, b) => a.value - b.value)
}

function weightedPercentile(
  samples: OrderedSample[],
  weights: number[],
  fraction: number
): number {
  const total = samples.reduce(
    (count, sample) => count + (weights[sample.pair] ?? 0),
    0
  )
  const rank = Math.ceil(total * fraction)
  let count = 0

  for (const sample of samples) {
    count += weights[sample.pair] ?? 0

    if (count >= rank) {
      return sample.value
    }
  }

  throw new Error('empty bootstrap sample')
}

export function compareGrouped(
  before: number[][],
  after: number[][],
  limit: number,
  fraction = 0.5
): Comparison {
  if (before.length !== after.length || before.length < 2) {
    throw new Error('comparison needs at least two matched independent pairs')
  }

  if (
    !Number.isFinite(limit) ||
    limit <= 0 ||
    !Number.isFinite(fraction) ||
    fraction <= 0 ||
    fraction > 1
  ) {
    throw new Error('invalid comparison budget or percentile')
  }

  const old = ordered(before)
  const current = ordered(after)
  const next = random(7)
  const bootstrapped = Array.from({ length: 2000 }, () => {
    const weights = new Array<number>(before.length).fill(0)

    for (let sample = 0; sample < before.length; sample++) {
      const pair = Math.floor(next() * before.length)

      weights[pair] = (weights[pair] ?? 0) + 1
    }

    return (
      weightedPercentile(current, weights, fraction) /
      weightedPercentile(old, weights, fraction)
    )
  })
  const interval: [number, number] = [
    percentile(bootstrapped, 0.025),
    percentile(bootstrapped, 0.975)
  ]
  const weights = new Array<number>(before.length).fill(1)
  const baseline = weightedPercentile(old, weights, fraction)
  const candidate = weightedPercentile(current, weights, fraction)

  return {
    before: baseline,
    after: candidate,
    delta: candidate - baseline,
    ratio: candidate / baseline,
    interval,
    verdict:
      interval[1] <= limit
        ? 'pass'
        : interval[0] > limit
          ? 'fail'
          : 'inconclusive'
  }
}
