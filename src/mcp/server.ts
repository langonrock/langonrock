import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { open } from '../client/connection.ts'
import { renderConcepts } from '../store/slice.ts'

import type { Connection } from '../client/connection.ts'
import type { SearchOptions } from '../search/tenant.ts'
import type { GetOptions } from '../types.ts'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export const MANIFEST_URI = 'okf://manifest'

/**
 * The MCP boundary is where an unbounded read becomes a context blowup, so it
 * is the one layer that caps by default. 15,000 characters is roughly 4,000
 * tokens: every ordinary concept passes through whole, and only a document
 * that genuinely needs paging gets framed as a partial slice. The library and
 * the HTTP API stay uncapped, because their callers are programs, not prompts.
 */
export const GET_LIMIT = 15_000

const MANIFEST_DESCRIPTION = `Read the tenant's knowledge manifest: one dense TSV row per concept with its id, bundle, kind, status, grain, a one-line summary, and outgoing links.

Call this before anything else whenever you need to know what knowledge exists. It is the index: pick ids from it, then fetch those ids with "get". Never guess an id.

A status cell other than "-" means the concept is not current, for example "deprecated" or "draft"; prefer a current concept and say so if you use one that is not.

Pass "bundle" to read one bundle instead of the whole tenant. On a large tenant the whole manifest can be too big to be worth reading, so narrow with "bundle" when you know the domain, or use "search" when you do not.`

const GET_DESCRIPTION = `Fetch the text of concepts by id, as listed in the manifest.

Pass every id you need in one call rather than calling repeatedly; the batch costs one round trip regardless of size. Pass "section" to retrieve a single named section instead of the whole document, for example "schema" or "joins". Section names come from the concept's own markdown headings, lowercased with underscores.

Each concept returns at most "limit" characters (default ${GET_LIMIT}); a partial slice is framed as "@@ id [start..end of total]", and "offset" continues from where it stopped.

When the question is where the text says something, pass "find" with a literal phrase instead of reading the document: the response is a small window around the first case-insensitive occurrence plus every match offset.`

const SEARCH_DESCRIPTION = `Rank concepts by relevance to a query and return their manifest rows, not their bodies.

Reach for this instead of reading the whole manifest when the tenant is large, or when you do not already know which concept holds the answer. The result is the same TSV shape as "manifest", narrowed: pick ids from it and fetch them with "get", passing "find" to "get" when what you want is a passage inside a hit rather than the document. Results also include concepts one link away from the top matches, which is usually where the join partner, parent dataset, or metric definition lives.

Pass "bundle" to rank only within one bundle.`

const SNAPSHOT_DESCRIPTION = `Return the current snapshot digest and concept count.

Call this to check whether the knowledge base changed since you last read the manifest. An unchanged digest means the manifest you already have is still current.`

function text(body: string): CallToolResult {
  return { content: [{ type: 'text', text: body }] }
}

function failure(cause: unknown): CallToolResult {
  const message = cause instanceof Error ? cause.message : String(cause)

  return { content: [{ type: 'text', text: message }], isError: true }
}

function registerManifest(server: McpServer, connection: Connection): void {
  server.registerTool(
    'manifest',
    {
      title: 'Read the knowledge manifest',
      description: MANIFEST_DESCRIPTION,
      inputSchema: {
        bundle: z
          .string()
          .optional()
          .describe(
            'Optional bundle name, from the bundle column, to read only that bundle.'
          )
      }
    },
    async ({ bundle }) => {
      try {
        return text(await connection.manifest(bundle))
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
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Character offset to start from, for continuing a partial slice.'
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            `Maximum characters per concept, default ${GET_LIMIT}. With "find", sizes the window instead.`
          ),
        find: z
          .string()
          .min(1)
          .optional()
          .describe('Literal case-insensitive phrase to locate.')
      }
    },
    async ({ ids, section, offset, limit, find }) => {
      try {
        const options: GetOptions = {}

        if (section !== undefined) {
          options.section = section
        }

        if (offset !== undefined) {
          options.offset = offset
        }

        if (find !== undefined) {
          options.find = find
        }

        const capped = limit ?? (find === undefined ? GET_LIMIT : undefined)

        if (capped !== undefined) {
          options.limit = capped
        }

        return text(renderConcepts(ids, await connection.get(ids, options)))
      } catch (cause) {
        return failure(cause)
      }
    }
  )
}

function registerSearch(server: McpServer, connection: Connection): void {
  server.registerTool(
    'search',
    {
      title: 'Find concepts by relevance',
      description: SEARCH_DESCRIPTION,
      inputSchema: {
        query: z.string().min(1).describe('Words to rank concepts against.'),
        k: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('How many ranked matches to return before link expansion.'),
        bundle: z
          .string()
          .optional()
          .describe('Optional bundle name to rank within.')
      }
    },
    async ({ query, k, bundle }) => {
      try {
        const options: SearchOptions = {}

        if (k !== undefined) {
          options.k = k
        }

        if (bundle !== undefined) {
          options.bundle = bundle
        }

        return text(await connection.search(query, options))
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
 * Four verbs, and no more. Every tool definition costs tokens in the client's
 * system prompt, so each one has to earn its place: manifest and search both
 * narrow, get fetches, snapshot invalidates.
 */
export function createMcpServer(connection: Connection): McpServer {
  const server = new McpServer({ name: 'langonrock', version: '0.0.0' })

  registerManifest(server, connection)
  registerSearch(server, connection)
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
