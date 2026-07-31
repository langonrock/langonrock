import { watch } from 'node:fs'

import { putTenantRoot } from './writer.ts'

import type { PutResult } from './writer.ts'

export const DEFAULT_DEBOUNCE_MS = 200
export const DEFAULT_RESCAN_MS = 30_000

export interface WatchOptions {
  source: string
  root: string
  tenant: string
  summaryWidth?: number
  debounceMs?: number
  rescanMs?: number
  onSync?: (result: PutResult) => void
  onError?: (error: Error) => void
}

export interface Watcher {
  ready: Promise<void>
  sync: () => Promise<void>
  close: () => void
}

/**
 * Editors and version control write inside dot directories constantly.
 * Rebuilding on `.git` or `.obsidian` churn would never stop.
 */
function isIgnored(file: string | null): boolean {
  return (
    file !== null &&
    file.split(/[\\/]/).some(segment => segment.startsWith('.'))
  )
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

/**
 * Watch events are a hint, never the source of truth. FSEvents coalesces,
 * ReadDirectoryChangesW drops events under bursts, and inotify runs out of
 * watches. A periodic full rescan is the backstop, and it is nearly free
 * because an unchanged tree hashes to the snapshot that already exists.
 */
export function watchTenant(options: WatchOptions): Watcher {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const rescanMs = options.rescanMs ?? DEFAULT_RESCAN_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let dirty = false
  let closed = false

  const sync = async (): Promise<void> => {
    if (running) {
      dirty = true

      return
    }

    running = true

    try {
      // Bound to a local first: `onSync?.(await put(...))` short-circuits the
      // whole call when onSync is absent, so the sync itself never happens.
      const result = await putTenantRoot(options.source, options)

      options.onSync?.(result)
    } catch (cause) {
      options.onError?.(toError(cause))
    } finally {
      running = false
    }

    if (dirty && !closed) {
      dirty = false
      await sync()
    }
  }

  const schedule = (): void => {
    if (closed) {
      return
    }

    clearTimeout(timer)
    timer = setTimeout(() => void sync(), debounceMs)
  }

  const watcher = watch(options.source, { recursive: true }, (_event, file) => {
    if (!isIgnored(file)) {
      schedule()
    }
  })

  watcher.on('error', cause => options.onError?.(toError(cause)))

  const rescan = setInterval(() => void sync(), rescanMs)

  return {
    ready: sync(),
    sync,
    close: () => {
      closed = true
      clearTimeout(timer)
      clearInterval(rescan)
      watcher.close()
    }
  }
}
