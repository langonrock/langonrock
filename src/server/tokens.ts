export const TOKENS_FILE = 'tokens.json'

function assertTokenMap(parsed: unknown, path: string): Record<string, string> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must be a JSON object of {"token": "tenant"}`)
  }

  for (const [token, tenant] of Object.entries(parsed)) {
    if (typeof tenant !== 'string' || token === '') {
      throw new Error(`${path} has a non-string tenant for a token`)
    }
  }

  return parsed as Record<string, string>
}

/**
 * Absent tokens is a valid configuration. It restricts the server to a unix
 * socket, where file permissions already decide who may connect.
 */
export async function loadTokens(root: string): Promise<Map<string, string>> {
  const path = `${root}/${TOKENS_FILE}`
  const file = Bun.file(path)

  if (!(await file.exists())) {
    return new Map()
  }

  return new Map(Object.entries(assertTokenMap(await file.json(), path)))
}
