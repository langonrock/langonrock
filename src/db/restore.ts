import { ConflictError } from './errors.ts'
import { assertHash } from './format.ts'
import { findCommitted, withHead } from './history.ts'
import { publish } from './publish.ts'
import { releasePrepared, verifiedArtifacts } from './verified.ts'

import type { RestoreRequest, RevisionResult } from '../types.ts'
import type { CommitObserver } from './publish.ts'
import type { DatabaseTarget } from './types.ts'

export async function restore(
  target: DatabaseTarget,
  request: RestoreRequest,
  observe?: CommitObserver
): Promise<RevisionResult> {
  assertHash(request.revision)
  assertHash(request.expectedRevision)

  const candidate = await withHead(target, async base => {
    if (base.revision !== request.expectedRevision) {
      throw new ConflictError()
    }

    const revision = await findCommitted(target, base, request.revision)

    return { base, prepared: await verifiedArtifacts(target, revision) }
  })

  try {
    return await publish(target, {
      ...candidate,
      ...(observe === undefined ? {} : { observe })
    })
  } finally {
    releasePrepared(candidate.prepared)
  }
}
