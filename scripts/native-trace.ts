import { mkdirSync, writeSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Walks the native engine one step at a time. Every line is written
 * synchronously before its step starts, so when a step blocks the event loop
 * the last line printed names it, down to the native call.
 */
type Binding = Record<string, (...args: unknown[]) => unknown>

const started = performance.now()
const tenant = 'trace'
const write = (path: string) => ({
  changes: [
    {
      operation: 'write' as const,
      bundle: 'docs',
      path,
      content: '# Searchable needle'
    }
  ]
})

function trace(message: string): void {
  writeSync(2, `[${(performance.now() - started).toFixed(0)} ms] ${message}\n`)
}

async function step<T>(name: string, run: () => Promise<T> | T): Promise<T> {
  trace(`begin ${name}`)
  const result = await run()

  trace(`end ${name}`)

  return result
}

// Replaces the cached addon exports before any engine module loads it.
function traceBinding(): void {
  const path = require.resolve('../native/bin/store-platform.node')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const real = require(path) as Binding
  const entry = require.cache[path]

  if (entry === undefined) {
    throw new Error('the native binding is not in the require cache')
  }

  entry.exports = Object.fromEntries(
    Object.entries(real).map(([name, call]) => [
      name,
      (...args: unknown[]) => {
        const paths = args.filter(arg => typeof arg === 'string')

        trace(`native ${name} ${paths.join(' ')}`)
        const result = call(...args)

        trace(`native ${name} returned`)

        return result
      }
    ])
  )
}

async function platformSteps(root: string): Promise<void> {
  const platform = await step(
    'load the platform adapter',
    () => import('../src/db/platform.ts')
  )
  const probe = join(root, 'probe.lock')

  await step('take and release an exclusive lock', () =>
    platform.tryLock(probe)?.()
  )
  await step('wait for a lock', async () => (await platform.lock(probe))())
  await step('flush a file', () => platform.flushFile(probe))
  await step('order writes', () => platform.orderWrites(probe))
}

// ensureLayout once walked up to the path mkdirSync reported creating.
function layoutSpelling(root: string): void {
  const expected = resolve(root, 'spelling')
  const reported = mkdirSync(resolve(expected, 'probe'), { recursive: true })

  trace(`mkdirSync reported ${String(reported)}, expected ${expected}`)
}

async function engineSteps(root: string): Promise<void> {
  const { transact } = await step(
    'load the engine',
    () => import('../src/db/api.ts')
  )
  const { pinReader } = await import('../src/db/reader.ts')

  await step('commit the first transaction', () =>
    transact({ root, tenant }, write('a.md'))
  )
  await step('commit a second transaction', () =>
    transact({ root, tenant }, write('b.md'))
  )
  const reader = await step('pin a reader', () => pinReader({ root, tenant }))

  await step('read a concept', () => reader.get(['a']))
  await step('close the reader', () => reader.close())
}

async function cacheSteps(root: string): Promise<void> {
  const { createReaderCache } = await import('../src/store/cache.ts')
  const { createSearchCache } = await import('../src/search/cache.ts')
  const readers = createReaderCache(root)
  const reader = await step('open a cached reader', () => readers(tenant))

  await step('read through the cache', () => reader.get(['a']))
  await step('close the reader cache', () => readers.close())
  await step('close the cached reader', () => reader.close())

  const search = createSearchCache(root)

  await step('build a cached search index', () => search(tenant))
  await step('close the search cache', () => search.close())
}

async function serverSteps(root: string): Promise<void> {
  const { createReadCache } = await import('../src/db/readcache.ts')
  const { serve } = await import('../src/server/http.ts')
  const readers = createReadCache(root)
  const server = await step('start the server', () =>
    serve({
      root,
      port: 0,
      readers,
      tokens: new Map([['secret', { tenant, write: false }]])
    })
  )

  await step('search over HTTP', async () => {
    const response = await fetch(
      `http://127.0.0.1:${server.port}/v1/${tenant}/search`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
        body: JSON.stringify({ q: 'needle' })
      }
    )

    trace(`HTTP ${response.status} ${(await response.text()).length} chars`)
  })
  await step('stop the server', () => server.stop(true))
  await step('stop the server again', () => server.stop(true))
}

traceBinding()

const root = await mkdtemp(join(tmpdir(), 'langonrock-native-trace-'))

try {
  await platformSteps(root)
  layoutSpelling(root)
  await engineSteps(root)
  await cacheSteps(root)
  await serverSteps(root)
} finally {
  await step('remove the scratch store', () =>
    rm(root, { recursive: true, force: true })
  )
}

trace('native trace passed')
