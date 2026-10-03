import { peer } from './peer.ts'
import { check } from './types.ts'

import type { Request } from './types.ts'
import type { Peer } from './peer.ts'

interface Outcome {
  outcome: 'committed' | 'conflict' | 'pinned'
  revision?: string
  elapsed?: number
  rssBytes: number
  peakRssBytes: number
}

async function ready(child: Peer): Promise<void> {
  check((await child.next<{ ready: boolean }>()).ready, 'worker is not ready')
}

async function group(input: Request, children: Peer[]) {
  await Promise.all(children.map(ready))
  await Promise.all(children.map(child => child.send('sample')))
  const memory = await Promise.all(
    children.map(child =>
      child.next<{ rssBytes: number; peakRssBytes: number }>()
    )
  )
  const coordinatorRssBytes = process.memoryUsage().rss

  await Promise.all(children.map(child => child.send('go')))
  const [writerA, writerB, reader] = children

  check(writerA && writerB && reader, 'missing contention participant')
  const writers = await Promise.all([
    writerA.next<Outcome>(),
    writerB.next<Outcome>()
  ])

  await reader.send('verify')
  const pinned = await reader.next<Outcome>()
  const winner = writers.find(result => result.outcome === 'committed')

  check(
    winner?.revision &&
      writers.filter(result => result.outcome === 'conflict').length === 1,
    'competing writers did not produce exactly one commit and one conflict'
  )
  check(
    pinned.outcome === 'pinned' && pinned.revision !== winner.revision,
    'reader did not remain on its original revision'
  )
  await Promise.all(children.map(child => child.finish()))

  return {
    simultaneousWorkerRssBytes: memory.reduce(
      (sum, item) => sum + item.rssBytes,
      0
    ),
    coordinatorRssBytes,
    barrierMemory: memory,
    writers,
    reader: pinned,
    head: winner.revision,
    source: input.source
  }
}

export async function contention(input: Request) {
  const children = [
    peer({ ...input, role: 'writer', label: 'A' }),
    peer({ ...input, role: 'writer', label: 'B' }),
    peer({ ...input, role: 'reader' })
  ]

  try {
    return await group(input, children)
  } finally {
    await Promise.all(children.map(child => child.kill()))
  }
}

export async function interrupted(input: Request): Promise<void> {
  const child = peer({ ...input, role: 'crash', label: 'killed' })

  try {
    await ready(child)
  } finally {
    await child.kill()
  }
}
