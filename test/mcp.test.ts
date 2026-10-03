import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { open } from '../src/client/connection.ts'
import { GET_LIMIT, MANIFEST_URI, createMcpServer } from '../src/mcp/lazy.ts'
import { adviceFor } from '../src/search/advice.ts'
import { putBundle } from '../src/store/writer.ts'

import type { Connection } from '../src/types.ts'

const FIXTURE = `${import.meta.dir}/fixtures/sales`
const CLI = `${import.meta.dir}/../src/cli.ts`

let scratch = ''
let root = ''
let dsn = ''
let client: Client

async function connect(target: string): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const connected = new Client({ name: 'test', version: '0.0.0' })

  await Promise.all([
    createMcpServer(open(target)).connect(serverSide),
    connected.connect(clientSide)
  ])

  return connected
}

function firstText(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] })
    .content

  return content.map(block => block.text ?? '').join('')
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lr-mcp-'))
  root = join(scratch, 'data')
  dsn = `okf://${root}?tenant=acme`

  await putBundle(FIXTURE, { root, tenant: 'acme', bundle: 'sales' })
  client = await connect(dsn)
})

afterAll(async () => {
  await client.close()
  await rm(scratch, { recursive: true, force: true })
})

describe('tool surface', () => {
  test('exposes exactly six verbs', async () => {
    const { tools } = await client.listTools()

    expect(tools.map(tool => tool.name).sort()).toEqual([
      'delete',
      'get',
      'manifest',
      'search',
      'snapshot',
      'write'
    ])
  })

  test('tells the model when to call each tool, not just what it does', async () => {
    const { tools } = await client.listTools()
    const byName = new Map(tools.map(tool => [tool.name, tool.description]))

    expect(byName.get('manifest')).toContain('before anything else')
    expect(byName.get('get')).toContain('one call')
    expect(byName.get('snapshot')).toContain('changed')
  })

  test('declares the ids argument as required', async () => {
    const { tools } = await client.listTools()
    const get = tools.find(tool => tool.name === 'get')

    expect(get?.inputSchema.required).toEqual(['ids'])
  })
})

