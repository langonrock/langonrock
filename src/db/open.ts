import { openTenant as openLegacy } from '../store/reader.ts'
import { readHead } from './head.ts'
import { pinReader } from './reader.ts'

import type { TenantReader } from '../store/reader.ts'

export async function openTenant(
  root: string,
  tenant: string
): Promise<TenantReader & { close?: () => void }> {
  const target = { root, tenant }

  return (await readHead(target)) === undefined
    ? openLegacy(root, tenant)
    : pinReader(target)
}
