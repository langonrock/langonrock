import { corruption } from './errors.ts'
import { assertHash, hash } from './format.ts'
import { decodeHead, directory } from './head.ts'
import { committed } from './history.ts'
import { lock } from './platform.ts'
import { readRevision } from './revision.ts'
import { releasePrepared, verifiedArtifacts } from './verified.ts'
import { readImport } from './importstate.ts'
import { readBounded } from './recordio.ts'

import type { DatabaseTarget, Revision } from './types.ts'

export interface VerifyResult {
  ok: boolean
  headHash: string | null
  verifiedRevisions: string[]
  issues: { artifact: string; message: string }[]
}

export async function rawHead(
  target: DatabaseTarget
): Promise<Uint8Array | undefined> {
  const file = Bun.file(`${directory(target)}/HEAD`)

  return (await file.exists())
    ? readBounded(`${directory(target)}/HEAD`, 1048576)
    : undefined
}

async function inspectRevision(
  target: DatabaseTarget,
  digest: string,
  revision: Revision,
  result: VerifyResult
): Promise<void> {
  try {
    releasePrepared(await verifiedArtifacts(target, revision))
    result.verifiedRevisions.push(digest)
  } catch (cause) {
    result.issues.push({ artifact: digest, message: String(cause) })
  }
}

async function inspectHead(
  target: DatabaseTarget,
  bytes: Uint8Array | undefined,
  result: VerifyResult
): Promise<void> {
  try {
    if (bytes === undefined) {
      throw corruption('missing committed head')
    }

    if (bytes.length > 1048576) {
      throw corruption('head exceeds size limit')
    }

    const head = decodeHead(bytes)

    for (const reference of head.imports ?? []) {
      await readImport(target, reference)
    }

    for await (const { digest, revision } of committed(target, head)) {
      await inspectRevision(target, digest, revision, result)
    }
  } catch (cause) {
    result.issues.push({ artifact: 'HEAD/history', message: String(cause) })
  }
}

export async function verify(
  target: DatabaseTarget,
  options: { revision?: string } = {}
): Promise<VerifyResult> {
  if (options.revision !== undefined) {
    assertHash(options.revision)
  }

  const release = await lock(`${directory(target)}/retention.lock`, true)

  try {
    const bytes = await rawHead(target)
    const result: VerifyResult = {
      ok: false,
      headHash: bytes === undefined ? null : hash(bytes),
      verifiedRevisions: [],
      issues: []
    }

    if (options.revision === undefined) {
      await inspectHead(target, bytes, result)
    } else {
      try {
        await inspectRevision(
          target,
          options.revision,
          await readRevision(target, options.revision),
          result
        )
      } catch (cause) {
        result.issues.push({
          artifact: options.revision,
          message: String(cause)
        })
      }
    }

    result.ok = result.issues.length === 0

    return result
  } finally {
    release()
  }
}
