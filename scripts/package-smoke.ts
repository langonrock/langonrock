import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const binary = resolve(
  Bun.argv[2] ?? `dist/langonrock${process.platform === 'win32' ? '.exe' : ''}`
)
const root = await mkdtemp(`${tmpdir()}/langonrock-package-smoke-`)
const data = `${root}/data`

async function command(args: string[]): Promise<string> {
  const child = Bun.spawn([binary, ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ])

  if (code !== 0) {
    throw new Error(`compiled CLI failed: ${error}`)
  }

  return output
}

async function mcp(): Promise<void> {
  const transport = new StdioClientTransport({
    command: binary,
    args: ['mcp', `okf://${data}?tenant=smoke`, '--database-tools'],
    cwd: root,
    stderr: 'pipe'
  })
  const client = new Client({ name: 'package-smoke', version: '1' })

  try {
    await client.connect(transport)
    const tools = await client.listTools()

    if (tools.tools.length !== 9) {
      throw new Error('compiled MCP did not load the opt-in database tools')
    }

    const result = await client.callTool({
      name: 'transact',
      arguments: {
        changes: [
          {
            operation: 'write',
            bundle: 'docs',
            path: 'mcp.md',
            content: '# Persisted from compiled MCP'
          }
        ]
      }
    })

    if (result.isError === true) {
      throw new Error(
        `compiled MCP transaction failed: ${JSON.stringify(result)}`
      )
    }
  } finally {
    await client.close()
    await transport.close()
  }
}

try {
  await Bun.write(
    `${root}/source/docs/a.md`,
    '---\ntype: concept\n---\n# Native binary\nsearchable smoke marker\n'
  )
  await command(['sync', `${root}/source`, '--data', data, '--tenant', 'smoke'])
  const manifest = await command([
    'manifest',
    '--data',
    data,
    '--tenant',
    'smoke'
  ])

  if (!manifest.includes('a\tdocs')) {
    throw new Error('compiled CLI did not reopen its native database')
  }

  await mcp()
  const source = await command([
    'query',
    `okf://${data}?tenant=smoke`,
    'read',
    'docs',
    'mcp.md'
  ])
  const verified = JSON.parse(
    await command(['verify', '--data', data, '--tenant', 'smoke'])
  ) as { ok: boolean }

  if (source !== '# Persisted from compiled MCP' || !verified.ok) {
    throw new Error('compiled CLI/MCP persistence check failed')
  }

  process.stdout.write('compiled CLI and deferred MCP smoke passed\n')
} finally {
  await rm(root, { recursive: true, force: true })
}
