export async function visit<T>(
  values: Iterable<T>,
  operation: (value: T) => Promise<void>
): Promise<void> {
  const source = values[Symbol.iterator]()

  const worker = async (): Promise<void> => {
    for (;;) {
      const next = source.next()

      if (next.done) {
        return
      }

      await operation(next.value)
    }
  }

  const results = await Promise.allSettled(Array.from({ length: 32 }, worker))
  const failure = results.find(result => result.status === 'rejected')

  if (failure?.status === 'rejected') {
    throw failure.reason
  }
}
