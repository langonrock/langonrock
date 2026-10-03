import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dir, '..')
const root = await mkdtemp(`${tmpdir()}/langonrock-source-package-`)
const tarball = `${root}/package.tgz`

async function command(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ])

  if (code !== 0) {
    throw new Error(
      `source package command failed: ${args.join(' ')}\n${error}`
    )
  }

  return output
}

try {
  await command(
    [process.execPath, 'pm', 'pack', '--ignore-scripts', '--filename', tarball],
    repo
  )
  const files = (await command(['tar', '-tzf', tarball], root)).split('\n')
  const required = [
    'native/store_platform.c',
    'native/api.h',
    'native/posix.h',
    'native/windows.h',
    'scripts/build-native.ts',
    'src/client/client.ts'
  ]

  if (
    files.some(file => /\.(node|py|pyc)$/.test(file)) ||
    required.some(file => !files.includes(`package/${file}`))
  ) {
    throw new Error(
      'package contains a host binary/forbidden file or lacks build sources'
    )
  }

  await Bun.write(
    `${root}/package.json`,
    JSON.stringify({
      private: true,
      dependencies: { langonrock: './package.tgz' }
    })
  )
  await command([process.execPath, 'install'], root)

  if (
    await Bun.file(
      `${root}/node_modules/langonrock/native/bin/store-platform.node`
    ).exists()
  ) {
    throw new Error(
      'installing the remote client unexpectedly installed a native addon'
    )
  }

  await command(
    [process.execPath, 'node_modules/langonrock/scripts/build-native.ts'],
    root
  )
  const dsn = JSON.stringify(`okf://${root}/data?tenant=source-package`)

  await Bun.write(
    `${root}/smoke.ts`,
    `
import { open } from 'langonrock'
const connection = open(${dsn})
await connection.transact({ changes: [{ operation: 'write', bundle: 'docs',
  path: 'a.md', content: '---\\ntype: concept\\n---\\n# Installed package' }] })
await connection.close()
const reopened = open(${dsn})
if (!(await reopened.manifest()).includes('a\\tdocs')) throw new Error('source package reopen failed')
await reopened.close()
`
  )
  await command([process.execPath, 'smoke.ts'], root)
  process.stdout.write(
    'source package install, native build, and persistence smoke passed\n'
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
