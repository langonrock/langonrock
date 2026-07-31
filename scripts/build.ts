#!/usr/bin/env bun
import { $ } from 'bun'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    target: { type: 'string' },
    outfile: { type: 'string' }
  }
})

const outfile = values.outfile ?? 'dist/langonrock'
const target = values.target

if (target === undefined) {
  await $`bun build --compile src/cli.ts --outfile ${outfile}`
} else {
  await $`bun build --compile --target=${target} src/cli.ts --outfile ${outfile}`
}

/**
 * Bun 1.3.12 writes a truncated LC_CODE_SIGNATURE for every macOS target, and
 * the kernel SIGKILLs the process before any code runs. It applies to
 * cross-compiled darwin output too, not just a native build, so every darwin
 * artifact has to be re-signed. `codesign` only exists on macOS, which is why
 * the release matrix builds the darwin targets on a macOS runner.
 * See https://github.com/oven-sh/bun/issues/29361
 */
const darwin =
  target === undefined
    ? process.platform === 'darwin'
    : target.includes('darwin')

if (darwin) {
  if (process.platform !== 'darwin') {
    throw new Error(
      `cannot produce a working ${target} binary off macOS: it needs codesign`
    )
  }

  await $`codesign --remove-signature ${outfile}`.nothrow().quiet()
  await $`codesign -s - -f ${outfile}`.quiet()
}
