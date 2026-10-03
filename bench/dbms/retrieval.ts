import { RELEVANT_TOPICS } from './protocol.ts'

export function reciprocalRank(result: string, query: number): number {
  const direct = Number(/^# hits: (\d+) direct,/m.exec(result)?.[1])

  if (!Number.isSafeInteger(direct) || direct < 0) {
    throw new Error('search result is missing its direct hit count')
  }

  const rows = result
    .split('\n')
    .filter(
      row => row !== '' && !row.startsWith('#') && !row.startsWith('id\t')
    )
  const rank = rows.slice(0, direct).findIndex(row => {
    const id = row.split('\t')[0] ?? ''
    const topic = id.split('/').at(-1)?.split('_')[0] ?? ''

    return RELEVANT_TOPICS[query]?.includes(topic) ?? false
  })

  return rank === -1 ? 0 : 1 / (rank + 1)
}
