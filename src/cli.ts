#!/usr/bin/env bun
import { parseArgs } from 'node:util'

import { DEFAULT_SUMMARY_WIDTH, compileBundle } from './compile/manifest.ts'
import { estimateTokens } from './compile/tokens.ts'

import type { CompileOptions } from './compile/manifest.ts'
import type { Diagnostic } from './okf/types.ts'

const USAGE = `langonrock - compile an OKF bundle into a dense manifest

usage:
  langonrock compile <dir> [options]

options:
  --out <file>        write the manifest to a file instead of stdout
  --bundle <name>     bundle name recorded in the header (default: dir name)
  --summary-width <n> max characters per summary cell (default: ${DEFAULT_SUMMARY_WIDTH})
  --strict            exit non-zero when any diagnostic is reported
  -h, --help          show this message
`

function report(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    console.error(
      `${diagnostic.level}: ${diagnostic.path}: ${diagnostic.message}`
    )
  }
}

function reportStats(tsv: string, concepts: number): void {
  const bytes = new TextEncoder().encode(tsv).byteLength

  console.error(
    `${concepts} concepts, ${bytes} bytes, ~${estimateTokens(tsv)} tokens`
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

interface CompileFlags {
  out?: string | undefined
  bundle?: string | undefined
  strict?: boolean | undefined
  'summary-width'?: string | undefined
}

async function runCompile(dir: string, flags: CompileFlags): Promise<number> {
  const options: CompileOptions = {
    summaryWidth: parseWidth(flags['summary-width'])
  }

  if (flags.bundle !== undefined) {
    options.bundle = flags.bundle
  }

  const result = await compileBundle(dir, options)

  report(result.diagnostics)

  if (flags.out === undefined) {
    await Bun.write(Bun.stdout, result.tsv)
  } else {
    await Bun.write(flags.out, result.tsv)
  }

  reportStats(result.tsv, result.concepts.length)

  return flags.strict === true && result.diagnostics.length > 0 ? 1 : 0
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      out: { type: 'string' },
      bundle: { type: 'string' },
      strict: { type: 'boolean' },
      'summary-width': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  })

  if (values.help === true || positionals.length === 0) {
    await Bun.write(Bun.stdout, USAGE)

    return values.help === true ? 0 : 1
  }

  const [command, dir] = positionals

  if (command !== 'compile') {
    throw new Error(`unknown command "${command}"`)
  }

  if (dir === undefined) {
    throw new Error('compile requires a directory')
  }

  return runCompile(dir, values)
}

try {
  process.exit(await main())
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause))
  process.exit(1)
}
