import { expect, spyOn, test } from 'bun:test'

import { compressInputs, releaseCompressed } from '../src/db/compression.ts'
import { finish } from '../src/db/documents.ts'
import { compileInput } from '../src/db/input.ts'

test('bounded asynchronous compression produces the same snapshot and source bytes', async () => {
  const input = compileInput(
    'docs',
    [
      {
        bundle: 'docs',
        path: 'a.md',
        source: '---\r\ntitle: Unicode\r\n---\r\n# A\r\nΔ😀漢字\0\r\n'.repeat(
          100
        )
      },
      { bundle: 'docs', path: 'b.md', source: '' },
      { bundle: 'docs', path: 'index.md', source: '[A](a.md)\r\n' }
    ],
    120
  )
  const expected = finish([input], 'test', 120)
  const encoded = await compressInputs([input])

  try {
    const actual = finish([input], 'test', 120, { encoded })

    expect(actual.snapshotBytes).toEqual(expected.snapshotBytes)
    expect(actual.archiveBytes).toEqual(expected.archiveBytes)
    expect(actual.checksums).toEqual(expected.checksums)
  } finally {
    releaseCompressed(encoded)
  }
})

test('compression failure waits for pending work before releasing its buffers', async () => {
  const input = compileInput(
    'docs',
    Array.from({ length: 100 }, (_, index) => ({
      bundle: 'docs',
      path: `doc${index}.md`,
      source: index === 0 ? 'fail' : `body ${index}`
    })),
    120
  )
  const original = Bun.zstdCompress.bind(Bun)
  const buffers: Uint8Array[] = []
  const gate = Promise.withResolvers<void>()
  let started = 0
  let settled = false
  const mock = spyOn(Bun, 'zstdCompress').mockImplementation(
    async (data, options) => {
      started++

      if (data === 'fail') {
        throw new Error('injected compression failure')
      }

      await gate.promise

      const bytes = await original(data, options)

      buffers.push(bytes)

      return bytes
    }
  )

  try {
    const pending = compressInputs([input]).then(
      () => {
        settled = true

        return undefined
      },
      error => {
        settled = true

        return error as Error
      }
    )

    await Bun.sleep(1)
    expect(settled).toBe(false)
    expect(started).toBeLessThanOrEqual(32)
    gate.resolve()
    expect((await pending)?.message).toBe('injected compression failure')
    expect(buffers.length).toBeGreaterThan(0)
    expect(buffers.every(bytes => bytes.buffer.byteLength === 0)).toBe(true)
  } finally {
    gate.resolve()
    mock.mockRestore()
  }
})
