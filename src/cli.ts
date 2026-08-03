#!/usr/bin/env bun
import { parseArgs } from 'node:util'

import pkg from '../package.json'
import { open } from './client/connection.ts'
import { DEFAULT_SUMMARY_WIDTH, compileBundle } from './compile/manifest.ts'
import { estimateTokens } from './compile/tokens.ts'
import { serveMcp } from './mcp/server.ts'
import { createSearchCache } from './search/cache.ts'
import { serve } from './server/http.ts'
import { ensureSource, loadSources } from './server/sources.ts'
import { TOKENS_FILE, addToken, loadTokens } from './server/tokens.ts'
import { resolveDataDir } from './store/datadir.ts'
import { collect, collectAll } from './store/gc.ts'
import { assertTenantId } from './store/paths.ts'
import { openTenant } from './store/reader.ts'
import { renderConcepts } from './store/slice.ts'
import { watchTenant } from './store/watch.ts'
import { putBundle, putTenantRoot } from './store/writer.ts'

import type { CompileOptions } from './compile/manifest.ts'
import type { Diagnostic } from './okf/types.ts'
import type { Connection, GetOptions } from './client/connection.ts'
import type { SearchOptions } from './search/tenant.ts'
import type { ServeOptions, Tls } from './server/http.ts'
import type { GcOptions, GcResult } from './store/gc.ts'
import type { WatchOptions, Watcher } from './store/watch.ts'
import type { PutOptions, PutResult } from './store/writer.ts'

const USAGE = `langonrock - a token-efficient store for OKF knowledge bundles

usage:
  langonrock compile <dir> [options]        compile a bundle to a manifest
  langonrock put <dir> --data D --tenant T  store one directory as one bundle
  langonrock sync <dir> --data D --tenant T store every subdirectory as a bundle
  langonrock watch <dir> --data D --tenant T  keep a tenant in sync with a folder
  langonrock manifest --data D --tenant T   print the stored manifest
  langonrock get <id...> --data D --tenant T  fetch concepts by id
  langonrock serve --data D [--socket P]    run the daemon
  langonrock token --data D --tenant T      mint a token and record its grant
  langonrock query <dsn> manifest|snapshot  read the index by dsn
  langonrock query <dsn> search <words...>  rank concepts by relevance
  langonrock query <dsn> get <id...>        fetch concepts by dsn
  langonrock query <dsn> source             list the source markdown
  langonrock query <dsn> read <bundle> <path>   print one source file
  langonrock query <dsn> write <bundle> <path>  write one, from stdin or --from
  langonrock query <dsn> delete <bundle> <path> remove one source file
  langonrock query <dsn> delete-bundle <bundle> remove a whole bundle
  langonrock query <dsn> sync               recompile and report the snapshot
  langonrock mcp <dsn>                      serve MCP over stdio
  langonrock gc --data D [--tenant T]       collect old and partial snapshots

dsn forms:
  okf:///var/data?tenant=acme               embedded, direct file access
  okf+unix:///tmp/okf.sock?tenant=acme      local daemon
  okf+http://127.0.0.1:7777?token=secret    remote, tenant from token

options:
  --data <dir>        store root (default: $LANGONROCK_DATA, else the
                      platform data directory)
  --tenant <id>       tenant id, [a-z0-9_-] up to 64 chars
  --section <name>    return only this section of each concept
  --offset <n>        get only: start the slice at this character offset
  --limit <n>         get only: return at most this many characters per concept
  --find <text>       get only: return a window around this literal phrase,
                      plus the offset of every case-insensitive occurrence
  --socket <path>     unix socket for serve (default: <data>/langonrock.sock)
  --host <name>       bind TCP instead of a socket, requires tokens.json
  --port <n>          TCP port (default 7777)
  --tls-cert <file>   serve https, required off loopback, needs --tls-key
  --tls-key <file>    private key for --tls-cert
  --write             token only: the token may change source markdown
  --watch <dir>       serve only: also keep --tenant in sync with this folder
  --debounce <ms>     coalesce filesystem events (default 200)
  --rescan <ms>       full rescan backstop interval (default 30000)
  --k <n>             ranked matches to return from search (default 8)
  --from <file>       write only: read the content from a file, not stdin
  --replaces <hash>   write/delete: the hash the change is based on
  --create            write only: the concept must not exist yet
  --force             write/delete: use whatever hash is there right now
  --keep <n>          snapshots to retain per tenant on gc (default 10)
  --grace <ms>        never collect anything newer than this (default 3600000)
  --dry-run           gc only: report what would be removed
  --out <file>        write to a file instead of stdout
  --bundle <name>     bundle name recorded in the header (default: dir name)
  --summary-width <n> max characters per summary cell (default: ${DEFAULT_SUMMARY_WIDTH})
  --strict            exit non-zero when any diagnostic is reported
  -h, --help          show this message
  -v, --version       print the version and exit
`

