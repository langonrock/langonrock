import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { open } from '../client/connection.ts'

import type { Connection } from '../client/connection.ts'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export const MANIFEST_URI = 'okf://manifest'

const MANIFEST_DESCRIPTION = `Read the tenant's knowledge manifest: one dense TSV row per concept with its id, bundle, kind, grain, a one-line summary, and outgoing links.

Call this before anything else whenever you need to know what knowledge exists. It is the index: pick ids from it, then fetch those ids with "get". Never guess an id.`

const GET_DESCRIPTION = `Fetch the full text of concepts by id, as listed in the manifest.

Pass every id you need in one call rather than calling repeatedly; the batch costs one round trip regardless of size. Pass "section" to retrieve a single named section instead of the whole document, for example "schema" or "joins". Section names come from the concept's own markdown headings, lowercased with underscores.`

const SNAPSHOT_DESCRIPTION = `Return the current snapshot digest and concept count.

Call this to check whether the knowledge base changed since you last read the manifest. An unchanged digest means the manifest you already have is still current.`

function text(body: string): CallToolResult {
  return { content: [{ type: 'text', text: body }] }
}

function failure(cause: unknown): CallToolResult {
  const message = cause instanceof Error ? cause.message : String(cause)

  return { content: [{ type: 'text', text: message }], isError: true }
}

function renderConcepts(
  requested: string[],
  found: Map<string, string>
): string {
  const chunks = [...found].map(([id, body]) => `@@ ${id}\n${body}`)
  const missing = requested.filter(id => !found.has(id))

  if (missing.length > 0) {
    chunks.push(`@@ missing\n${missing.join(' ')}`)
  }

  return chunks.join('\n')
}

function registerManifest(server: McpServer, connection: Connection): void {
  server.registerTool(
    'manifest',
    { title: 'Read the knowledge manifest', description: MANIFEST_DESCRIPTION },
    async () => {
      try {
        return text(await connection.manifest())
      } catch (cause) {
        return failure(cause)
      }
    }
  )

  server.registerResource(
    'manifest',
    MANIFEST_URI,
    {
      title: 'Knowledge manifest',
      description: MANIFEST_DESCRIPTION,
      mimeType: 'text/tab-separated-values'
    },
    async uri => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/tab-separated-values',
          text: await connection.manifest()
        }
      ]
    })
  )
}

function registerGet(server: McpServer, connection: Connection): void {
  server.registerTool(
    'get',
    {
      title: 'Fetch concepts by id',
      description: GET_DESCRIPTION,
      inputSchema: {
        ids: z
          .array(z.string())
          .min(1)
          .describe('Concept ids taken from the manifest.'),
        section: z
          .string()
          .optional()
          .describe(
            'Optional section name to return instead of the whole concept.'
          )
      }
    },
    async ({ ids, section }) => {
      try {
        return text(renderConcepts(ids, await connection.get(ids, section)))
      } catch (cause) {
        return failure(cause)
      }
    }
  )
}

function registerSnapshot(server: McpServer, connection: Connection): void {
  server.registerTool(
    'snapshot',
    { title: 'Check the current snapshot', description: SNAPSHOT_DESCRIPTION },
    async () => {
      try {
        return text(await connection.snapshot())
      } catch (cause) {
        return failure(cause)
      }
    }
  )
}

/**
 * Three verbs, deliberately. Every tool definition costs tokens in the client's
 * system prompt, and the manifest already answers "what exists", so discovery
 * needs no verb of its own.
 */
export function createMcpServer(connection: Connection): McpServer {
  const server = new McpServer({ name: 'langonrock', version: '0.0.0' })

  registerManifest(server, connection)
  registerGet(server, connection)
  registerSnapshot(server, connection)

  return server
}

/**
 * The stdio transport owns stdout: anything else written there corrupts the
 * JSON-RPC framing. Diagnostics go to stderr only.
 */
export async function serveMcp(dsn: string): Promise<void> {
  const server = createMcpServer(open(dsn))
  const transport = new StdioServerTransport()

  await server.connect(transport)
  await new Promise<void>(resolve => {
    transport.onclose = () => resolve()
  })
}
