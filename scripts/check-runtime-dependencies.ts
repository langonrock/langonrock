import { resolve } from 'node:path'

const ENGINES =
  /^(bun:sqlite|sqlite3|better-sqlite3|sql\.js|@libsql\/client|level|leveldown|rocksdb|lmdb|duckdb|chromadb|mongodb|pg|mysql2|redis)$/
const PYTHON_PACKAGES = /^(python-shell|node-gyp|gyp|pyodide)$/
const PYTHON_FILES =
  /(?:\.py[co]?$|(?:^|\/)(?:pyproject\.toml|Pipfile|requirements[^/]*\.txt)$)/
const SPAWN_PYTHON =
  /(?:spawn|exec|execFile|execa)(?:Sync)?\s*\(\s*(?:\[\s*)?['"](?:python[\d.]*|pip[\d]*|uv)['"]/m
const transpiler = new Bun.Transpiler({ loader: 'ts' })

export function sourceViolations(path: string, source: string): string[] {
  if (PYTHON_FILES.test(path)) {
    return [`${path}: Python file`]
  }

  if (!/\.[cm]?[jt]s$/.test(path)) {
    return []
  }

  const violations = transpiler
    .scanImports(source.replace(/^#![^\n]*/, ''))
    .filter(item => ENGINES.test(item.path) || PYTHON_PACKAGES.test(item.path))
    .map(item => `${path}: forbidden dependency ${item.path}`)

  if (SPAWN_PYTHON.test(source)) {
    violations.push(`${path}: Python subprocess`)
  }

  return violations
}

export function packageViolations(packages: Record<string, unknown>): string[] {
  return Object.keys(packages).filter(
    name => ENGINES.test(name) || PYTHON_PACKAGES.test(name)
  )
}

export async function checkRuntimeDependencies(
  root: string
): Promise<string[]> {
  const paths = await Array.fromAsync(
    new Bun.Glob('{src,scripts,bench,native}/**/*').scan({
      cwd: root,
      onlyFiles: true
    })
  )
  const violations: string[] = []

  for (const path of paths) {
    if (path.includes('/bin/') || path.startsWith('bench/results/')) {
      continue
    }

    violations.push(
      ...sourceViolations(path, await Bun.file(resolve(root, path)).text())
    )
  }

  const manifest = await Bun.file(resolve(root, 'package.json')).json()
  const lock = Bun.JSONC.parse(
    await Bun.file(resolve(root, 'bun.lock')).text()
  ) as { packages: Record<string, unknown> }

  violations.push(
    ...packageViolations({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...lock.packages
    })
  )

  return violations
}

if (import.meta.main) {
  const violations = await checkRuntimeDependencies(
    resolve(import.meta.dir, '..')
  )

  process.stdout.write(
    violations.length === 0
      ? 'No forbidden runtime/build dependencies found.\n'
      : `${violations.join('\n')}\n`
  )
  process.exitCode = violations.length === 0 ? 0 : 1
}
