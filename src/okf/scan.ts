const NAVIGATION_FILES = new Set(['index.md', 'log.md'])

export function toPosix(path: string): string {
  return path.replaceAll('\\', '/')
}

export function basename(path: string): string {
  const segments = toPosix(path).split('/')

  return segments[segments.length - 1] ?? path
}

/**
 * Navigation files are structure, not knowledge, whatever their frontmatter
 * says. Exported because the source listing must exclude the same files the
 * compiler does, or an editor would show a file the manifest never mentions.
 */
export function isConceptPath(path: string): boolean {
  return !NAVIGATION_FILES.has(basename(path).toLowerCase())
}

export async function scanBundle(root: string): Promise<string[]> {
  const glob = new Bun.Glob('**/*.md')
  const found: string[] = []

  for await (const entry of glob.scan({ cwd: root, onlyFiles: true })) {
    const path = toPosix(entry)

    if (isConceptPath(path)) {
      found.push(path)
    }
  }

  return found.sort()
}
