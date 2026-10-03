import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { open } from '../src/client/connection.ts'
import { hash } from '../src/db/format.ts'
import { createMcpServer } from '../src/mcp/lazy.ts'
import { serve } from '../src/server/http.ts'
import { putTenantRoot } from '../src/store/writer.ts'

import type { Connection, DatabaseConnection } from '../src/types.ts'

let root: string
let http: ReturnType<typeof serve>
let local: DatabaseConnection
let remote: DatabaseConnection

beforeEach(async () => {
  root = await mkdtemp(`${tmpdir()}/langonrock-mcp-commit-`)
  http = serve({
    root,
    port: 0,
    writable: true,
    tokens: new Map([['secret', { tenant: 'test', write: true }]]),
    sourceDir: () => `${root}/source`,
    sync: tenant => putTenantRoot(`${root}/source`, { root, tenant })
  })
  local = open(`okf://${root}?tenant=test`)
  remote = open(`okf+http://127.0.0.1:${http.port}?token=secret`)
})

afterEach(async () => {
  await local.close()
  await remote.close()
  await http.stop(true)
  await rm(root, { recursive: true, force: true })
})

async function session(connection: Connection) {
  const server = createMcpServer(connection)
  const client = new Client({ name: 'commit-test', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()

  await server.connect(right)
  await client.connect(left)

  return {
    client,
    close: async () => {
      await client.close()
      await server.close()
    }
  }
}

test.each(['embedded', 'http'])(
  '%s MCP uses the exact native commit result without syncing',
  async transport => {
    const connection = transport === 'embedded' ? local : remote
    const sync = mock(() => Promise.reject(new Error('must not sync')))
    const fallback = mock(() =>
      Promise.reject(new Error('must not write twice'))
    )
    let committed = ''
    const mcp = await session({
      ...connection,
      sync,
      writeSource: fallback,
      deleteSource: fallback,
      transact: async request => {
        const result = await connection.transact(request)

        committed = result.snapshot

        if (request.changes[0]?.operation === 'write') {
          await local.writeSource('docs', 'later.md', '# Another writer')
        }

        return result
      }
    } as DatabaseConnection)

    try {
      const result = await mcp.client.callTool({
        name: 'write',
        arguments: { bundle: 'docs', path: 'a.md', content: '# Committed' }
      })

      expect(result.isError).not.toBe(true)
      expect(JSON.stringify(result)).toContain(
        `snapshot ${committed}, 1 concepts`
      )
      expect(await local.snapshot()).not.toBe(committed)
      const refused = await mcp.client.callTool({
        name: 'write',
        arguments: { bundle: 'docs', path: 'a.md', content: '# Refused' }
      })

      expect(refused.isError).toBe(true)
      expect((await local.readSource('docs', 'a.md'))?.content).toBe(
        '# Committed'
      )
      const deleted = await mcp.client.callTool({
        name: 'delete',
        arguments: {
          bundle: 'docs',
          path: 'a.md',
          replaces: hash('# Committed')
        }
      })

      expect(deleted.isError).not.toBe(true)
      expect(await local.readSource('docs', 'a.md')).toBeUndefined()
      expect(sync).not.toHaveBeenCalled()
      expect(fallback).not.toHaveBeenCalled()
    } finally {
      await mcp.close()
    }
  }
)

test.each(['embedded', 'http'])(
  '%s MCP still synchronizes legacy source writes',
  async transport => {
    await Bun.write(`${root}/source/docs/original.md`, '# Original')
    await Bun.write(
      `${root}/sources.json`,
      JSON.stringify({ test: `${root}/source` })
    )
    await putTenantRoot(`${root}/source`, { root, tenant: 'test' })
    const connection = transport === 'embedded' ? local : remote
    const sync = mock(() => connection.sync())
    const mcp = await session({ ...connection, sync })

    try {
      const result = await mcp.client.callTool({
        name: 'write',
        arguments: { bundle: 'docs', path: 'a.md', content: '# Legacy write' }
      })

      expect(result.isError).not.toBe(true)
      expect((await local.get(['a'])).get('a')?.text).toBe('# Legacy write')
      const deleted = await mcp.client.callTool({
        name: 'delete',
        arguments: {
          bundle: 'docs',
          path: 'a.md',
          replaces: hash('# Legacy write')
        }
      })

      expect(deleted.isError).not.toBe(true)
      expect(await local.readSource('docs', 'a.md')).toBeUndefined()
      expect(sync).toHaveBeenCalledTimes(2)
      expect(await Bun.file(`${root}/tenants/test/HEAD`).exists()).toBe(false)
    } finally {
      await mcp.close()
    }
  }
)
