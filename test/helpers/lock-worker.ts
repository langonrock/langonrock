import { tryLock } from '../../src/db/platform.ts'

const release = tryLock(Bun.argv[2] ?? '')

if (release === undefined) {
  throw new Error('worker failed to acquire lock')
}

process.stdout.write('ready\n')
setInterval(() => undefined, 1000)
