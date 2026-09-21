import { check } from './types.ts'

import type { Request } from './types.ts'

async function* messages(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true })
    let end = buffer.indexOf('\n')

    while (end !== -1) {
      yield JSON.parse(buffer.slice(0, end)) as unknown
      buffer = buffer.slice(end + 1)
      end = buffer.indexOf('\n')
    }
  }

  check(buffer === '', 'worker returned an incomplete message')
}

export function peer(request: Request) {
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dir}/worker.ts`, JSON.stringify(request)],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' }
  )
  const iterator = messages(child.stdout)

  return {
    send: async (command: string) => {
      await child.stdin.write(`${command}\n`)
    },
    next: async <T>(): Promise<T> => {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 60000)

      try {
        const result = await iterator.next()

        check(!result.done, `worker exited before its ${request.role} result`)

        return result.value as T
      } finally {
        clearTimeout(timeout)
      }
    },
    finish: async () => {
      await child.stdin.end()
      check((await child.exited) === 0, `${request.role} worker failed`)
    },
    kill: async () => {
      child.kill('SIGKILL')
      await child.exited
    }
  }
}

export type Peer = ReturnType<typeof peer>
