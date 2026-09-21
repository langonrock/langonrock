import { transact } from '../../src/db/api.ts'

import type { TransactionRequest } from '../../src/types.ts'
import type { DatabaseTarget } from '../../src/db/types.ts'

const input = JSON.parse(Bun.argv[2] ?? '{}') as {
  target: DatabaseTarget
  request: TransactionRequest
  stop?: string
}

try {
  const result = await transact(input.target, input.request, async step => {
    if (step === input.stop) {
      process.stdout.write('ready\n')
      await new Promise(() => setInterval(() => undefined, 1000))
    }
  })

  process.stdout.write(`${JSON.stringify({ result })}\n`)
} catch (cause) {
  process.stdout.write(
    `${JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) })}\n`
  )
  process.exitCode = 1
}
