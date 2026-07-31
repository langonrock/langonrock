export const SOURCES_FILE = 'sources.json'

function assertSourceMap(
  parsed: unknown,
  path: string
): Record<string, string> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must be a JSON object of {"tenant": "directory"}`)
  }

  for (const [tenant, dir] of Object.entries(parsed)) {
    if (typeof dir !== 'string' || dir === '') {
      throw new Error(`${path} has a non-string directory for "${tenant}"`)
    }
  }

  return parsed as Record<string, string>
}

/**
 * Where each tenant's OKF Markdown lives. The store never moves those folders:
 * source is a directory people already keep in git and edit in Obsidian or an
 * editor, so the server is told where it is rather than owning it.
 *
 * Absent is a valid configuration and means no tenant is writable, which is the
 * right default for a store that was read-only until now.
 */
export async function loadSources(root: string): Promise<Map<string, string>> {
  const path = `${root}/${SOURCES_FILE}`
  const file = Bun.file(path)

  if (!(await file.exists())) {
    return new Map()
  }

  return new Map(Object.entries(assertSourceMap(await file.json(), path)))
}
