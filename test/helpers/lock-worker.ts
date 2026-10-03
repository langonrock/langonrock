import { tryLock } from '../../src/db/platform.ts'

const release = tryLock(Bun.argv[2] ?? '')

if (release === undefined) {
  throw new Error('worker failed to acquire lock')
}

// The native finalizer closes an unreachable lock handle and drops the lock.
// Keep the handle reachable, then prove it survives a collection.
process.on('exit', release)
setTimeout(() => {
  Bun.gc(true)
  process.stdout.write('ready\n')
})
setInterval(() => undefined, 1000)
