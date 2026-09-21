import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { readdir, rm, stat } from 'node:fs/promises'

import {
  adviceFor,
  buildTenantIndex,
  createMcpServer,
  estimateTokens,
  open,
  openTenant,
  putTenantRoot,
  readSource,
  searchTenant,
  serve,
  writeSource
} from '../src/index.ts'
import { snapshotsDir } from '../src/store/paths.ts'
import { median, memory } from './billing.ts'
import { PROFILES } from './profiles.ts'

import type { Connection } from '../src/index.ts'
import type { Corpus } from './okf.ts'

const HERE = import.meta.dir
const SOURCE = `${HERE}/.corpus`
const STORE = `${HERE}/.store`
const MUTATE = `${HERE}/.mutate`
const TENANT = 'ops'
const MUTATE_TENANT = 'mut'
const EDITS = 10

async function diskUsage(tenant: string): Promise<{
  snapshots: number
  bytes: number
}> {
  const dir = snapshotsDir(STORE, tenant)
  const names = await readdir(dir)
  const sizes = await Promise.all(
    names.map(async name => (await stat(`${dir}/${name}`)).size)
  )

  return {
    snapshots: names.length,
    bytes: sizes.reduce((sum, size) => sum + size, 0)
  }
}

function sync(): Promise<{ snapshot: string; bytes: number; reused: boolean }> {
  return putTenantRoot(SOURCE, { root: STORE, tenant: TENANT })
}

/**
 * A snapshot is one immutable file per tenant, named by its own hash. Nothing
 * is shared between two snapshots, so the question worth answering is what a
 * one-file edit costs on disk, not what the first write costs.
 */
async function snapshots(corpus: Corpus) {
  const first = await sync()
  const unchangedMs = await median(5, sync)
  const unchanged = await sync()
  const concept = corpus.concepts[0]
  const bundle = concept?.bundle ?? ''
  const path = concept?.path ?? ''
  const original = (await readSource(SOURCE, bundle, path))?.content ?? ''

  let editMs = 0

  for (let index = 0; index < EDITS; index++) {
    await writeSource(SOURCE, bundle, path, `${original}\nEdit ${index}.\n`)

    const started = Bun.nanoseconds()

    await sync()
    editMs += (Bun.nanoseconds() - started) / 1e6
  }

  const after = await diskUsage(TENANT)

  await writeSource(SOURCE, bundle, path, original)

  return {
    snapshotBytes: first.bytes,
    deterministic: unchanged.snapshot === first.snapshot && unchanged.reused,
    unchangedSyncMs: unchangedMs,
    editSyncMs: editMs / EDITS,
    editsMade: EDITS,
    diskSnapshots: after.snapshots,
    diskBytes: after.bytes,
    diskAmplification: after.bytes / first.bytes
  }
}

/**
 * What an embedded invocation pays before it can answer, against what the same
 * question costs against a daemon that already holds the index.
 */
async function coldVersusWarm(probe: string) {
  const coldMs = await median(5, async () => {
    const reader = await openTenant(STORE, TENANT)

    await searchTenant(
      await buildTenantIndex(reader),
      probe,
      { k: 8 },
      reader.get
    )
  })
  const reader = await openTenant(STORE, TENANT)
  const index = await buildTenantIndex(reader)

  return {
    coldMs,
    warmMs: await median(50, () =>
      searchTenant(index, probe, { k: 8 }, reader.get)
    ),
    warmManifestMs: await median(50, () => reader.manifest())
  }
}

/**
 * How many tenants one daemon can hold. Heap deltas around a single build come
 * back negative as often as positive, so this loads tenants one at a time and
 * reports the slope of resident memory, which is stable run to run. The first
 * tenant carries one-time allocation and is reported apart from the rest.
 */
async function perTenant(count: number) {
  const held = []
  const rss = [memory().rss]

  for (let index = 0; index < count; index++) {
    const tenant = `${TENANT}${index}`

    await putTenantRoot(SOURCE, { root: STORE, tenant })

    const reader = await openTenant(STORE, tenant)

    held.push(await buildTenantIndex(reader))
    rss.push(memory().rss)
  }

  const deltas = rss.slice(1).map((value, index) => value - (rss[index] ?? 0))
  const steady = deltas.slice(1)

  return {
    tenants: held.length,
    rssMbFirstTenant: deltas[0] ?? 0,
    rssMbPerTenant: steady.reduce((a, b) => a + b, 0) / steady.length,
    rssMb: rss[rss.length - 1] ?? 0
  }
}

function textOf(result: Record<string, unknown>): string {
  const parts = (result.content ?? []) as { text?: string }[]

  return parts.map(part => part.text ?? '').join('\n')
}

