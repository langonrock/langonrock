import { writeAtomic } from '../store/atomic.ts'

export const TOKENS_FILE = 'tokens.json'

/** Nobody but the owner reads a file of bearer tokens. */
const TOKENS_MODE = 0o600

const TOKEN_BYTES = 32

export interface Grant {
  tenant: string
  write: boolean
}

function toGrant(value: unknown, path: string): Grant {
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

    grants.set(token, toGrant(value, path))
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

/**
 * A token is the whole password, so it is worth more entropy than anyone types
 * by hand. 32 random bytes leave nothing to guess, and hex keeps it safe to
 * paste into a connection string without escaping.
 */
export function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

/** The shape `loadTokens` reads back, keeping a read-only grant a bare string. */
function toJson(grants: Map<string, Grant>): string {
  const record: Record<string, string | Grant> = {}

  for (const [token, grant] of grants) {
    record[token] = grant.write ? grant : grant.tenant
  }

  return `${JSON.stringify(record, undefined, 2)}\n`
}

/**
 * Mints a token, records its grant and returns it. The caller never sees it
 * again, because the file is the only copy and nothing here logs it.
 */
export async function addToken(root: string, grant: Grant): Promise<string> {
  const token = generateToken()
  const grants = await loadTokens(root)

  grants.set(token, grant)
  await writeAtomic(
    `${root}/${TOKENS_FILE}`,
    new TextEncoder().encode(toJson(grants)),
    TOKENS_MODE
  )

  return token
}
