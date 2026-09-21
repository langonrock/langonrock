import { readFile } from 'node:fs/promises'

import { buildTenantIndex } from '../search/tenant.ts'
import { currentFile } from '../store/paths.ts'
import { openTenant } from '../store/reader.ts'
import { readHead } from './head.ts'
import { pinReader } from './reader.ts'

import type { TenantIndex } from '../search/tenant.ts'
import type { TenantReader } from '../store/reader.ts'
import type { DatabaseTarget } from './types.ts'

export interface ReadLease {
  reader: TenantReader
  index: () => Promise<TenantIndex>
  release: () => void
}

interface Entry {
  reader: TenantReader
  native: boolean
  references: number
  close: () => void
  index?: { date: string; promise: Promise<TenantIndex> }
}

function release(entry: Entry): void {
  entry.references--

  if (entry.references === 0) {
    entry.close()
  }
}

function indexFor(entry: Entry): Promise<TenantIndex> {
  const date = new Date().toISOString().slice(0, 10)

  if (entry.index?.date !== date) {
    const promise = buildTenantIndex(entry.reader)

    entry.index = { date, promise }
    void promise.catch(() => {
      if (entry.index?.promise === promise) {
        delete entry.index
      }
    })
  }

  return entry.index.promise
}

function lease(entry: Entry): ReadLease {
  entry.references++

  let active = true

  return {
    reader: entry.reader,
    index: () => indexFor(entry),
    release: () => {
      if (active) {
        active = false
        release(entry)
      }
    }
  }
}

async function openEntry(
  target: DatabaseTarget,
  native: boolean
): Promise<Entry> {
  if (native) {
    const reader = await pinReader(target)

    return { reader, native, references: 1, close: reader.close }
  }

  return {
    reader: await openTenant(target.root, target.tenant),
    native,
    references: 1,
    close: () => undefined
  }
}

function trim(entries: Map<string, Entry>, capacity: number): void {
  while (entries.size > capacity) {
    const oldest = entries.entries().next().value

    if (oldest !== undefined) {
      entries.delete(oldest[0])
      release(oldest[1])
    }
  }
}

export function createReadCache(root: string, capacity = 16) {
  const entries = new Map<string, Entry>()
  let closed = false

  const acquire = async (tenant: string): Promise<ReadLease> => {
    const target = { root, tenant }
    const head = await readHead(target)
    const native = head !== undefined
    const snapshot =
      head?.snapshot ??
      (await readFile(currentFile(root, tenant), 'utf8')).trim()
    const cached = entries.get(tenant)
    const entry =
      cached?.native === native && cached.reader.snapshot === snapshot
        ? cached
        : await openEntry(target, native)

    if (closed) {
      if (entry !== cached) {
        release(entry)
      }

      throw new Error('database connection is closed')
    }

    const previous = entries.get(tenant)

    if (previous !== undefined && previous !== entry) {
      release(previous)
    }

    entries.delete(tenant)
    entries.set(tenant, entry)

    const pinned = lease(entry)

    trim(entries, capacity)

    return pinned
  }

  return {
    acquire,
    close: () => {
      closed = true

      for (const entry of entries.values()) {
        release(entry)
      }

      entries.clear()
    }
  }
}

export async function withReader<T>(
  cache: ReturnType<typeof createReadCache>,
  tenant: string,
  action: (lease: ReadLease) => Promise<T>
): Promise<T> {
  const lease = await cache.acquire(tenant)

  try {
    return await action(lease)
  } finally {
    lease.release()
  }
}