interface Flags {
  out?: string | undefined
  bundle?: string | undefined
  strict?: boolean | undefined
  'summary-width'?: string | undefined
  data?: string | undefined
  tenant?: string | undefined
  section?: string | undefined
  offset?: string | undefined
  limit?: string | undefined
  find?: string | undefined
  socket?: string | undefined
  host?: string | undefined
  port?: string | undefined
  'tls-cert'?: string | undefined
  'tls-key'?: string | undefined
  write?: boolean | undefined
  watch?: string | undefined
  debounce?: string | undefined
  rescan?: string | undefined
  k?: string | undefined
  from?: string | undefined
  replaces?: string | undefined
  create?: boolean | undefined
  force?: boolean | undefined
  keep?: string | undefined
  grace?: string | undefined
  'dry-run'?: boolean | undefined
  help?: boolean | undefined
  version?: boolean | undefined
}

type Command = (positionals: string[], flags: Flags) => Promise<number>

function report(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    console.error(
      `${diagnostic.level}: ${diagnostic.path}: ${diagnostic.message}`
    )
  }
}

function reportStats(text: string, concepts: number): void {
  const bytes = new TextEncoder().encode(text).byteLength

  console.error(
    `${concepts} concepts, ${bytes} bytes, ~${estimateTokens(text)} tokens`
  )
}

function parseWidth(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_SUMMARY_WIDTH
  }

  const width = Number.parseInt(raw, 10)

  if (!Number.isFinite(width) || width < 1) {
    throw new Error(`--summary-width must be a positive integer, got "${raw}"`)
  }

  return width
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined) {
    throw new Error(`${flag} is required`)
  }

  return value
}

function positionalAt(positionals: string[], index: number, what: string) {
  const value = positionals[index]

  if (value === undefined) {
    throw new Error(`missing ${what}`)
  }

  return value
}

function exitCode(flags: Flags, diagnostics: Diagnostic[]): number {
  return flags.strict === true && diagnostics.length > 0 ? 1 : 0
}

async function emit(text: string, out: string | undefined): Promise<void> {
  await Bun.write(out === undefined ? Bun.stdout : out, text)
}

const runCompile: Command = async (positionals, flags) => {
  const options: CompileOptions = {
    summaryWidth: parseWidth(flags['summary-width'])
  }

  if (flags.bundle !== undefined) {
    options.bundle = flags.bundle
  }

  const dir = positionalAt(positionals, 1, 'directory')
  const result = await compileBundle(dir, options)

  report(result.diagnostics)
  await emit(result.tsv, flags.out)
  reportStats(result.tsv, result.concepts.length)

  return exitCode(flags, result.diagnostics)
}

function putOptions(flags: Flags): PutOptions {
  const options: PutOptions = {
    root: resolveDataDir(flags.data),
    tenant: required(flags.tenant, '--tenant'),
    summaryWidth: parseWidth(flags['summary-width'])
  }

  if (flags.bundle !== undefined) {
    options.bundle = flags.bundle
  }

  return options
}

function reportPut(result: PutResult): void {
  console.error(
    `snapshot ${result.snapshot.slice(0, 12)} ${result.reused ? '(reused)' : '(new)'}, ` +
      `${result.bundles.length} bundle${result.bundles.length === 1 ? '' : 's'} ` +
      `[${result.bundles.join(' ')}], ${result.concepts} concepts, ` +
      `${result.bytes} bytes on disk`
  )
}

