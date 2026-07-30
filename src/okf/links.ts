const LINK = /\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const MD_EXTENSION = /\.md$/i

export function extractLinkTargets(body: string): string[] {
  const targets: string[] = []

  for (const match of body.matchAll(LINK)) {
    const target = match[1]

    if (target !== undefined) {
      targets.push(target)
    }
  }

  return targets
}

function decode(target: string): string {
  try {
    return decodeURIComponent(target)
  } catch {
    return target
  }
}

function joinRelative(fromPath: string, target: string): string {
  const rooted = target.startsWith('/')
  const base = rooted ? [] : fromPath.split('/').slice(0, -1)
  const out = [...base]

  for (const part of target.replace(/^\//, '').split('/')) {
    if (part === '' || part === '.') {
      continue
    }

    if (part === '..') {
      out.pop()
      continue
    }

    out.push(part)
  }

  return out.join('/')
}

/**
 * Returns the bundle-relative path a markdown link points at, or undefined for
 * anything that is not an internal concept reference.
 */
export function resolveTarget(
  target: string,
  fromPath: string
): string | undefined {
  if (target.startsWith('#') || SCHEME.test(target)) {
    return undefined
  }

  const bare = decode(target).split('#')[0]?.split('?')[0] ?? ''

  if (bare === '') {
    return undefined
  }

  const joined = joinRelative(fromPath, bare)

  return MD_EXTENSION.test(joined) ? joined : `${joined}.md`
}

export interface ResolvedLinks {
  ids: string[]
  broken: string[]
}

export function resolveLinks(
  body: string,
  fromPath: string,
  pathToId: Map<string, string>
): ResolvedLinks {
  const selfId = pathToId.get(fromPath)
  const ids = new Set<string>()
  const broken = new Set<string>()

  for (const target of extractLinkTargets(body)) {
    const path = resolveTarget(target, fromPath)

    if (path === undefined) {
      continue
    }

    const id = pathToId.get(path)

    if (id === undefined) {
      broken.add(target)
    } else if (id !== selfId) {
      ids.add(id)
    }
  }

  return { ids: [...ids].sort(), broken: [...broken].sort() }
}
