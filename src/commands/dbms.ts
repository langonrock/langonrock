import { open } from '../client/connection.ts'
import { repair } from '../db/repair.ts'
import { verify } from '../db/verify.ts'
import { resolveDataDir } from '../store/datadir.ts'

import type {
  DatabaseConnection,
  HistoryOptions,
  TransactionRequest
} from '../types.ts'
import type { DatabaseTarget } from '../db/types.ts'

export interface DatabaseFlags {
  data?: string | undefined
  tenant?: string | undefined
  from?: string | undefined
  out?: string | undefined
  before?: string | undefined
  limit?: string | undefined
  'expected-revision'?: string | undefined
  'expected-head'?: string | undefined
}

const VERBS = new Set(['transact', 'history', 'restore'])

export const DATABASE_FLAGS = {
  before: { type: 'string' as const },
  'expected-revision': { type: 'string' as const },
  'expected-head': { type: 'string' as const },
  'database-tools': { type: 'boolean' as const }
}

export function databaseVerb(verb: string): boolean {
  return VERBS.has(verb)
}

async function operation(
  connection: DatabaseConnection,
  verb: string,
  args: string[],
  flags: DatabaseFlags
): Promise<unknown> {
  if (verb === 'transact') {
    const content = await (flags.from === undefined
      ? Bun.stdin.text()
      : Bun.file(flags.from).text())

    return connection.transact(JSON.parse(content) as TransactionRequest)
  }

  if (verb === 'history') {
    const options: HistoryOptions = {}

    if (flags.before !== undefined) {
      options.before = flags.before
    }

    if (flags.limit !== undefined) {
      options.limit = Number(flags.limit)
    }

    return connection.history(options)
  }

  if (args[0] === undefined || flags['expected-revision'] === undefined) {
    throw new Error(
      'restore requires a revision and --expected-revision <current revision>'
    )
  }

  return connection.restore({
    revision: args[0],
    expectedRevision: flags['expected-revision']
  })
}

export async function queryDatabase(
  connection: DatabaseConnection,
  verb: string,
  args: string[],
  flags: DatabaseFlags
): Promise<number> {
  const result = await operation(connection, verb, args, flags)

  await Bun.write(flags.out ?? Bun.stdout, `${JSON.stringify(result)}\n`)

  return 0
}

async function maintenance(
  target: DatabaseTarget,
  positionals: string[],
  flags: DatabaseFlags
): Promise<number> {
  const verb = positionals[0]
  const revision = positionals[1]
  const head = flags['expected-head']

  if (verb === 'repair' && (revision === undefined || head === undefined)) {
    throw new Error(
      'repair requires a verified revision and --expected-head <hash or missing> from verify'
    )
  }

  const result =
    verb === 'verify'
      ? await verify(target, revision === undefined ? {} : { revision })
      : await repair(target, {
          revision: revision ?? '',
          expectedHeadHash: head === 'missing' ? null : (head ?? '')
        })

  await Bun.write(flags.out ?? Bun.stdout, `${JSON.stringify(result)}\n`)

  return 'ok' in result && !result.ok ? 1 : 0
}

export async function databaseCommand(
  positionals: string[],
  flags: DatabaseFlags
): Promise<number> {
  if (flags.tenant === undefined) {
    throw new Error('--tenant is required')
  }

  const root = resolveDataDir(flags.data)
  const target = { root, tenant: flags.tenant }
  const verb = positionals[0] ?? ''

  if (verb === 'verify' || verb === 'repair') {
    return maintenance(target, positionals, flags)
  }

  const connection = open(`okf://${root}?tenant=${target.tenant}`)

  try {
    return await queryDatabase(connection, verb, positionals.slice(1), flags)
  } finally {
    await connection.close()
  }
}