const runPut: Command = async (positionals, flags) => {
  const source = positionalAt(positionals, 1, 'directory')
  const result = await putBundle(source, putOptions(flags))

  report(result.diagnostics)
  reportPut(result)

  return exitCode(flags, result.diagnostics)
}

const runSync: Command = async (positionals, flags) => {
  const source = positionalAt(positionals, 1, 'directory')
  const result = await putTenantRoot(source, putOptions(flags))

  report(result.diagnostics)
  reportPut(result)

  return exitCode(flags, result.diagnostics)
}

function parseInterval(raw: string | undefined, flag: string): number {
  const value = Number.parseInt(raw ?? '', 10)

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${flag} must be a non-negative integer, got "${raw}"`)
  }

  return value
}

function watchOptions(flags: Flags, source: string): WatchOptions {
  const options: WatchOptions = {
    source,
    root: resolveDataDir(flags.data),
    tenant: required(flags.tenant, '--tenant'),
    summaryWidth: parseWidth(flags['summary-width']),
    onSync: reportPut,
    onError: error => console.error(`error: ${error.message}`)
  }

  if (flags.debounce !== undefined) {
    options.debounceMs = parseInterval(flags.debounce, '--debounce')
  }

  if (flags.rescan !== undefined) {
    options.rescanMs = parseInterval(flags.rescan, '--rescan')
  }

  return options
}

const runWatch: Command = async (positionals, flags) => {
  const source = positionalAt(positionals, 1, 'directory')
  const watcher = watchTenant(watchOptions(flags, source))

  await watcher.ready
  console.error(`watching ${source} for tenant ${flags.tenant ?? ''}`)
  await new Promise<never>(() => undefined)

  return 0
}

const runManifest: Command = async (_positionals, flags) => {
  const reader = await openTenant(
    resolveDataDir(flags.data),
    required(flags.tenant, '--tenant')
  )
  const manifest = await reader.manifest()

  await emit(manifest, flags.out)
  reportStats(manifest, reader.ids.length)

  return 0
}

function getOptions(flags: Flags): GetOptions {
  const options: GetOptions = {}

  if (flags.section !== undefined) {
    options.section = flags.section
  }

  if (flags.offset !== undefined) {
    options.offset = parseInterval(flags.offset, '--offset')
  }

  if (flags.limit !== undefined) {
    options.limit = parseInterval(flags.limit, '--limit')
  }

  if (flags.find !== undefined) {
    options.find = flags.find
  }

  return options
}

const runGet: Command = async (positionals, flags) => {
  const ids = positionals.slice(1)

  if (ids.length === 0) {
    throw new Error('get requires at least one concept id')
  }

  const reader = await openTenant(
    resolveDataDir(flags.data),
    required(flags.tenant, '--tenant')
  )
  const found = await reader.get(ids, getOptions(flags))

  for (const id of ids) {
    if (!found.has(id)) {
      console.error(`warn: no such concept or section: ${id}`)
    }
  }

  const text = renderConcepts([...found.keys()], found)

  await emit(text, flags.out)
  reportStats(text, found.size)

  return found.size === ids.length ? 0 : 1
}

async function tlsFrom(flags: Flags): Promise<Tls | undefined> {
  const cert = flags['tls-cert']
  const key = flags['tls-key']

  if (cert === undefined && key === undefined) {
    return undefined
  }

  if (cert === undefined || key === undefined) {
    throw new Error('--tls-cert and --tls-key must be given together')
  }

  return {
    cert: await Bun.file(cert).text(),
    key: await Bun.file(key).text()
  }
}

async function serveOptions(flags: Flags, root: string): Promise<ServeOptions> {
  const options: ServeOptions = { root }
  const tls = await tlsFrom(flags)

  if (flags.host === undefined && flags.port === undefined) {
    if (tls !== undefined) {
      throw new Error(
        '--tls-cert needs --host or --port: a unix socket has no tls'
      )
    }

    options.unix = flags.socket ?? `${root}/langonrock.sock`

    return options
  }

  if (flags.host !== undefined) {
    options.hostname = flags.host
  }

  if (flags.port !== undefined) {
    options.port = Number.parseInt(flags.port, 10)
  }

  if (tls !== undefined) {
    options.tls = tls
  }

  return options
}

/**
 * One watcher per writable tenant, kept rather than discarded, so a client that
 * writes through the API can ask for the recompile and be told the new digest.
 * The result arrives through onSync, which is why it is captured here.
 */
interface Writable {
  sync: (tenant: string) => Promise<PutResult>
  ensure: (tenant: string) => Promise<string>
}

async function startWatchers(
  root: string,
  sources: Map<string, string>,
  flags: Flags,
  warm: (tenant: string) => void
): Promise<Writable> {
  const watchers = new Map<string, Watcher>()
  const results = new Map<string, PutResult>()

  const start = async (tenant: string, source: string): Promise<void> => {
    const options = watchOptions({ ...flags, tenant }, source)

    options.onSync = result => {
      results.set(tenant, result)
      reportPut(result)
      warm(tenant)
    }

    const watcher = watchTenant(options)

    await watcher.ready
    watchers.set(tenant, watcher)
    console.error(`watching ${source} for tenant ${tenant}`)
  }

  for (const [tenant, source] of sources) {
    await start(tenant, source)
  }

  return {
    sync: async tenant => {
      const watcher = watchers.get(tenant)

      if (watcher === undefined) {
        throw new Error(`tenant "${tenant}" is not writable`)
      }

      await watcher.sync()

      const result = results.get(tenant)

      if (result === undefined) {
        throw new Error(`sync for "${tenant}" produced no result`)
      }

      return result
    },
    // `sources` is the same map the server holds, so registering a tenant here
    // is what makes it writable there, with no restart and no second copy of
    // the registry to keep in step.
    ensure: async tenant => {
      const dir = await ensureSource(root, tenant)

      sources.set(tenant, dir)

      if (!watchers.has(tenant)) {
        await start(tenant, dir)
      }

      return dir
    }
  }
}

/**
 * Prints the token on stdout and everything else on stderr, so capturing it
 * into a variable gets the secret and nothing around it.
 */
const runToken: Command = async (_positionals, flags) => {
  const root = resolveDataDir(flags.data)
  const tenant = assertTenantId(required(flags.tenant, '--tenant'))
  const write = flags.write === true
  const token = await addToken(root, { tenant, write })

  await Bun.write(Bun.stdout, `${token}\n`)
  console.error(
    `recorded a ${write ? 'read-write' : 'read-only'} grant for ${tenant} in ` +
      `${root}/${TOKENS_FILE}. A running server reads that file only at ` +
      'startup, so restart it before the token works'
  )

  return 0
}

const runServe: Command = async (_positionals, flags) => {
  const root = resolveDataDir(flags.data)
  const options = await serveOptions(flags, root)
  const sources = await loadSources(root)

  options.tokens = await loadTokens(root)
  options.sources = sources

  // Rebuilding right after a sync moves the index build off the query path:
  // the first search after a save finds the index already warm.
  const indexes = createSearchCache(root)

  const warm = (tenant: string): void => {
    void indexes(tenant).catch(() => undefined)
  }

  options.indexes = indexes

  // Started even with nothing configured: a store whose first tenant has not
  // been created yet is exactly the case that needs to be able to create one.
  const writable = await startWatchers(root, sources, flags, warm)

  options.sync = writable.sync
  options.ensure = writable.ensure

  const server = serve(options)
  const where =
    options.unix === undefined
      ? `${server.hostname}:${server.port}`
      : options.unix

  console.error(
    `langonrock serving ${root} on ${where} ` +
      `(${options.tokens.size} token${options.tokens.size === 1 ? '' : 's'}, ` +
      `${sources.size} writable tenant${sources.size === 1 ? '' : 's'})`
  )

  if (flags.watch !== undefined) {
    const tenant = required(flags.tenant, '--tenant')
    const watching = watchOptions(flags, flags.watch)

    watching.onSync = result => {
      reportPut(result)
      warm(tenant)
    }

    await watchTenant(watching).ready
    console.error(`watching ${flags.watch} for tenant ${tenant}`)
  }

  await new Promise<never>(() => undefined)

  return 0
}

function countRows(tsv: string): number {
  return tsv
    .split('\n')
    .filter(
      line => line !== '' && !line.startsWith('#') && !line.startsWith('id\t')
    ).length
}

type QueryVerb = (
  connection: Connection,
  positionals: string[],
  flags: Flags
) => Promise<number>

async function readContent(flags: Flags): Promise<string> {
  return flags.from === undefined
    ? Bun.stdin.text()
    : Bun.file(flags.from).text()
}

/**
 * The server refuses a write that does not say which version it replaces, and
 * the CLI keeps that honest rather than quietly reading the current hash first.
 * `--force` exists for the case where clobbering is the intent, and it is named
 * so that it reads like one.
 */
async function replacedBy(
  connection: Connection,
  bundle: string,
  path: string,
  flags: Flags
): Promise<string | undefined> {
  if (flags.create === true) {
    return undefined
  }

  if (flags.replaces !== undefined) {
    return flags.replaces
  }

  if (flags.force === true) {
    return (await connection.readSource(bundle, path))?.hash
  }

  throw new Error(
    'a write needs --replaces <hash> to update, --create for a new concept, or --force to overwrite whatever is there'
  )
}

const QUERY_VERBS: Record<string, QueryVerb> = {
  snapshot: async (connection, _positionals, flags) => {
    await emit(`${await connection.snapshot()}\n`, flags.out)

    return 0
  },

  manifest: async (connection, _positionals, flags) => {
    const manifest = await connection.manifest(flags.bundle)

    await emit(manifest, flags.out)
    reportStats(manifest, countRows(manifest))

    return 0
  },

  search: async (connection, positionals, flags) => {
    const query = positionals.slice(3).join(' ')

    if (query === '') {
      throw new Error('search requires a query')
    }

    const options: SearchOptions = {}

    if (flags.k !== undefined) {
      options.k = parseWidth(flags.k)
    }

    if (flags.bundle !== undefined) {
      options.bundle = flags.bundle
    }

    const hits = await connection.search(query, options)

    await emit(hits, flags.out)
    reportStats(hits, countRows(hits))

    return 0
  },

  get: async (connection, positionals, flags) => {
    const ids = positionals.slice(3)
    const found = await connection.get(ids, getOptions(flags))
    const text = renderConcepts([...found.keys()], found)

    await emit(text, flags.out)
    reportStats(text, found.size)

    return found.size === ids.length ? 0 : 1
  },

  source: async (connection, _positionals, flags) => {
    const entries = await connection.listSource()
    const text = entries
      .map(
        entry => `${entry.hash}\t${entry.bytes}\t${entry.bundle}/${entry.path}`
      )
      .join('\n')

    await emit(`${text}\n`, flags.out)
    console.error(`${entries.length} files`)

    return 0
  },

  read: async (connection, positionals, flags) => {
    const bundle = positionalAt(positionals, 3, 'bundle')
    const path = positionalAt(positionals, 4, 'path')
    const found = await connection.readSource(bundle, path)

    if (found === undefined) {
      throw new Error(`no such concept ${bundle}/${path}`)
    }

    await emit(found.content, flags.out)
    console.error(found.hash)

    return 0
  },

  write: async (connection, positionals, flags) => {
    const bundle = positionalAt(positionals, 3, 'bundle')
    const path = positionalAt(positionals, 4, 'path')
    const replaces = await replacedBy(connection, bundle, path, flags)
    const hash = await connection.writeSource(
      bundle,
      path,
      await readContent(flags),
      replaces
    )

    console.error(`wrote ${bundle}/${path} ${hash}`)

    return 0
  },

  delete: async (connection, positionals, flags) => {
    const bundle = positionalAt(positionals, 3, 'bundle')
    const path = positionalAt(positionals, 4, 'path')
    const replaces = await replacedBy(connection, bundle, path, flags)

    if (replaces === undefined) {
      throw new Error('delete needs --replaces <hash> or --force')
    }

    await connection.deleteSource(bundle, path, replaces)
    console.error(`deleted ${bundle}/${path}`)

    return 0
  },

  'delete-bundle': async (connection, positionals) => {
    const bundle = positionalAt(positionals, 3, 'bundle')

    await connection.deleteBundle(bundle)
    console.error(`deleted bundle ${bundle}`)

    return 0
  },

  sync: async connection => {
    const result = await connection.sync()

    console.error(
      `snapshot ${result.snapshot.slice(0, 12)}, ` +
        `${result.bundles.length} bundle${result.bundles.length === 1 ? '' : 's'}, ` +
        `${result.concepts} concepts`
    )

    return 0
  }
}

const runQuery: Command = async (positionals, flags) => {
  const dsn = positionalAt(positionals, 1, 'dsn')
  const verb = positionalAt(positionals, 2, 'verb')
  const run = QUERY_VERBS[verb]

  if (run === undefined) {
    throw new Error(
      `unknown verb "${verb}": expected one of ${Object.keys(QUERY_VERBS).sort().join(', ')}`
    )
  }

  return run(open(dsn), positionals, flags)
}

function reportGc(result: GcResult, dryRun: boolean): void {
  const verb = dryRun ? 'would remove' : 'removed'

  console.error(
    `${result.tenant}: ${verb} ${result.removed.length} snapshot${result.removed.length === 1 ? '' : 's'} ` +
      `and ${result.partials.length} partial${result.partials.length === 1 ? '' : 's'}, ` +
      `kept ${result.kept}, freed ${result.bytesFreed} bytes`
  )

  for (const skipped of result.skipped) {
    console.error(`  skipped ${skipped.name}: ${skipped.reason}`)
  }

  for (const name of result.corrupt) {
    console.error(`  corrupt ${name}`)
  }

  if (result.currentCorrupt) {
    console.error(
      `  error: ${result.tenant} points at ${result.current}, which is missing or truncated`
    )
  }
}

const runGc: Command = async (_positionals, flags) => {
  const dryRun = flags['dry-run'] === true
  const options: Omit<GcOptions, 'tenant'> = {
    root: resolveDataDir(flags.data),
    dryRun
  }

  if (flags.keep !== undefined) {
    options.keep = parseInterval(flags.keep, '--keep')
  }

  if (flags.grace !== undefined) {
    options.graceMs = parseInterval(flags.grace, '--grace')
  }

  const results =
    flags.tenant === undefined
      ? await collectAll(options)
      : [await collect({ ...options, tenant: flags.tenant })]

  for (const result of results) {
    reportGc(result, dryRun)
  }

  return results.some(result => result.currentCorrupt) ? 1 : 0
}

const runMcp: Command = async positionals => {
  const dsn = positionalAt(positionals, 1, 'dsn')

  console.error(`langonrock mcp serving ${dsn} over stdio`)
  await serveMcp(dsn)

  return 0
}

const COMMANDS: Record<string, Command> = {
  compile: runCompile,
  put: runPut,
  sync: runSync,
  watch: runWatch,
  manifest: runManifest,
  get: runGet,
  serve: runServe,
  token: runToken,
  query: runQuery,
  mcp: runMcp,
  gc: runGc
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      out: { type: 'string' },
      bundle: { type: 'string' },
      strict: { type: 'boolean' },
      'summary-width': { type: 'string' },
      data: { type: 'string' },
      tenant: { type: 'string' },
      section: { type: 'string' },
      offset: { type: 'string' },
      limit: { type: 'string' },
      find: { type: 'string' },
      socket: { type: 'string' },
      'tls-cert': { type: 'string' },
      'tls-key': { type: 'string' },
      write: { type: 'boolean' },
      host: { type: 'string' },
      port: { type: 'string' },
      watch: { type: 'string' },
      debounce: { type: 'string' },
      rescan: { type: 'string' },
      k: { type: 'string' },
      from: { type: 'string' },
      replaces: { type: 'string' },
      create: { type: 'boolean' },
      force: { type: 'boolean' },
      keep: { type: 'string' },
      grace: { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' }
    },
    allowPositionals: true
  })

  if (values.version === true) {
    await Bun.write(Bun.stdout, `${pkg.version}\n`)

    return 0
  }

  if (values.help === true || positionals.length === 0) {
    await Bun.write(Bun.stdout, USAGE)

    return values.help === true ? 0 : 1
  }

  const name = positionals[0] ?? ''
  const command = COMMANDS[name]

  if (command === undefined) {
    throw new Error(`unknown command "${name}"`)
  }

  return command(positionals, values)
}

try {
  process.exit(await main())
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause))
  process.exit(1)
}