describe('write', () => {
  let fresh = ''
  let scratchWriter: Client

  const write = async (args: Record<string, string>) =>
    scratchWriter.callTool({ name: 'write', arguments: args })

  const hashFrom = (body: string): string => {
    const found = /retry with replaces: "([0-9a-f]+)"/.exec(body)

    if (found?.[1] === undefined) {
      throw new Error(`no hash offered in: ${body}`)
    }

    return found[1]
  }

  beforeAll(async () => {
    // Forward slashes because this path is also a DSN: normalizeDsn rewrites a
    // Windows drive path into the file-URL shape, so the root the store ends up
    // registering is slashed even when join() handed us backslashes.
    fresh = join(scratch, 'fromzero').replaceAll('\\', '/')
    scratchWriter = await connect(`okf://${fresh}?tenant=notes`)
  })

  afterAll(async () => {
    await scratchWriter.close()
  })

  test('creates a tenant that does not exist yet', async () => {
    const result = await write({
      bundle: 'inbox',
      path: 'idea.md',
      content: '---\ntype: note\n---\n\nShip the thing.\n'
    })

    expect(result.isError).toBeUndefined()
    expect(firstText(result)).toContain('wrote inbox/idea.md')
    expect(firstText(result)).toContain('1 concepts')
  })

  test('persists the native tenant so a new connection finds it again', async () => {
    const reopened = open(`okf://${fresh}?tenant=notes`)

    try {
      expect((await reopened.history()).revisions).toHaveLength(1)
      expect((await reopened.get(['idea'])).get('idea')?.text).toContain(
        'Ship the thing.'
      )
      expect(await Bun.file(`${fresh}/sources.json`).exists()).toBe(false)
    } finally {
      await reopened.close()
    }
  })

  test('makes the concept immediately readable', async () => {
    const result = await scratchWriter.callTool({
      name: 'get',
      arguments: { ids: ['idea'] }
    })

    expect(firstText(result)).toContain('Ship the thing.')
  })

  test('refuses to replace without a precondition', async () => {
    const result = await write({
      bundle: 'inbox',
      path: 'idea.md',
      content: 'overwritten\n'
    })

    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('already exists')
  })

  test('names the hash the retry needs', async () => {
    const result = await write({
      bundle: 'inbox',
      path: 'idea.md',
      content: 'overwritten\n'
    })

    expect(hashFrom(firstText(result))).toMatch(/^[0-9a-f]{64}$/)
  })

  test('accepts the replacement once that hash is offered', async () => {
    const refused = await write({
      bundle: 'inbox',
      path: 'idea.md',
      content: 'second draft\n'
    })
    const result = await write({
      bundle: 'inbox',
      path: 'idea.md',
      content: '---\ntype: note\n---\n\nSecond draft.\n',
      replaces: hashFrom(firstText(refused))
    })

    expect(result.isError).toBeUndefined()

    const read = await scratchWriter.callTool({
      name: 'get',
      arguments: { ids: ['idea'] }
    })

    expect(firstText(read)).toContain('Second draft.')
  })

  test('refuses a hash that is no longer current', async () => {
    const result = await write({
      bundle: 'inbox',
      path: 'idea.md',
      content: 'third draft\n',
      replaces: 'a'.repeat(64)
    })

    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('changed since it was read')
  })

  test('reports the compiler diagnostics for the file it wrote', async () => {
    const result = await write({
      bundle: 'inbox',
      path: 'bare.md',
      content: 'No frontmatter here.\n'
    })

    expect(firstText(result)).toContain('not an OKF concept')
  })

  test('leaves another file out of those diagnostics', async () => {
    const result = await write({
      bundle: 'inbox',
      path: 'second.md',
      content: '---\ntype: note\n---\n\nFine.\n'
    })

    expect(firstText(result)).not.toContain('bare.md')
  })

  test('rejects a path that is not markdown', async () => {
    const result = await write({
      bundle: 'inbox',
      path: 'notes.txt',
      content: 'x\n'
    })

    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('must be a .md file')
  })

  test('refuses to bootstrap over a tenant compiled from an unregistered directory', async () => {
    const result = await client.callTool({
      name: 'write',
      arguments: { bundle: 'sales', path: 'new.md', content: 'x\n' }
    })

    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('replaced by an empty one')
  })

  test('leaves that manifest intact after refusing', async () => {
    const result = await client.callTool({ name: 'manifest', arguments: {} })

    expect(firstText(result)).toContain('customers')
  })

  /**
   * The write lands on disk and the recompile is what fails. Reporting that as
   * a refused precondition would hand back the hash of a write that already
   * happened, and the model would satisfy it and write the same thing again.
   */
  describe('when the recompile fails after the write', () => {
    let failing: Client

    beforeAll(async () => {
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
      const underneath = open(`okf://${join(scratch, 'nosync')}?tenant=notes`)
      const { transact: _transact, ...legacy } = underneath
      const broken: Connection = {
        ...legacy,
        sync: () => Promise.reject(new Error('another writer holds the lock'))
      }

      failing = new Client({ name: 'nosync', version: '0.0.0' })

      await Promise.all([
        createMcpServer(broken).connect(serverSide),
        failing.connect(clientSide)
      ])
    })

    afterAll(async () => {
      await failing.close()
    })

    test('says the write happened and the recompile did not', async () => {
      const result = await failing.callTool({
        name: 'write',
        arguments: {
          bundle: 'inbox',
          path: 'kept.md',
          content: '---\ntype: note\n---\n\nKept.\n'
        }
      })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toContain('wrote inbox/kept.md')
      expect(firstText(result)).toContain('recompile failed')
    })

    test('offers no hash to retry a write that already landed', async () => {
      const result = await failing.callTool({
        name: 'write',
        arguments: {
          bundle: 'inbox',
          path: 'second.md',
          content: '---\ntype: note\n---\n\nAlso kept.\n'
        }
      })

      expect(firstText(result)).not.toContain('retry with replaces')
    })
  })

  describe('delete', () => {
    const remove = async (args: Record<string, string>) =>
      scratchWriter.callTool({ name: 'delete', arguments: args })

    test('refuses without the hash of what it would remove', async () => {
      const result = await remove({ bundle: 'inbox', path: 'second.md' })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toContain('needs the hash')
    })

    test('names that hash so the retry can succeed', async () => {
      const result = await remove({ bundle: 'inbox', path: 'second.md' })

      expect(hashFrom(firstText(result))).toMatch(/^[0-9a-f]{64}$/)
    })

    test('removes the concept once the hash is offered', async () => {
      const refused = await remove({ bundle: 'inbox', path: 'second.md' })
      const result = await remove({
        bundle: 'inbox',
        path: 'second.md',
        replaces: hashFrom(firstText(refused))
      })

      expect(result.isError).toBeUndefined()
      expect(firstText(result)).toContain('deleted inbox/second.md')
    })

    test('takes it out of the manifest', async () => {
      const result = await scratchWriter.callTool({
        name: 'manifest',
        arguments: {}
      })

      expect(firstText(result)).not.toContain('second')
    })

    test('says so when there is nothing to remove', async () => {
      const result = await remove({ bundle: 'inbox', path: 'second.md' })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toContain('does not exist')
    })

    test('offers no hash for a concept that is not there', async () => {
      const result = await remove({ bundle: 'inbox', path: 'second.md' })

      expect(firstText(result)).not.toContain('retry with replaces')
    })

    test('refuses a hash that is no longer current', async () => {
      const result = await remove({
        bundle: 'inbox',
        path: 'idea.md',
        replaces: 'a'.repeat(64)
      })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toContain('changed since it was read')
    })

    test('leaves the concept alone after refusing', async () => {
      const result = await scratchWriter.callTool({
        name: 'get',
        arguments: { ids: ['idea'] }
      })

      expect(firstText(result)).toContain('Second draft.')
    })
  })
})

