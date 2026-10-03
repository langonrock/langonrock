import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { open } from '../../src/client/connection.ts'
import { createMcpServer } from '../../src/mcp/lazy.ts'
import { check } from './types.ts'

export async function schema(root: string, databaseTools: boolean) {
  const connection = open(`okf://${root}?tenant=schemas`)
  const server = createMcpServer(connection, undefined, { databaseTools })
  const client = new Client({ name: 'schema-benchmark', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()

  try {
    await server.connect(right)
    await client.connect(left)
    const tools = await client.listTools()
    const encoded = JSON.stringify(tools.tools)

    check(
      tools.tools.length === (databaseTools ? 9 : 6),
      'unexpected MCP tool count'
    )

    return {
      count: tools.tools.length,
      bytes: Buffer.byteLength(encoded),
      tokenEstimate: Math.ceil(encoded.length / 4)
    }
  } finally {
    await client.close()
    await server.close()
    await connection.close()
  }
}
