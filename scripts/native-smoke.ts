import { $ } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const root = await mkdtemp(`${tmpdir()}/langonrock-native-smoke-`)
const outfile = `${root}/smoke${process.platform === 'win32' ? '.exe' : ''}`

try {
  await $`bun build --compile test/helpers/platform-smoke.ts --outfile ${outfile}`

  if (process.platform === 'darwin') {
    await $`codesign --remove-signature ${outfile}`.nothrow().quiet()
    await $`codesign -s - -f ${outfile}`.quiet()
  }

  const child = Bun.spawn([outfile, root], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit'
  })

  if ((await child.exited) !== 0) {
    throw new Error('compiled native adapter smoke failed')
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
