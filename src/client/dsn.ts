import { assertTenantId } from '../store/paths.ts'

export type Transport = 'embedded' | 'unix' | 'npipe' | 'http'

export interface Target {
  transport: Transport
  /** Data root for embedded, socket path for unix, pipe path for npipe. */
  path?: string
  /** Base URL for http and for socket transports, which still speak HTTP. */
  origin?: string
  tenant?: string
  token?: string
}

const TRANSPORTS: Record<string, Transport> = {
  'okf:': 'embedded',
  'okf+unix:': 'unix',
  'okf+npipe:': 'npipe',
  'okf+http:': 'http',
  'okf+https:': 'http'
}

const WINDOWS_DRIVE = /^([a-z+]+:)\/*([A-Za-z]:[\\/].*)$/

function optional(value: string | null): string | undefined {
  return value === null || value === '' ? undefined : value
}

/**
 * `new URL()` rejects a backslash path outright and, worse, parses
 * `okf://C:/data` into host "C" without complaining. Both forms are what a
 * Windows user naturally writes, so rewrite them into the file-URL shape
 * before parsing rather than letting one fail loudly and the other silently.
 */
export function normalizeDsn(dsn: string): string {
  const cut = dsn.indexOf('?')
  const head = cut === -1 ? dsn : dsn.slice(0, cut)
  const tail = cut === -1 ? '' : dsn.slice(cut)
  const match = WINDOWS_DRIVE.exec(head)

  if (match === null) {
    return dsn
  }

  return `${match[1]}///${(match[2] ?? '').replaceAll('\\', '/')}${tail}`
}

/** Undoes the file-URL leading slash so `/C:/data` reaches fs as `C:/data`. */
function toFsPath(pathname: string): string {
  const decoded = decodeURIComponent(pathname)

  return /^\/[A-Za-z]:/.test(decoded) ? decoded.slice(1) : decoded
}

function httpTarget(url: URL, token: string | undefined): Target {
  const scheme = url.protocol === 'okf+https:' ? 'https' : 'http'
  const target: Target = {
    transport: 'http',
    origin: `${scheme}://${url.host}`
  }

  if (token !== undefined) {
    target.token = token
  }

  return target
}

/**
 * The scheme picks the transport, so the same call site works embedded during
 * development and remote in production without touching client code.
 */
export function parseDsn(dsn: string): Target {
  let url: URL

  try {
    url = new URL(normalizeDsn(dsn))
  } catch {
    throw new Error(`invalid dsn "${dsn}"`)
  }

  const transport = TRANSPORTS[url.protocol]

  if (transport === undefined) {
    throw new Error(
      `unsupported dsn scheme "${url.protocol}", expected one of ${Object.keys(TRANSPORTS).join(', ')}`
    )
  }

  const tenant = optional(url.searchParams.get('tenant'))
  const token = optional(url.searchParams.get('token'))
  const target =
    transport === 'http'
      ? httpTarget(url, token)
      : {
          transport,
          path: socketPath(transport, url),
          origin: 'http://langonrock'
        }

  if (tenant !== undefined) {
    target.tenant = assertTenantId(tenant)
  }

  if (token !== undefined) {
    target.token = token
  }

  return target
}

function socketPath(transport: Transport, url: URL): string {
  if (transport !== 'npipe') {
    return toFsPath(url.pathname)
  }

  const name = decodeURIComponent(`${url.host}${url.pathname}`)
    .replace(/^\.\//, '')
    .replace(/^pipe\//, '')

  return `\\\\.\\pipe\\${name.replaceAll('/', '\\')}`
}
