import { releaseBuffer } from '../buffers.ts'
import { visit } from './workers.ts'

import type { CompiledInput } from './input.ts'
import type { CompressedBody } from '../store/format.ts'

export type EncodedBody = Pick<CompressedBody, 'bytes' | 'checksum'>

function* documents(inputs: CompiledInput[]) {
  for (const input of inputs) {
    for (const concept of input.result.concepts) {
      yield {
        key: `${input.name}/${concept.path}`,
        content: input.result.bodies.get(concept.id) ?? ''
      }
    }
  }
}

export function releaseCompressed(bodies: Map<string, EncodedBody>): void {
  for (const body of bodies.values()) {
    releaseBuffer(body.bytes)
  }
}

export async function compressInputs(
  inputs: CompiledInput[]
): Promise<Map<string, EncodedBody>> {
  const bodies = new Map<string, EncodedBody>()

  try {
    await visit(documents(inputs), async document => {
      const bytes = await Bun.zstdCompress(document.content, { level: 1 })

      bodies.set(document.key, {
        bytes,
        checksum: Bun.hash.crc32(document.content)
      })
    })
  } catch (cause) {
    releaseCompressed(bodies)

    throw cause
  }

  return bodies
}
