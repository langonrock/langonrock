import { importFolder } from '../../src/db/import.ts'
import { migrate } from '../../src/db/migration.ts'

import type { DatabaseTarget } from '../../src/db/types.ts'
import type { CommitObserver } from '../../src/db/publish.ts'

const input = JSON.parse(Bun.argv[2] ?? '{}') as {
  target: DatabaseTarget
  source: string
  stop: string
  migration?: boolean
}

const observe: CommitObserver = async step => {
  if (step === input.stop) {
    process.stdout.write('ready\n')
    await new Promise(() => setInterval(() => undefined, 1000))
  }
}

if (input.migration) {
  await migrate(input.target, input.source, { observe })
} else {
  await importFolder(input.target, input.source, {}, observe)
}
