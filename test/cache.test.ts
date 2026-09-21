import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { transact } from '../src/db/api.ts'
import { Descriptor } from '../src/db/descriptor.ts'
import { createReadCache } from '../src/db/readcache.ts'
import { createSearchCache } from '../src/search/cache.ts'
import { serve } from '../src/server/http.ts'
import { createReaderCache } from '../src/store/cache.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'langonrock-cache-'))
  await transact(
    { root, tenant: 'test' },
    {
      changes: [
        {
          operation: 'write',
          bundle: 'docs',
          path: 'a.md',
          content: '# Searchable needle'
        }
      ]
    }
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('closing a public reader cache releases ownership without breaking active leases', async () => {
  const close = spyOn(Descriptor.prototype, 'close')
  const cache = createReaderCache(root)
  const reader = await cache('test')

  try {
    cache.close()
    cache.close()
    expect(close).not.toHaveBeenCalled()
    expect((await reader.get(['a'])).get('a')?.text).toContain('needle')
    await expect(cache('test')).rejects.toThrow('closed')
    reader.close()
    reader.close()
    expect(close).toHaveBeenCalledTimes(1)
    expect(() => reader.get(['a'])).toThrow('closed')
  } finally {
    reader.close()
    cache.close()
    close.mockRestore()
  }
})

test('closing a public search cache releases its pinned reader', async () => {
  const close = spyOn(Descriptor.prototype, 'close')
  const cache = createSearchCache(root)

  try {
    await cache('test')
    expect(close).not.toHaveBeenCalled()
    cache.close()
    cache.close()
    expect(close).toHaveBeenCalledTimes(1)
    await expect(cache('test')).rejects.toThrow('closed')
    expect(close).toHaveBeenCalledTimes(1)
  } finally {
    cache.close()
    close.mockRestore()
  }
})

test('HTTP serves a warmed shared cache and closes it on shutdown', async () => {
  const readers = createReadCache(root)
  const warmed = await readers.acquire('test')
  const index = await warmed.index()
  const acquire = spyOn(readers, 'acquire')
  const server = serve({
    root,
    port: 0,
    readers,
    tokens: new Map([['secret', { tenant: 'test', write: false }]])
  })

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.port}/v1/test/search`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
        body: JSON.stringify({ q: 'needle' })
      }
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('a\tdocs')
    expect(acquire).toHaveBeenCalledTimes(1)
    const current = await readers.acquire('test')

    expect(current.reader).toBe(warmed.reader)
    expect(await current.index()).toBe(index)
    current.release()
    warmed.release()
    await server.stop(true)
    await expect(readers.acquire('test')).rejects.toThrow('closed')
    expect(() => warmed.reader.get(['a'])).toThrow('closed')
  } finally {
    acquire.mockRestore()
    warmed.release()
    await server.stop(true)
  }
})
