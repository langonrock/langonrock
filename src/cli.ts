#!/usr/bin/env bun
import { parseArgs } from 'node:util'

import { DEFAULT_SUMMARY_WIDTH, compileBundle } from './compile/manifest.ts'
import { estimateTokens } from './compile/tokens.ts'
import { openTenant } from './store/reader.ts'
import { putBundle } from './store/writer.ts'

import type { CompileOptions } from './compile/manifest.ts'
import type { Diagnostic } from './okf/types.ts'
import type { PutOptions } from './store/writer.ts'

const USAGE = `langonrock - a token-efficient store for OKF knowledge bundles

usage:
  langonrock compile <dir> [options]        compile a bundle to a manifest
  langonrock put <dir> --data D --tenant T  compile and store a snapshot
  langonrock manifest --data D --tenant T   print the stored manifest
  langonrock get <id...> --data D --tenant T  fetch concepts by id

options:
  --data <dir>        store root directory
  --tenant <id>       tenant id, [a-z0-9_-] up to 64 chars
  --section <name>    return only this section of each concept
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

const runPut: Command = async (positionals, flags) => {
  const options: PutOptions = {
    root: required(flags.data, '--data'),
    tenant: required(flags.tenant, '--tenant'),
    summaryWidth: parseWidth(flags['summary-width'])
  }

  if (flags.bundle !== undefined) {
    options.bundle = flags.bundle
  }

  const source = positionalAt(positionals, 1, 'directory')
  const result = await putBundle(source, options)

  report(result.diagnostics)
  console.error(
    `snapshot ${result.snapshot.slice(0, 12)} ${result.reused ? '(reused)' : '(new)'}, ` +
      `${result.concepts} concepts, ${result.bytes} bytes on disk`
  )

  return exitCode(flags, result.diagnostics)
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

const COMMANDS: Record<string, Command> = {
  compile: runCompile,
  put: runPut,
  manifest: runManifest,
  get: runGet
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
