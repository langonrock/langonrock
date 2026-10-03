import { measure } from './metrics.ts'
import { CALLS, EDITS, QUERIES, TENANT, digest, slices } from './protocol.ts'
import { reciprocalRank } from './retrieval.ts'

import type { Backend, Sample } from './protocol.ts'

async function timedCalls(
  run: (index: number) => Promise<unknown>
): Promise<number[]> {
  for (let index = 0; index < 10; index++) {
    await run(index)
  }

  const samples: number[] = []

  for (let index = 0; index < CALLS; index++) {
    samples.push(await measure(() => run(index)))
  }

  return samples
}

export async function reads(backend: Backend, sample: Sample): Promise<void> {
  const started = Bun.nanoseconds()
  const ready = await backend.reader(TENANT)
  const search = await backend.search(ready)

  await search(QUERIES[0] ?? '')
  sample.timings['firstSearch'] = [(Bun.nanoseconds() - started) / 1e6]
  const ids = ready.ids.slice(0, 3)
  const probes = ids.map(id => ready.get([id]))
  const results = await Promise.all(probes)
  const needle = results[0]?.get(ids[0] ?? '')?.text.slice(40, 65) ?? ''

  sample.checks['manifest'] = digest(await ready.manifest())
  sample.checks['manifestChars'] = (await ready.manifest()).length
  sample.checks['get'] = slices(await ready.get(ids))
  sample.checks['section'] = slices(await ready.get(ids, { section: 'schema' }))
  sample.checks['slice'] = slices(
    await ready.get(ids, { offset: 20, limit: 120 })
  )
  sample.checks['find'] = slices(await ready.get(ids, { find: needle }))

  const bundle = (await ready.manifest()).split('\n')[1]?.split(' ')[2]

  sample.checks['bundleManifest'] = digest(await ready.manifest(bundle))
  const bundles =
    (await ready.manifest())
      .split('\n')[1]
      ?.slice('# bundles: '.length)
      .split(' ') ?? []

  sample.checks['bundleManifests'] = digest(
    JSON.stringify(
      await Promise.all(
        bundles.map(async name => [name, await ready.manifest(name)])
      )
    )
  )
  sample.timings['search'] = await timedCalls(index =>
    search(QUERIES[index % QUERIES.length] ?? '')
  )
  sample.timings['get'] = await timedCalls(() => ready.get(ids))
  sample.timings['section'] = await timedCalls(() =>
    ready.get(ids, { section: 'schema' })
  )
  sample.timings['slice'] = await timedCalls(() =>
    ready.get(ids, { offset: 20, limit: 120 })
  )
  sample.timings['find'] = await timedCalls(() =>
    ready.get(ids, { find: needle })
  )
  sample.timings['manifest'] = await timedCalls(() => ready.manifest())

  const ranks: number[] = []

  for (const [index, text] of QUERIES.entries()) {
    const result = await search(text)

    sample.checks[`search${index}`] = digest(result)
    ranks.push(reciprocalRank(result, index))
  }

  sample.checks['hitRate'] =
    ranks.filter(rank => rank > 0).length / ranks.length
  sample.checks['mrr'] =
    ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length

  backend.closeReader?.(ready)
}

export async function edits(backend: Backend, sample: Sample): Promise<void> {
  const original = await backend.original()

  sample.timings['editToSearch'] = []

  try {
    for (let index = 0; index < EDITS; index++) {
      const marker = `benchmarkvisibilitymarker${index}`

      sample.timings['editToSearch'].push(
        await measure(async () => {
          await backend.edit(`${original}\n${marker}\n`)

          const reader = await backend.reader(TENANT)
          const query = await backend.search(reader)
          const found = await query(marker)
          const rows = found
            .split('\n')
            .filter(
              row =>
                row !== '' && !row.startsWith('#') && !row.startsWith('id\t')
            )
          const ids = rows.map(row => row.split('\t')[0] ?? '')
          const bodies = await reader.get(ids)

          if (
            ![...bodies.values()].some(slice => slice.text.includes(marker))
          ) {
            throw new Error('acknowledged edit is not searchable')
          }

          backend.closeReader?.(reader)
        })
      )
    }
  } finally {
    await backend.restoreSource(original)
  }

  sample.checks['visibleEdits'] = EDITS
}

export async function tenants(backend: Backend, sample: Sample): Promise<void> {
  const held = []

  for (let index = 0; index < 5; index++) {
    const tenant = `${TENANT}${index}`

    await backend.put(tenant)

    const reader = await backend.reader(tenant)

    held.push({ reader, search: await backend.search(reader) })
  }

  sample.checks['heldTenants'] = held.length
  sample.steadyRssBytes = process.memoryUsage().rss
}
