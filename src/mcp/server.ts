import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { open } from '../client/connection.ts'
import { adviceFor } from '../search/advice.ts'
import { renderConcepts } from '../store/slice.ts'

import type { Connection } from '../client/connection.ts'
import type { SearchOptions } from '../search/tenant.ts'
import type { GetOptions, SyncResult } from '../types.ts'
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

A status cell other than "-" means the concept is not current, for example "deprecated", "draft", or "stale" for one past its stale_after date; prefer a current concept and say so if you use one that is not.

Pass "bundle" to read one bundle instead of the whole tenant. On a large tenant the whole manifest can be too big to be worth reading, so narrow with "bundle" when you know the domain, or use "search" when you do not.`

const GET_DESCRIPTION = `Fetch the text of concepts by id, as listed in the manifest.

Pass every id you need in one call rather than calling repeatedly; the batch costs one round trip regardless of size. Pass "section" to retrieve a single named section instead of the whole document, for example "schema" or "joins". Section names come from the concept's own markdown headings, lowercased with underscores.

Each concept returns at most "limit" characters (default ${GET_LIMIT}); a partial slice is framed as "@@ id [start..end of total]", and "offset" continues from where it stopped.

When the question is where the text says something, pass "find" with a literal phrase instead of reading the document: the response is a small window around the first case-insensitive occurrence plus every match offset.`

const SEARCH_DESCRIPTION = `Rank concepts by relevance to a query and return their manifest rows, not their bodies.

Reach for this instead of reading the whole manifest when the tenant is large, or when you do not already know which concept holds the answer. The result is the same TSV shape as "manifest" plus a trailing "pos" column: the character offset where your query's words cluster densest in that concept, "-" when they only match its manifest row. To read the passage instead of the document, call "get" with that id and {offset: pos, limit: 2000}. Results also include concepts one link away from the top matches, which is usually where the join partner, parent dataset, or metric definition lives.

Pass "bundle" to rank only within one bundle.`

const WRITE_DESCRIPTION = `Create or replace one concept's Markdown source, then recompile so the change is immediately visible to "manifest", "search" and "get".

Pass the whole document in "content", not a patch: this replaces the file. Write OKF frontmatter with at least a "type" so the concept compiles as a concept rather than as plain Markdown.

Naming a "bundle" that does not exist creates it, and writing to a tenant that has no knowledge yet starts it from nothing, so persisting a first note needs no setup.

Replacing an existing concept needs "replaces", the hash of the version you are replacing. You are not expected to know it: write without it, and the refusal tells you the current hash to retry with. Omit it when creating, where its absence is what asserts the concept is new.

Ids are derived from paths, so adding a file can rename a concept nobody edited; re-read the manifest after writing rather than reusing ids you saw before.`

const DELETE_DESCRIPTION = `Remove one concept and recompile, so it leaves "manifest", "search" and "get" immediately.

Needs "replaces", the hash of the version being removed. Call without it and the refusal names the hash to retry with, the same way "write" does.

Removing the last concept of a bundle removes the bundle.`

const SNAPSHOT_DESCRIPTION = `Return the current snapshot digest and concept count.

