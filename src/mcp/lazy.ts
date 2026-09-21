import type * as Implementation from './server.ts'

export { GET_LIMIT, MANIFEST_URI } from './constants.ts'

export function createMcpServer(
  ...args: Parameters<typeof Implementation.createMcpServer>
): ReturnType<typeof Implementation.createMcpServer> {
  // Preserve the synchronous factory and let Bun embed the deferred module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const implementation = require('./server.ts') as typeof Implementation

  return implementation.createMcpServer(...args)
}

export async function serveMcp(
  ...args: Parameters<typeof Implementation.serveMcp>
): Promise<void> {
  const implementation = await import('./server.ts')

  await implementation.serveMcp(...args)
}