describe('manifest', () => {
  test('returns the stored manifest', async () => {
    const result = await client.callTool({ name: 'manifest', arguments: {} })

    expect(firstText(result).startsWith('# tenant: acme')).toBe(true)
  })

  test('is also readable as a resource for clients that preload', async () => {
    const result = await client.readResource({ uri: MANIFEST_URI })
    const first = result.contents[0]

    if (first === undefined || !('text' in first)) {
      throw new Error('manifest resource returned no text content')
    }

    expect(first.mimeType).toBe('text/tab-separated-values')
    expect(first.text.startsWith('# tenant: acme')).toBe(true)
  })
})

describe('search', () => {
  test('returns narrowed manifest rows, not bodies', async () => {
    const result = await client.callTool({
      name: 'search',
      arguments: { query: 'churned' }
    })
    const body = firstText(result)

    expect(body).toContain('# query: churned')
    expect(body).toContain('customers')
    expect(body).not.toContain('@@')
  })

  test('honours k', async () => {
    const result = await client.callTool({
      name: 'search',
      arguments: { query: 'orders', k: 1 }
    })

    expect(firstText(result)).toContain('1 direct')
  })

  test('rejects an empty query at the schema boundary', async () => {
    const result = await client.callTool({
      name: 'search',
      arguments: { query: '' }
    })

    expect(result.isError).toBe(true)
  })
})

describe('get', () => {
  test('returns a batch of concepts in one call', async () => {
    const result = await client.callTool({
      name: 'get',
      arguments: { ids: ['customers', 'tables/orders'] }
    })
    const body = firstText(result)

    expect(body).toContain('@@ customers')
    expect(body).toContain('@@ tables/orders')
  })

  test('returns only the requested section', async () => {
    const whole = firstText(
      await client.callTool({ name: 'get', arguments: { ids: ['orders_db'] } })
    )
    const section = firstText(
      await client.callTool({
        name: 'get',
        arguments: { ids: ['orders_db'], section: 'orders_db' }
      })
    )

    expect(section.length).toBeLessThan(whole.length)
    expect(section).toContain('# Orders DB')
  })

  test('names ids it could not find instead of failing silently', async () => {
    const result = await client.callTool({
      name: 'get',
      arguments: { ids: ['customers', 'nope'] }
    })
    const body = firstText(result)

    expect(body).toContain('@@ customers')
    expect(body).toContain('@@ missing\nnope')
  })

  test('rejects an empty id list at the schema boundary', async () => {
    const result = await client.callTool({
      name: 'get',
      arguments: { ids: [] }
    })

    expect(result.isError).toBe(true)
  })
})

/**
 * The cap is the point of the MCP boundary: a naive get of a huge document
 * must come back as a framed slice, never as an unbounded dump, and the frame
 * has to carry enough to continue or to jump straight to a passage.
 */
