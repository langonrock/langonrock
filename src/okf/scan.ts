const NAVIGATION_FILES = new Set(['index.md', 'log.md'])

export function toPosix(path: string): string {
  return path.replaceAll('\\', '/')
}

export function basename(path: string): string {
  const segments = toPosix(path).split('/')

  return segments[segments.length - 1] ?? path
}

function isConcept(path: string): boolean {
  return !NAVIGATION_FILES.has(basename(path).toLowerCase())
}

export async function scanBundle(root: string): Promise<string[]> {
  const glob = new Bun.Glob('**/*.md')
  const found: string[] = []

  for await (const entry of glob.scan({ cwd: root, onlyFiles: true })) {
    const path = toPosix(entry)

    if (isConcept(path)) {
      found.push(path)
    }
  }

  return found.sort()
}
