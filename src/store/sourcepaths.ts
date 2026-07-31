import { isAbsolute, relative, resolve } from 'node:path'

const BUNDLE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i
const MD_EXTENSION = /\.md$/i

/** Windows caps a path at 260 characters unless long paths are enabled. */
const MAX_RELATIVE = 200

/**
 * A bundle name becomes a directory, so it is validated the same way a tenant
 * id is in `paths.ts`: an allowlist that rejects, never a cleanup that trusts.
 */
export function assertBundleName(bundle: string): string {
  if (!BUNDLE_NAME.test(bundle)) {
    throw new Error(
      `invalid bundle name "${bundle}": expected 1-64 chars of [a-z0-9_-]`
    )
  }

  return bundle
}

function assertSegment(segment: string, path: string): void {
  if (!SEGMENT.test(segment)) {
    throw new Error(
      `invalid path "${path}": segment "${segment}" is empty, starts with a dot, or has a character outside [a-z0-9._-]`
    )
  }
}

/**
 * The path arrives from a network client and reaches the filesystem, so every
 * shape that could escape the bundle is rejected outright. A leading dot is
 * refused for a second reason: the watcher ignores dot directories, so a
 * concept written there would never be compiled and the write would look like
 * it worked.
 */
export function assertConceptPath(path: string): string {
  if (path.length > MAX_RELATIVE) {
    throw new Error(
      `invalid path "${path}": longer than ${MAX_RELATIVE} characters`
    )
  }

  if (path.includes('\0') || path.includes('\\')) {
    throw new Error(`invalid path "${path}": use forward slashes only`)
  }

  if (path.startsWith('/')) {
    throw new Error(`invalid path "${path}": must be relative to the bundle`)
  }

  if (!MD_EXTENSION.test(path)) {
    throw new Error(`invalid path "${path}": a concept must be a .md file`)
  }

  for (const segment of path.split('/')) {
    assertSegment(segment, path)
  }

  return path
}

/**
 * Validation already forbids every escape, so this containment check should be
 * unreachable. It runs anyway because a path that reaches the filesystem is the
 * one place where being wrong once is expensive.
 */
export function sourceFile(dir: string, bundle: string, path: string): string {
  const root = bundleDir(dir, bundle)
  const target = resolve(root, assertConceptPath(path))
  // `relative` rather than a prefix comparison: the separator differs by
  // platform, so a string prefix check passes on POSIX and fails on Windows.
  const inside = relative(root, target)

  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(`invalid path "${path}": resolves outside the bundle`)
  }

  return target
}

export function bundleDir(dir: string, bundle: string): string {
  return resolve(dir, assertBundleName(bundle))
}
