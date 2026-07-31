/**
 * One turn is one API call. Its result appends tokens to the conversation, and
 * every later call re-reads them at the prompt cache rate. A turn that would
 * add nothing new is a turn the agent never spends, so a navigation artifact is
 * fetched once per session. Both read paths are billed through this same model.
 */
export const CACHE_RATE = 0.1

export interface Turn {
  parts: { key: string; tokens: number }[]
}

export interface Session {
  billed: number
  calls: number
}

export function bill(turns: Turn[]): Session {
  const present = new Set<string>()
  let context = 0
  let billed = 0
  let calls = 0

  for (const turn of turns) {
    if (turn.parts.every(part => present.has(part.key))) {
      continue
    }

    calls++
    billed += context * CACHE_RATE

    for (const part of turn.parts) {
      if (present.has(part.key)) {
        continue
      }

      present.add(part.key)
      billed += part.tokens
      context += part.tokens
    }
  }

  return { billed: Math.round(billed), calls }
}

export interface Score {
  hitRate: number
  mrr: number
}

/** Hit rate at k plus mean reciprocal rank, over one ranked list per question. */
export function score(ranked: string[][], wanted: string[]): Score {
  let hits = 0
  let reciprocal = 0

  for (const [index, list] of ranked.entries()) {
    const rank = list.indexOf(wanted[index] ?? '')

    if (rank >= 0) {
      hits++
      reciprocal += 1 / (rank + 1)
    }
  }

  return {
    hitRate: (hits / ranked.length) * 100,
    mrr: reciprocal / ranked.length
  }
}

export async function median(
  runs: number,
  fn: () => Promise<unknown>
): Promise<number> {
  const samples: number[] = []

  for (let index = 0; index < runs; index++) {
    const start = Bun.nanoseconds()

    await fn()
    samples.push((Bun.nanoseconds() - start) / 1e6)
  }

  samples.sort((a, b) => a - b)

  return samples[Math.floor(samples.length / 2)] ?? 0
}

export function memory(): { heap: number; rss: number } {
  Bun.gc(true)

  const usage = process.memoryUsage()

  return { heap: usage.heapUsed / 1024 / 1024, rss: usage.rss / 1024 / 1024 }
}

export function average(values: number[]): number {
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length
  )
}

export function rowIds(tsv: string): string[] {
  return tsv
    .split('\n')
    .filter(
      line => line !== '' && !line.startsWith('#') && !line.startsWith('id\t')
    )
    .map(line => line.split('\t')[0] ?? '')
}
