import { dirname } from 'node:path'
import type NativeBinding from '../../native/bin/store-platform.node'

// Bun requires a direct require to load and embed a Node-API addon.
const binding =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../native/bin/store-platform.node') as typeof NativeBinding

export function tryLock(
  path: string,
  shared = false
): (() => void) | undefined {
  const handle = binding.tryLock(path, shared)

  return handle === null ? undefined : () => binding.release(handle)
}

export async function lock(path: string, shared = false): Promise<() => void> {
  const deadline = performance.now() + 5000

  do {
    const release = tryLock(path, shared)

    if (release !== undefined) {
      return release
    }

    await Bun.sleep(5)
  } while (performance.now() < deadline)

  throw new Error('database busy: another process holds the lock')
}

export function flushFile(path: string): void {
  binding.flush(path, false)
}

export function flushDirectory(path: string): void {
  if (process.platform !== 'win32') {
    binding.flush(path, true)
  }
}

export function orderWrites(path: string): void {
  binding.order(path)
}

export function replaceFile(source: string, target: string): void {
  binding.replace(source, target)

  flushDirectory(dirname(target))
}
