export const TOKENS_FILE = 'tokens.json'

export interface Grant {
  tenant: string
  write: boolean
}

function toGrant(value: unknown, token: string, path: string): Grant {
  if (typeof value === 'string') {
    return { tenant: value, write: false }
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const scope = value as { tenant?: unknown; write?: unknown }

    if (typeof scope.tenant === 'string') {
      return { tenant: scope.tenant, write: scope.write === true }
    }
  }

  throw new Error(
    `${path} has an invalid grant for a token: expected "tenant" or {"tenant": "...", "write": true}`
  )
}

/**
 * A bare string stays what it always meant, a read-only token for that tenant.
 * Writing is opt-in per token and visible in the file, because a token that can
 * rewrite someone's knowledge should not look identical to one that can read
 * it.
 */
function assertTokenMap(parsed: unknown, path: string): Map<string, Grant> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must be a JSON object of {"token": "tenant"}`)
  }

  const grants = new Map<string, Grant>()

  for (const [token, value] of Object.entries(parsed)) {
    if (token === '') {
      throw new Error(`${path} has an empty token`)
    }

    grants.set(token, toGrant(value, token, path))
  }

  return grants
}

/**
 * Absent tokens is a valid configuration. It restricts the server to a unix
 * socket, where file permissions already decide who may connect.
 */
export async function loadTokens(root: string): Promise<Map<string, Grant>> {
  const path = `${root}/${TOKENS_FILE}`
  const file = Bun.file(path)

  if (!(await file.exists())) {
    return new Map()
  }

  return assertTokenMap(await file.json(), path)
}
