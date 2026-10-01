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

// ESM bytecode keeps the CLI's top-level await and skips parsing at startup.
const compile = ['--compile', '--bytecode', '--format=esm']

if (target === undefined) {
  await $`bun build ${compile} src/cli.ts --outfile ${outfile}`
} else {
  await $`bun build ${compile} --target=${target} src/cli.ts --outfile ${outfile}`
}