function hashOffered(result: Record<string, unknown>): string {
  return /retry with replaces: "([0-9a-f]+)"/.exec(textOf(result))?.[1] ?? ''
}

/**
 * Counts what a tool call spends underneath itself. A tool call is one turn to
 * the model, but each connection call is a round trip a remote transport bills,
 * so the two numbers move independently and only the second one moves with the
 * implementation.
 */
function counting(connection: Connection): {
  connection: Connection
  trips: () => number
  reset: () => void
} {
  let trips = 0

  const count = async <T>(run: () => Promise<T>): Promise<T> => {
    trips++

    return run()
  }

  return {
    connection: {
      ...connection,
      readSource: (bundle, path) =>
        count(() => connection.readSource(bundle, path)),
      writeSource: (bundle, path, content, replaces) =>
        count(() => connection.writeSource(bundle, path, content, replaces)),
      deleteSource: (bundle, path, replaces) =>
        count(() => connection.deleteSource(bundle, path, replaces)),
      sync: () => count(() => connection.sync())
    },
    trips: () => trips,
    reset: () => {
      trips = 0
    }
  }
}

/**
 * What a model actually pays to change knowledge. It holds no hash, so
 * replacing and deleting are two tool calls each: one refused, one accepted.
 * The tool calls are fixed by the protocol; the round trips underneath them are
 * not, and they are what a remote transport bills.
 */
async function mcpMutationCost() {
  await rm(MUTATE, { recursive: true, force: true })

  const counted = counting(open(`okf://${MUTATE}?tenant=${MUTATE_TENANT}`))
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'bench-mutate', version: '0.0.0' })

  await Promise.all([
    createMcpServer(counted.connection).connect(serverSide),
    client.connect(clientSide)
  ])

  const body = '---\ntype: note\n---\n\nBenchmark concept.\n'
  const write = (path: string, args: Record<string, string> = {}) =>
    client.callTool({
      name: 'write',
      arguments: { bundle: 'inbox', path, content: body, ...args }
    })
  const remove = (path: string, args: Record<string, string> = {}) =>
    client.callTool({
      name: 'delete',
      arguments: { bundle: 'inbox', path, ...args }
    })

  counted.reset()

  const created = await write('one.md')
  const createTrips = counted.trips()

  counted.reset()

  const refusedWrite = await write('one.md', { content: `${body}\nAgain.\n` })
  const replaced = await write('one.md', {
    content: `${body}\nAgain.\n`,
    replaces: hashOffered(refusedWrite)
  })
  const replaceTrips = counted.trips()

  counted.reset()

  const refusedDelete = await remove('one.md')
  const deleted = await remove('one.md', {
    replaces: hashOffered(refusedDelete)
  })
  const deleteTrips = counted.trips()

  const createMs = await median(25, (run: number) => write(`create${run}.md`))
  const replaceMs = await median(25, async (run: number) => {
    const path = `create${run}.md`

    await write(path, {
      content: `${body}\nRun.\n`,
      replaces: hashOffered(await write(path, { content: `${body}\nRun.\n` }))
    })
  })

  await client.close()
  await counted.connection.close()
  await rm(MUTATE, { recursive: true, force: true })

  return {
    createTrips,
    replaceTrips,
    deleteTrips,
    createTokens: estimateTokens(textOf(created)),
    refusalTokens: estimateTokens(textOf(refusedWrite)),
    replaceTokens: estimateTokens(textOf(replaced)),
    deleteTokens: estimateTokens(textOf(deleted)),
    deleteRefusalTokens: estimateTokens(textOf(refusedDelete)),
    createMs,
    replaceMs,
    mutationsRefused: [refusedWrite, refusedDelete].filter(
      result => result.isError === true
    ).length
  }
}

/**
 * The four tool definitions sit in the client's system prompt for the whole
 * session, whether or not the model ever asks about knowledge. That is a fixed
 * tax. The call latency is separate and is what the MCP layer itself adds on
 * top of the connection underneath it.
 */
async function mcpCost(probe: string) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'bench', version: '0.0.0' })
  const direct = open(`okf://${STORE}?tenant=${TENANT}`)
  const advice = adviceFor(await direct.manifest())

  await Promise.all([
    createMcpServer(open(`okf://${STORE}?tenant=${TENANT}`), advice).connect(
      serverSide
    ),
    client.connect(clientSide)
  ])

  const listed = await client.listTools()
  const result = {
    tools: listed.tools.length,
    toolTokens: estimateTokens(JSON.stringify(listed.tools)),
    mcpSearchMs: await median(20, () =>
      client.callTool({ name: 'search', arguments: { query: probe } })
    ),
    mcpManifestMs: await median(20, () =>
      client.callTool({ name: 'manifest', arguments: {} })
    ),
    directSearchMs: await median(20, () => direct.search(probe))
  }

  await client.close()
  await direct.close()

  return result
}

