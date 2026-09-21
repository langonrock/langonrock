import { z } from 'zod'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Connection, DatabaseConnection } from '../types.ts'

export interface McpOptions {
  databaseTools?: boolean
}

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const change = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('write'),
      bundle: z.string(),
      path: z.string(),
      content: z.string(),
      replaces: digest.optional()
    })
    .strict(),
  z
    .object({
      operation: z.literal('delete'),
      bundle: z.string(),
      path: z.string(),
      replaces: digest
    })
    .strict()
])

async function result(action: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await action()) }] }
  } catch (cause) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: cause instanceof Error ? cause.message : String(cause)
        }
      ]
    }
  }
}

function database(connection: Connection): DatabaseConnection {
  const candidate = connection as Partial<DatabaseConnection>

  if (
    typeof candidate.transact !== 'function' ||
    typeof candidate.history !== 'function' ||
    typeof candidate.restore !== 'function'
  ) {
    throw new Error('database tools require a DatabaseConnection')
  }

  return connection as DatabaseConnection
}

export function registerDatabase(
  server: McpServer,
  connection: Connection
): void {
  const db = database(connection)

  server.registerTool(
    'transact',
    {
      title: 'Commit document changes atomically',
      description:
        'Create, replace, or delete up to 1000 source documents in one durable revision. Each replacement or deletion needs its source hash. No changes commit if any precondition fails.',
      inputSchema: {
        changes: z.array(change).min(1).max(1000),
        expectedRevision: digest.optional()
      }
    },
    request =>
      result(() =>
        db.transact({
          changes: request.changes.map(item => {
            if (item.operation === 'delete') {
              return item
            }

            return {
              operation: item.operation,
              bundle: item.bundle,
              path: item.path,
              content: item.content,
              ...(item.replaces === undefined
                ? {}
                : { replaces: item.replaces })
            }
          }),
          ...(request.expectedRevision === undefined
            ? {}
            : { expectedRevision: request.expectedRevision })
        })
      )
  )

  server.registerTool(
    'history',
    {
      title: 'Read retained revisions',
      description:
        'Return a bounded page of committed revisions, newest first. Pass the next cursor as before to continue.',
      inputSchema: {
        before: z.string().max(512).optional(),
        limit: z.number().int().min(1).max(100).optional()
      }
    },
    options =>
      result(() =>
        db.history({
          ...(options.before === undefined ? {} : { before: options.before }),
          ...(options.limit === undefined ? {} : { limit: options.limit })
        })
      )
  )

  server.registerTool(
    'restore',
    {
      title: 'Restore a retained revision',
      description:
        'Create a new revision from a retained revision. expectedRevision must match the current head; restore never rewrites existing history.',
      inputSchema: { revision: digest, expectedRevision: digest }
    },
    request => result(() => db.restore(request))
  )
}
