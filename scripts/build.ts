#!/usr/bin/env bun
import { $ } from 'bun'

const OUTFILE = 'dist/langonrock'

await $`bun build --compile src/cli.ts --outfile ${OUTFILE}`

/**
 * Bun 1.3.12 writes a truncated LC_CODE_SIGNATURE on macOS arm64, and the
 * kernel SIGKILLs the process before any code runs. Removing the broken
 * signature and re-signing ad-hoc is the only workaround that sticks.
 * See https://github.com/oven-sh/bun/issues/29361
 */
if (process.platform === 'darwin') {
  await $`codesign --remove-signature ${OUTFILE}`.nothrow().quiet()
  await $`codesign -s - -f ${OUTFILE}`.quiet()
}
