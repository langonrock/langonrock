import { collect } from '../../src/db/gc.ts'

import type { DatabaseTarget } from '../../src/db/types.ts'

const { target, stop } = JSON.parse(process.argv[2] ?? '{}') as {
  target: DatabaseTarget
  stop: string
}

await collect({ ...target, keep: 2 }, async step => {
  if (step === stop) {
    process.stdout.write('ready\n')
    await new Promise(() => setInterval(() => undefined, 1000))
  }
})
