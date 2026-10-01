import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { ensureLayout, existingAncestor } from '../src/db/layout.ts'

let root: string

beforeEach(async () => {
  root = resolve(await mkdtemp(join(tmpdir(), 'langonrock-layout-')))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('an existing directory is its own existing ancestor', () => {
  expect(existingAncestor(root)).toBe(root)
})

test('a missing path resolves to its deepest existing ancestor in its own spelling', () => {
  expect(existingAncestor(join(root, 'a', 'b', 'c'))).toBe(root)
})

test('laying out a tenant under missing parents creates every folder and returns', () => {
  const data = join(root, 'missing', 'data')

  ensureLayout({ root: data, tenant: 'acme' })

  for (const folder of ['snapshots', 'sources', 'revisions', 'staging']) {
    expect(existsSync(join(data, 'tenants', 'acme', folder))).toBe(true)
  }

  ensureLayout({ root: data, tenant: 'acme' })
})
