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

const platform = process.platform === 'win32' ? 'windows' : process.platform

if (target !== undefined && target !== `bun-${platform}-${process.arch}`) {
  throw new Error(
    `native adapter requires a ${target} runner; cross-compilation is unsupported`
  )
}

await $`bun scripts/build-native.ts`

if (target === undefined) {
  await $`bun build --compile src/cli.ts --outfile ${outfile}`
} else {
  await $`bun build --compile --target=${target} src/cli.ts --outfile ${outfile}`
}

/**
 * Bun 1.3.12 writes a truncated LC_CODE_SIGNATURE for every macOS target, and
 * the kernel SIGKILLs the process before any code runs. Every darwin artifact
 * must be re-signed with `codesign` on its matching macOS runner.
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
