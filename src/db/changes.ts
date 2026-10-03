import { assertBundleName, assertConceptPath } from '../store/sourcepaths.ts'
import { assertHash, hash } from './format.ts'
import { assertSourceVersion } from './preconditions.ts'
import { assertSourceText } from '../text.ts'

import type { DocumentChange, TransactionRequest } from '../types.ts'
import type { DocumentRecord } from './types.ts'

const MAX_CHANGES = 1000
const MAX_BYTES = 16 * 1024 * 1024

export function validateRequest(request: TransactionRequest): void {
  if (!request || typeof request !== 'object' || 'tenant' in request) {
    throw new Error(
      'transaction must be an object scoped to the connected tenant'
    )
  }

  if (
    !Array.isArray(request.changes) ||
    request.changes.length === 0 ||
    request.changes.length > MAX_CHANGES
  ) {
    throw new Error(`transaction needs between 1 and ${MAX_CHANGES} changes`)
  }

  if (request.expectedRevision !== undefined) {
    assertHash(request.expectedRevision)
  }

  const keys = new Set<string>()
  let bytes = 0

  for (const change of request.changes) {
    validateChange(change)

    const key = `${change.bundle}/${change.path}`.toLowerCase()

    if (keys.has(key)) {
      throw new Error('transaction contains duplicate document targets')
    }

    keys.add(key)
    bytes +=
      change.operation === 'write' ? Buffer.byteLength(change.content) : 0
  }

  if (bytes > MAX_BYTES) {
    throw new Error('transaction source payload exceeds 16 MiB')
  }
}

function validateChange(change: DocumentChange): void {
  if (
    !change ||
    typeof change !== 'object' ||
    typeof change.bundle !== 'string' ||
    typeof change.path !== 'string' ||
    'tenant' in change
  ) {
    throw new Error(
      'document change must specify a bundle and path within the connected tenant'
    )
  }

  assertBundleName(change.bundle)
  assertConceptPath(change.path)

  if (change.operation !== 'write' && change.operation !== 'delete') {
    throw new Error('invalid document operation')
  }

  if (change.operation === 'write') {
    if (typeof change.content !== 'string') {
      throw new Error('document content must be a string')
    }

    assertSourceText(change.content)
  }

  if (change.operation === 'delete' || change.replaces !== undefined) {
    assertHash(change.replaces)
  }
}

export function applyChanges(
  documents: DocumentRecord[],
  changes: DocumentChange[]
): DocumentRecord[] {
  const entries = new Map(
    documents.map(document => [`${document.bundle}/${document.path}`, document])
  )

  for (const change of changes) {
    const key = `${change.bundle}/${change.path}`
    const previous = entries.get(key)
    const currentHash =
      previous === undefined ? undefined : hash(previous.source)

    assertSourceVersion(currentHash, change.replaces)

    if (change.operation === 'delete') {
      entries.delete(key)
    } else {
      entries.set(key, {
        bundle: change.bundle,
        path: change.path,
        source: change.content
      })
    }
  }

  return [...entries]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, document]) => document)
}
