import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const output = `${root}/native/bin/store-platform.node`

await mkdir(`${root}/native/bin`, { recursive: true })

function compiler(): string[] {
  const source = `${root}/native/store_platform.c`

  if (process.platform === 'win32') {
    return [
      'cl',
      '/nologo',
      '/std:c11',
      '/LD',
      '/O2',
      '/W4',
      source,
      `/Fo:${root}/native/bin/`,
      `/Fe:${output}`
    ]
  }

  const flags = [
    'cc',
    '-std=c11',
    '-D_GNU_SOURCE',
    '-O2',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-shared',
    '-fPIC'
  ]

  if (process.platform === 'darwin') {
    flags.push('-undefined', 'dynamic_lookup')
  }

  return [...flags, source, '-o', output]
}

const child = Bun.spawn(compiler(), {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit'
})

if ((await child.exited) !== 0) {
  throw new Error(
    'native platform adapter build failed; a C compiler is required, Python is not used'
  )
}

process.stdout.write(`${output}\n`)