describe('get slicing', () => {
  const body = `${'x'.repeat(20_000)} the needle sentence ${'y'.repeat(20_000)}`
  let sliced: Client
  let total = 0
  let needleAt = 0

  beforeAll(async () => {
    const dir = join(scratch, 'big')

    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'huge.md'), `---\ntype: Chapter\n---\n\n${body}`)
    await putBundle(dir, { root, tenant: 'big' })
    sliced = await connect(`okf://${root}?tenant=big`)

    const direct = open(`okf://${root}?tenant=big`)
    const stored = (await direct.get(['huge'])).get('huge')

    total = stored?.total ?? 0
    needleAt = stored?.text.indexOf('needle sentence') ?? 0
    await direct.close()
  })

  afterAll(async () => {
    await sliced.close()
  })

  test('caps an unbounded read at the default limit', async () => {
    const result = firstText(
      await sliced.callTool({ name: 'get', arguments: { ids: ['huge'] } })
    )

    expect(result).toContain(`@@ huge [0..${GET_LIMIT} of ${total}]`)
    expect(result).not.toContain('needle')
    expect(result.length).toBeLessThan(GET_LIMIT + 100)
  })

  test('offset continues where the cap stopped', async () => {
    const result = firstText(
      await sliced.callTool({
        name: 'get',
        arguments: { ids: ['huge'], offset: GET_LIMIT }
      })
    )

    expect(result).toContain(
      `@@ huge [${GET_LIMIT}..${GET_LIMIT * 2} of ${total}]`
    )
    expect(result).toContain('needle sentence')
  })

  test('an explicit limit overrides the default', async () => {
    const result = firstText(
      await sliced.callTool({
        name: 'get',
        arguments: { ids: ['huge'], limit: 25 }
      })
    )

    expect(result).toContain(`@@ huge [0..25 of ${total}]`)
  })

  test('find returns a small window and the match offset', async () => {
    const result = firstText(
      await sliced.callTool({
        name: 'get',
        arguments: { ids: ['huge'], find: 'needle sentence' }
      })
    )

    expect(result).toContain(`1 match at ${needleAt}`)
    expect(result).toContain('needle sentence')
    expect(result.length).toBeLessThan(3_000)
  })

  test('find that misses says so instead of returning silence', async () => {
    const result = firstText(
      await sliced.callTool({
        name: 'get',
        arguments: { ids: ['huge'], find: 'ghost of a phrase' }
      })
    )

    expect(result).toContain(`@@ huge no match in ${total} chars`)
  })
})

describe('snapshot', () => {
  test('returns the current digest', async () => {
    const result = await client.callTool({ name: 'snapshot', arguments: {} })

    expect(firstText(result)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('failures', () => {
  test('reports a missing tenant as a tool error, not a protocol crash', async () => {
    const broken = await connect(`okf://${root}?tenant=absent`)
    const result = await broken.callTool({ name: 'manifest', arguments: {} })

    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('ENOENT')

    await broken.close()
  })
})

describe('stdio transport', () => {
  test('writes nothing but JSON-RPC frames to stdout', async () => {
    const proc = Bun.spawn(['bun', CLI, 'mcp', dsn], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe'
    })

    await proc.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'probe', version: '0.0.0' }
        }
      })}\n`
    )
    await proc.stdin.flush()

    const reader = proc.stdout.getReader()
    const { value } = await reader.read()
    const line = new TextDecoder().decode(value).split('\n')[0] ?? ''
    const frame = JSON.parse(line) as {
      jsonrpc: string
      result?: { serverInfo?: { name?: string } }
    }

    expect(frame.jsonrpc).toBe('2.0')
    expect(frame.result?.serverInfo?.name).toBe('langonrock')

    await reader.cancel()
    proc.kill()
    await proc.exited

    expect(await new Response(proc.stderr).text()).toContain('over stdio')
  })
})

describe('strategy advice', () => {
  const row = (id: number) =>
    `concept_${id}\tsales\ttable\t-\t-\tOne row per something or other.\t-`
  const manifestOf = (rows: number) =>
    `${[
      '# tenant: acme',
      '# bundles: sales',
      'id\tbundle\tkind\tstatus\tgrain\tsummary\tlinks',
      ...Array.from({ length: rows }, (_, id) => row(id))
    ].join('\n')}\n`

  test('a small manifest is advised into the prompt prefix', () => {
    expect(adviceFor(manifestOf(20))).toContain(
      'reading it whole is cheaper than searching'
    )
  })

  test('a large manifest is advised toward search', () => {
    expect(adviceFor(manifestOf(2000))).toContain(
      'prefer "search" over reading it whole'
    )
  })

  test('the advice names the manifest cost in round tokens', () => {
    expect(adviceFor(manifestOf(2000))).toMatch(/~[\d,]+ tokens/)
  })

  test('is deterministic for the same manifest', () => {
    expect(adviceFor(manifestOf(500))).toBe(adviceFor(manifestOf(500)))
  })

  test('reaches the client inside the manifest tool description', async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const advised = new Client({ name: 'test', version: '0.0.0' })

    await Promise.all([
      createMcpServer(open(dsn), 'Advice sentence under test.').connect(
        serverSide
      ),
      advised.connect(clientSide)
    ])

    const { tools } = await advised.listTools()
    const manifest = tools.find(tool => tool.name === 'manifest')

    expect(manifest?.description).toEndWith('Advice sentence under test.')
    await advised.close()
  })

  test('stays absent when no advice is given', async () => {
    const { tools } = await client.listTools()
    const manifest = tools.find(tool => tool.name === 'manifest')

    expect(manifest?.description).not.toContain('tokens;')
  })
})
