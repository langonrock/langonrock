import { parseDsn } from './dsn.ts'
import { remoteConnection } from './remote.ts'

import type { DatabaseConnection } from '../types.ts'

export { parseDsn } from './dsn.ts'
export { remoteConnection } from './remote.ts'

/**
 * Reading helpers that are arithmetic over strings the server already sent, so
 * they cost this entry point nothing: sizing the window a `pos` offset opens,
 * locating that window in text a client already holds, and reaching the same
 * manifest-or-search conclusion the MCP server states in its tool description.
 */
export { ADVICE_RATIO, adviceFor } from '../search/advice.ts'
export { bestWindowStart } from '../search/window.ts'
export { FIND_WINDOW } from '../store/slice.ts'

export type { Target, Transport } from './dsn.ts'
export type {
  ConceptSlice,
  Connection,
  DatabaseConnection,
  DocumentChange,
  HistoryOptions,
  RestoreRequest,
  RevisionInfo,
  RevisionPage,
  RevisionResult,
  TransactionRequest,
  GetOptions,
  SearchOptions,
  SourceEntry,
  SourceFile,
  SyncResult
} from '../types.ts'

const EMBEDDED_UNSUPPORTED =
  'this client speaks HTTP only, so it cannot open a store directory. ' +
  'Point it at a daemon with okf+unix:// or a server with okf+http://, ' +
  'or import the full "langonrock" package, which requires the Bun runtime.'

const NPIPE_UNSUPPORTED =
  'npipe transport is unavailable: the server has no Windows named pipe ' +
  'support. On Windows run the daemon on loopback TCP and connect with ' +
  'okf+http://127.0.0.1:PORT?token=...'

/**
 * The same `Connection` the full package returns, over the network only and
 * with nothing underneath it but `fetch`. An editor can therefore depend on
 * this from Node, Electron, Tauri, Deno or a browser without pulling the store
 * or requiring Bun, and still develop against a local daemon and deploy against
 * a remote server by changing one string.
 */
export function connect(dsn: string): DatabaseConnection {
  const target = parseDsn(dsn)

  if (target.transport === 'embedded') {
    throw new Error(EMBEDDED_UNSUPPORTED)
  }

  if (target.transport === 'npipe') {
    throw new Error(NPIPE_UNSUPPORTED)
  }

  return remoteConnection(target)
}
