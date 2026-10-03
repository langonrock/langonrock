import type { Sample, WorkerRequest } from './protocol.ts'

export async function runWorker(request: WorkerRequest): Promise<Sample> {
  const started = Bun.nanoseconds()
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dir}/worker.ts`, JSON.stringify(request)],
    {
      stdout: 'pipe',
      stderr: 'inherit'
    }
  )
  const decoder = new TextDecoder()
  let output = ''
  let startup: number | undefined

  for await (const chunk of child.stdout) {
    output += decoder.decode(chunk, { stream: true })

    if (startup === undefined && output.includes('\n')) {
      startup = (Bun.nanoseconds() - started) / 1e6
    }
  }

  output += decoder.decode()
  const lines = output.trim().split('\n')

  if (
    (await child.exited) !== 0 ||
    lines.length !== 2 ||
    lines[0] !== 'ready' ||
    startup === undefined
  ) {
    throw new Error(`benchmark worker failed: ${request.mode}/${request.phase}`)
  }

  const sample = JSON.parse(lines[1] ?? '') as Sample

  sample.timings['processStartup'] = [startup]

  return sample
}
