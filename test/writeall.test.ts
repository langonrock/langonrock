import { expect, test } from 'bun:test'

import { writeAll } from '../src/store/writeall.ts'

test('finishes short writes at the correct source and file offsets', async () => {
  const stored = new Uint8Array(5)
  const positions: number[] = []

  await writeAll(
    {
      write: (bytes, offset, length, position) => {
        const count = Math.min(2, length)

        positions.push(position)
        stored.set(bytes.subarray(offset, offset + count), position)

        return Promise.resolve({ bytesWritten: count })
      }
    },
    new Uint8Array([1, 2, 3, 4, 5])
  )
  expect([...stored]).toEqual([1, 2, 3, 4, 5])
  expect(positions).toEqual([0, 2, 4])
})

test('refuses zero, oversized, and invalid write counts', async () => {
  for (const bytesWritten of [0, -1, 5, NaN, 0.5]) {
    await expect(
      writeAll(
        { write: () => Promise.resolve({ bytesWritten }) },
        new Uint8Array(2)
      )
    ).rejects.toThrow('invalid progress')
  }
})
