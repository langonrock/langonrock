const MD_EXTENSION = /\.md$/i

export function stripExtension(path: string): string {
  return path.replace(MD_EXTENSION, '')
}

function candidateAt(path: string, tier: number): string {
  const noExt = stripExtension(path)
  const segments = noExt.split('/')
  const base = segments[segments.length - 1] ?? noExt

  if (tier === 0) {
    return base
  }

  if (tier === 1 && segments.length > 1) {
    return `${segments[segments.length - 2]}/${base}`
  }

  return tier === 1 ? base : noExt
}

function countAt(paths: string[], tier: number): Map<string, number> {
  const counts = new Map<string, number>()

  for (const path of paths) {
    const candidate = candidateAt(path, tier)

    counts.set(candidate, (counts.get(candidate) ?? 0) + 1)
  }

  return counts
}

function pickId(path: string, tiers: Map<string, number>[]): string {
  for (let tier = 0; tier < tiers.length; tier++) {
    const candidate = candidateAt(path, tier)

    if (tiers[tier]?.get(candidate) === 1) {
      return candidate
    }
  }

  return candidateAt(path, tiers.length)
}

function assertUnique(ids: Map<string, string>): void {
  const seen = new Map<string, string>()

  for (const [path, id] of ids) {
    const previous = seen.get(id)

    if (previous !== undefined) {
      throw new Error(`ambiguous concept id "${id}": ${previous} and ${path}`)
    }

    seen.set(id, path)
  }
}

/**
 * Shortest unambiguous id wins: bare basename, then parent/basename, then the
 * full relative path. Short ids are worth the effort because the manifest pays
 * for every id on every read.
 */
export function deriveIds(paths: string[]): Map<string, string> {
  const tiers = [countAt(paths, 0), countAt(paths, 1)]
  const ids = new Map<string, string>()

  for (const path of paths) {
    ids.set(path, pickId(path, tiers))
  }

  assertUnique(ids)

  return ids
}
