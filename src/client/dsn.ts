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

function optional(value: string | null): string | undefined {
  return value === null || value === '' ? undefined : value
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
    url = new URL(dsn)
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
    return decodeURIComponent(url.pathname)
  }

  const name = decodeURIComponent(`${url.host}${url.pathname}`)
    .replace(/^\.\//, '')
    .replace(/^pipe\//, '')

  return `\\\\.\\pipe\\${name.replaceAll('/', '\\')}`
}
