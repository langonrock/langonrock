const MD_EXTENSION = /\.md$/i

function stripExtension(path: string): string {
  return path.replace(MD_EXTENSION, '')
}

function candidates(path: string): [string, string, string] {
  const noExt = stripExtension(path)
  const segments = noExt.split('/')
  const base = segments[segments.length - 1] ?? noExt

  return [
    base,
    segments.length > 1 ? `${segments[segments.length - 2]}/${base}` : base,
    noExt
  ]
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
  const files = paths.map(path => ({ path, names: candidates(path) }))
  const short = new Map<string, number>()
  const qualified = new Map<string, number>()
  const ids = new Map<string, string>()

  for (const { names } of files) {
    short.set(names[0], (short.get(names[0]) ?? 0) + 1)
    qualified.set(names[1], (qualified.get(names[1]) ?? 0) + 1)
  }

  for (const { path, names } of files) {
    const id =
      short.get(names[0]) === 1
        ? names[0]
        : qualified.get(names[1]) === 1
          ? names[1]
          : names[2]

    ids.set(path, id)
  }

  assertUnique(ids)

  return ids
}
