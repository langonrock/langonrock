import { tenantDir } from '../store/paths.ts'
import { assertHash } from './format.ts'

import type { DatabaseTarget } from './types.ts'

export function directory(target: DatabaseTarget): string {
  return tenantDir(target.root, target.tenant)
}

export function artifact(
  target: DatabaseTarget,
  kind: 'archive' | 'revision' | 'snapshot' | 'import',
  digest: string
): string {
  assertHash(digest)

  const folder = {
    archive: 'sources',
    revision: 'revisions',
    snapshot: 'snapshots',
    import: 'imports'
  }[kind]
  const extension = {
    archive: 'src',
    revision: 'rev',
    snapshot: 'tnt',
    import: 'imp'
  }[kind]

  return `${directory(target)}/${folder}/${digest}.${extension}`
}
