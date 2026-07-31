#!/usr/bin/env bun
import { parseArgs } from 'node:util'

import { open } from './client/connection.ts'
import { DEFAULT_SUMMARY_WIDTH, compileBundle } from './compile/manifest.ts'
import { estimateTokens } from './compile/tokens.ts'
import { serve } from './server/http.ts'
import { loadTokens } from './server/tokens.ts'
import { openTenant } from './store/reader.ts'
import { watchTenant } from './store/watch.ts'
import { putBundle, putTenantRoot } from './store/writer.ts'

import type { CompileOptions } from './compile/manifest.ts'
import type { Diagnostic } from './okf/types.ts'
import type { ServeOptions } from './server/http.ts'
import type { WatchOptions } from './store/watch.ts'
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
  langonrock query <dsn> <verb> [id...]     talk to any transport by dsn

dsn forms:
  okf:///var/data?tenant=acme               embedded, direct file access
  okf+unix:///tmp/okf.sock?tenant=acme      local daemon
  okf+http://127.0.0.1:7777?token=secret    remote, tenant from token

options:
  --data <dir>        store root directory
  --tenant <id>       tenant id, [a-z0-9_-] up to 64 chars
  --section <name>    return only this section of each concept
  --socket <path>     unix socket for serve (default: <data>/langonrock.sock)
  --host <name>       bind TCP instead of a socket, requires tokens.json
  --port <n>          TCP port (default 7777)
  --watch <dir>       serve only: also keep --tenant in sync with this folder
  --debounce <ms>     coalesce filesystem events (default 200)
  --rescan <ms>       full rescan backstop interval (default 30000)
  --out <file>        write to a file instead of stdout
  --bundle <name>     bundle name recorded in the header (default: dir name)
  --summary-width <n> max characters per summary cell (default: ${DEFAULT_SUMMARY_WIDTH})
  --strict            exit non-zero when any diagnostic is reported
  -h, --help          show this message
`

interface Flags {
  out?: string | undefined
  bundle?: string | undefined
  strict?: boolean | undefined
  'summary-width'?: string | undefined
  data?: string | undefined
  tenant?: string | undefined
  section?: string | undefined
  socket?: string | undefined
  host?: string | undefined
  port?: string | undefined
  watch?: string | undefined
  debounce?: string | undefined
  rescan?: string | undefined
  help?: boolean | undefined
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
    root: required(flags.data, '--data'),
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
    root: required(flags.data, '--data'),
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
    required(flags.data, '--data'),
    required(flags.tenant, '--tenant')
  )
  const manifest = await reader.manifest()

  await emit(manifest, flags.out)
  reportStats(manifest, reader.ids.length)

  return 0
}

const runGet: Command = async (positionals, flags) => {
  const ids = positionals.slice(1)

  if (ids.length === 0) {
    throw new Error('get requires at least one concept id')
  }

  const reader = await openTenant(
    required(flags.data, '--data'),
    required(flags.tenant, '--tenant')
  )
  const found = await reader.get(ids, flags.section)
  const chunks = [...found].map(([id, content]) => `@@ ${id}\n${content}`)

  for (const id of ids) {
    if (!found.has(id)) {
      console.error(`warn: no such concept or section: ${id}`)
    }
  }

  const text = chunks.join('\n')

  await emit(text, flags.out)
  reportStats(text, found.size)

  return found.size === ids.length ? 0 : 1
}

function serveOptions(flags: Flags, root: string): ServeOptions {
  const options: ServeOptions = { root }

  if (flags.host === undefined && flags.port === undefined) {
    options.unix = flags.socket ?? `${root}/langonrock.sock`

    return options
  }

  if (flags.host !== undefined) {
    options.hostname = flags.host
  }

  if (flags.port !== undefined) {
    options.port = Number.parseInt(flags.port, 10)
  }

  return options
}

const runServe: Command = async (_positionals, flags) => {
  const root = required(flags.data, '--data')
  const options = serveOptions(flags, root)

  options.tokens = await loadTokens(root)

  const server = serve(options)
  const where =
    options.unix === undefined
      ? `${server.hostname}:${server.port}`
      : options.unix

  console.error(
    `langonrock serving ${root} on ${where} ` +
      `(${options.tokens.size} token${options.tokens.size === 1 ? '' : 's'})`
  )

  if (flags.watch !== undefined) {
    await watchTenant(watchOptions(flags, flags.watch)).ready
    console.error(`watching ${flags.watch} for tenant ${flags.tenant ?? ''}`)
  }

  await new Promise<never>(() => undefined)

  return 0
}

const runQuery: Command = async (positionals, flags) => {
  const dsn = positionalAt(positionals, 1, 'dsn')
  const verb = positionalAt(positionals, 2, 'verb')
  const connection = open(dsn)

  if (verb === 'snapshot') {
    await emit(`${await connection.snapshot()}\n`, flags.out)

    return 0
  }

  if (verb === 'manifest') {
    const manifest = await connection.manifest()

    await emit(manifest, flags.out)
    reportStats(manifest, manifest.split('\n').length - 3)

    return 0
  }

  const ids = positionals.slice(3)
  const found = await connection.get(ids, flags.section)
  const text = [...found].map(([id, body]) => `@@ ${id}\n${body}`).join('\n')

  await emit(text, flags.out)
  reportStats(text, found.size)

  return found.size === ids.length ? 0 : 1
}

const COMMANDS: Record<string, Command> = {
  compile: runCompile,
  put: runPut,
  sync: runSync,
  watch: runWatch,
  manifest: runManifest,
  get: runGet,
  serve: runServe,
  query: runQuery
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
      socket: { type: 'string' },
      host: { type: 'string' },
      port: { type: 'string' },
      watch: { type: 'string' },
      debounce: { type: 'string' },
      rescan: { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  })

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