/**
 * A real daemon over a unix socket, which is the deployment the README points
 * at. The embedded numbers above leave out serialisation and IPC, and those are
 * exactly what a daemon adds back.
 */
async function daemon(corpus: Corpus, probe: string) {
  const socket = `/tmp/lr-ops-${process.pid}.sock`
  const server = serve({
    root: STORE,
    unix: socket,
    sourceDir: (tenant: string) => (tenant === TENANT ? SOURCE : undefined),
    sync: (tenant: string) => putTenantRoot(SOURCE, { root: STORE, tenant })
  })
  const connection = open(`okf+unix://${socket}?tenant=${TENANT}`)
  const ids = corpus.concepts.slice(0, 3).map(concept => concept.id)

  await connection.manifest()

  // A needle cut from the stored text itself, so the find always hits and the
  // row times a located window rather than a miss.
  const first = ids[0] ?? ''
  const text = (await connection.get([first])).get(first)?.text ?? ''
  const needle = text.slice(120, 150) || text.slice(0, 30)

  const timings = {
    socketSearchMs: await median(20, () => connection.search(probe)),
    socketManifestMs: await median(20, () => connection.manifest()),
    socketGetMs: await median(20, () =>
      connection.get(ids, { section: 'schema' })
    ),
    socketFindMs: await median(20, () =>
      connection.get([first], { find: needle })
    ),
    ...(await preconditionCost(connection, corpus))
  }

  await connection.close()
  await server.stop(true)
  await rm(socket, { force: true })

  return timings
}

/**
 * The write path as an editor actually uses it: read the concept to learn its
 * hash, then write naming that hash. A write that names a stale hash has to be
 * refused, and refusing is the case worth timing because it is what a second
 * editor pays to discover it lost the race.
 */
async function preconditionCost(connection: Connection, corpus: Corpus) {
  const concept = corpus.concepts[0]
  const bundle = concept?.bundle ?? ''
  const path = concept?.path ?? ''
  const original = await connection.readSource(bundle, path)
  const stale = original?.hash ?? ''
  let refused = 0
  let hash = stale

  const acceptedMs = await median(5, async () => {
    const current = await connection.readSource(bundle, path)

    hash = await connection.writeSource(
      bundle,
      path,
      `${current?.content ?? ''}\n`,
      current?.hash
    )
  })
  const refusedMs = await median(5, async () => {
    await connection
      .writeSource(bundle, path, 'clobber', stale)
      .then(() => undefined)
      .catch(() => {
        refused++
      })
  })

  await connection.writeSource(bundle, path, original?.content ?? '', hash)

  return {
    writeAcceptedMs: acceptedMs,
    writeRefusedMs: refusedMs,
    staleWritesRefused: refused
  }
}

/** Read a concept, write it back, and make the change readable. */
async function editRoundTrip(corpus: Corpus) {
  const concept = corpus.concepts[0]
  const bundle = concept?.bundle ?? ''
  const path = concept?.path ?? ''
  const original = (await readSource(SOURCE, bundle, path))?.content ?? ''
  let round = 0

  const ms = await median(5, async () => {
    const current = await readSource(SOURCE, bundle, path)

    await writeSource(SOURCE, bundle, path, `${current?.content ?? ''}\n`)
    await sync()
    await openTenant(STORE, TENANT)
    round++
  })

  await writeSource(SOURCE, bundle, path, original)
  await sync()

  return { editRoundTripMs: ms, rounds: round }
}

async function main(): Promise<void> {
  const name = process.argv[2] ?? 'reference'
  const profile = PROFILES[name]

  if (profile === undefined) {
    throw new Error(`unknown profile "${name}"`)
  }

  await rm(STORE, { recursive: true, force: true })

  const { corpus } = await profile.build(SOURCE, {
    bundles: Number(process.argv[3] ?? 1),
    perBundle: Number(process.argv[4] ?? 500)
  })
  const disk = await snapshots(corpus)
  const speed = await coldVersusWarm(profile.probe)
  const round = await editRoundTrip(corpus)
  const served = await daemon(corpus, profile.probe)
  const mcp = await mcpCost(profile.probe)
  const mutation = await mcpMutationCost()
  const tenants = await perTenant(5)

  await rm(SOURCE, { recursive: true, force: true })
  await rm(STORE, { recursive: true, force: true })

  process.stdout.write(
    `${JSON.stringify({
      profile: name,
      concepts: corpus.concepts.length,
      ...disk,
      ...speed,
      ...round,
      ...served,
      ...mcp,
      ...mutation,
      ...tenants
    })}\n`
  )
}

await main()