Call this to check whether the knowledge base changed since you last read the manifest. An unchanged digest means the manifest you already have is still current.`

function text(body: string): CallToolResult {
  return { content: [{ type: 'text', text: body }] }
}

function failure(cause: unknown): CallToolResult {
  const message = cause instanceof Error ? cause.message : String(cause)

  return { content: [{ type: 'text', text: message }], isError: true }
}

function registerManifest(
  server: McpServer,
  connection: Connection,
  advice?: string
): void {
  const description =
    advice === undefined
      ? MANIFEST_DESCRIPTION
      : `${MANIFEST_DESCRIPTION}\n\n${advice}`

  server.registerTool(
    'manifest',
    {
      title: 'Read the knowledge manifest',
      description,
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
      description,
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

/**
 * A model has no hash to offer, and asking it to fetch one first would cost a
 * round trip on every write. So the refusal carries the hash the retry needs,
 * which turns a lost update into one extra call the first time a concept is
 * replaced, and none at all when it is created.
 *
 * The lookup runs on any failure rather than on a recognised conflict: the
 * embedded path throws its own message and the remote path throws a 412, and
 * matching either string would break the moment one of them was reworded.
 */
async function withCurrentHash(
  connection: Connection,
  bundle: string,
  path: string,
  cause: unknown
): Promise<string> {
  const message = cause instanceof Error ? cause.message : String(cause)
  const current = await connection
    .readSource(bundle, path)
    .catch(() => undefined)

  return current === undefined
    ? message
    : `${message}\nretry with replaces: "${current.hash}"`
}

/**
 * Only the diagnostics for the file just written. A tenant's other warnings are
 * real but they are not this caller's to act on, and on a large tenant they
 * would bury the one line that is.
 */
function wroteReport(
  path: string,
  hash: string,
  result: SyncResult,
  bundle: string
): string {
  const mine = result.diagnostics
    .filter(diagnostic => diagnostic.path === path)
    .map(diagnostic => `${diagnostic.level} ${path}: ${diagnostic.message}`)

  return [
    `wrote ${bundle}/${path} (hash ${hash}), snapshot ${result.snapshot}, ${result.concepts} concepts`,
    ...mine
  ].join('\n')
}

function registerWrite(server: McpServer, connection: Connection): void {
  server.registerTool(
    'write',
    {
      title: 'Create or replace a concept',
      description: WRITE_DESCRIPTION,
      inputSchema: {
        bundle: z
          .string()
          .describe(
            'Bundle to write into, from the bundle column. A new name creates it.'
          ),
        path: z
          .string()
          .describe(
            'Path within the bundle, ending in .md, for example "tables/orders.md".'
          ),
        content: z
          .string()
          .describe("The concept's entire Markdown, frontmatter included."),
        replaces: z
          .string()
          .optional()
          .describe(
            'Hash of the version being replaced. Omit to create; a refusal names the hash to use.'
          )
      }
    },
    async ({ bundle, path, content, replaces }) => {
      try {
        const hash = await connection.writeSource(
          bundle,
          path,
          content,
          replaces
        )

        return text(wroteReport(path, hash, await connection.sync(), bundle))
      } catch (cause) {
        return failure(
          new Error(await withCurrentHash(connection, bundle, path, cause))
        )
      }
    }
  )
}

/**
 * Deleting has no create case, so the hash is required rather than optional and
 * the recovery is the only way to obtain one. Checking for the concept first is
 * what keeps the two refusals apart: a caller who omitted the hash is told the
 * hash, and one aiming at nothing is told there is nothing there.
 */
function registerDelete(server: McpServer, connection: Connection): void {
  server.registerTool(
    'delete',
    {
      title: 'Delete a concept',
      description: DELETE_DESCRIPTION,
      inputSchema: {
        bundle: z.string().describe('Bundle the concept sits in.'),
        path: z
          .string()
          .describe('Path within the bundle, for example "tables/orders.md".'),
        replaces: z
          .string()
          .optional()
          .describe(
            'Hash of the version being removed. A refusal names the hash to use.'
          )
      }
    },
    async ({ bundle, path, replaces }) => {
      try {
        if (replaces === undefined) {
          throw new Error(
            (await connection.readSource(bundle, path)) === undefined
              ? 'concept does not exist'
              : 'deleting needs the hash of the version being removed'
          )
        }

        await connection.deleteSource(bundle, path, replaces)

        const result = await connection.sync()

        return text(
          `deleted ${bundle}/${path}, snapshot ${result.snapshot}, ${result.concepts} concepts`
        )
      } catch (cause) {
        return failure(
          new Error(await withCurrentHash(connection, bundle, path, cause))
        )
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
 * Six verbs, and no more. Every tool definition costs tokens in the client's
 * system prompt, so each one has to earn its place: manifest and search both
 * narrow, get fetches, snapshot invalidates, write persists, delete retracts.
 */
export function createMcpServer(
  connection: Connection,
  advice?: string
): McpServer {
  const server = new McpServer({ name: 'langonrock', version: '0.0.0' })

  registerManifest(server, connection, advice)
  registerSearch(server, connection)
  registerGet(server, connection)
  registerSnapshot(server, connection)
  registerWrite(server, connection)
  registerDelete(server, connection)

  return server
}

/**
 * The stdio transport owns stdout: anything else written there corrupts the
 * JSON-RPC framing. Diagnostics go to stderr only.
 *
 * The advice is computed once, from the snapshot current at startup, and a
 * client reads tool descriptions once per session: a tenant that changes
 * shape underneath a running server keeps the old advice until the next
 * session. It is a hint about corpus shape, and shape moves slowly.
 */
export async function serveMcp(dsn: string): Promise<void> {
  const connection = open(dsn)
  const advice = await connection
    .manifest()
    .then(adviceFor)
    .catch(() => undefined)
  const server = createMcpServer(connection, advice)
  const transport = new StdioServerTransport()

  await server.connect(transport)
  await new Promise<void>(resolve => {
    transport.onclose = () => resolve()
  })
}
