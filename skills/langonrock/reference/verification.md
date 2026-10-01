# Verification

Run commands from the repository root. [package.json](../../../package.json),
[CI](../../../.github/workflows/ci.yml), [bunfig.toml](../../../bunfig.toml),
[ESLint configuration](../../../eslint.config.mjs), and
[Knip configuration](../../../knip.json), are the sources of truth.

## Setup

```sh
bun --version
bun install --frozen-lockfile
bun run build:native
bun src/cli.ts --help
```

The declared runtime is Bun 1.4.2 or newer. Install dependencies when needed;
an existing compatible installation can be used for local checks. Native source
builds require a C compiler, or an MSVC developer environment on Windows. No
Python or node-gyp participates in the build.

## Choose the diff

```sh
git status --short
git diff --stat
git diff
git diff --cached
git ls-files --others --exclude-standard
git symbolic-ref refs/remotes/origin/HEAD
git branch --show-current
```

For branch review, inspect `origin/main...HEAD` when that local ref exists, or
use the available `main...HEAD`. Replace the base with the user's requested
branch when supplied. Neither branch range includes uncommitted or untracked
changes; inspect those separately when they belong to the request. Report a
missing base instead of inventing a comparison.

## CI checks

```sh
bun run lint
bun run format:check
bun run typecheck
bun run check:dependencies
bun run check:deps
bun run check:deadcode
bun run test
```

CI runs these on Linux, macOS, and Windows. A local pass only covers the local
platform. Full-suite coverage requires at least 85 percent for both lines and
functions. Focused tests are diagnostic checks, not evidence of full-suite
coverage.

ESLint caps complexity at 12, nesting depth and nested callbacks at 3, parameters
at 4, and function length at 70 nonblank, noncomment lines. Tests have explicit
function-length and callback exceptions in the existing config. Keep those
thresholds; fix the affected code instead of adding exceptions.

ESLint applies type-aware recommended rules to all TypeScript files, including
benchmarks, using the root TypeScript project. Tests permit unsafe assignments
for Bun matchers and disable `await-thenable` because Bun types asynchronous
`expect` matchers as `void`. Keep asynchronous assertions awaited.

`check:deadcode` runs Knip. Unused exports, exported types, namespace members,
and enum members are warnings. Unused files, dependency problems, and unresolved
imports are errors. Package exports and the CLI are discovered from
`package.json`; the config adds scripts, test workers, and benchmark entry points.
The two unresolved build-script exclusions account for Knip interpreting Bun
shell commands relative to their containing file and expanding `bun build` as
the package's `build` script. Both scripts remain analyzed as entry points.

`check:deps` runs Knip's undeclared dependency, unresolved import, and binary
checks. `check:dependencies` separately enforces the native engine's ban on
database-engine and Python dependencies. The pre-push hook runs all CI checks
listed above. Pre-commit continues to run ESLint and Prettier on staged files.

## Focused checks

Use the relevant row while developing. Run the full CI checks before closing a
runtime or configuration change. For documentation-only work, formatting,
links, routing consistency, and the examples that changed are the relevant
checks; a product test run is not required just to move prose.

| Affected contract                                                | Focused command                                                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontmatter, scanning, ids, links, manifest                      | `bun test test/frontmatter.test.ts test/ids.test.ts test/links.test.ts test/manifest.test.ts test/ingest.test.ts test/tenant.test.ts`                |
| Summary, sections, freshness                                     | `bun test test/summary.test.ts test/sections.test.ts test/stale.test.ts`                                                                             |
| Snapshot format, atomic publication, restore, garbage collection | `bun test test/format.test.ts test/store.test.ts test/restore.test.ts test/gc.test.ts`                                                               |
| Source paths, writes, bundles, source/id joins, watchers         | `bun test test/sourcepaths.test.ts test/source.test.ts test/bundle.test.ts test/join.test.ts test/watch.test.ts`                                     |
| Search ranking, passage windows, slices                          | `bun test test/search.test.ts test/window.test.ts test/slice.test.ts`                                                                                |
| Connections, remote-only client, auth, TLS                       | `bun test test/connection.test.ts test/client.test.ts test/connector.test.ts test/token.test.ts test/tls.test.ts`                                    |
| CLI, default data roots, MCP tools                               | `bun test test/cli.test.ts test/datadir.test.ts test/mcp.test.ts`                                                                                    |
| Native formats and source reconstruction                         | `bun test test/database-format.test.ts test/sourcearchive.test.ts test/writeall.test.ts test/db-compression.test.ts`                                 |
| Native transactions, OS locks, and crash recovery                | `bun test test/database.test.ts test/recovery.test.ts test/platform.test.ts`                                                                         |
| Native history, retention, verify, and repair                    | `bun test test/history.test.ts test/database-gc.test.ts test/database-verify.test.ts`                                                                |
| Native transport parity and interchange                          | `bun test test/dbms-transports.test.ts test/interchange.test.ts test/migration.test.ts test/watch.test.ts`                                           |
| Performance comparator and dependency restrictions               | `bun test test/benchmark.test.ts test/runtime-dependencies.test.ts`                                                                                  |
| Docs and generated manuals                                       | `bunx --no-install prettier --check AGENTS.md AGENTS.html skills/langonrock docs/runbooks/agent-role-system.md docs/runbooks/agent-role-system.html` |

Select tests across rows for changes that cross boundaries. Relevant assertions
include byte-identical recompilation, tenant separation, stale hashes, invalid
paths, Unicode slicing, transport parity, and cleanup of temporary servers and
files. Follow the existing `bun:test` suites and fixtures rather than inventing
a parallel test framework.

## Local read-model smoke check

This example stores the existing fixture in an isolated temporary directory.
Inspect the resulting tenant manifest and search hits. Keep the temporary path
if investigating a failure, then remove only that task's files when finished.

```sh
blueprint_store=$(mktemp -d)
bun src/cli.ts put test/fixtures/sales --data "$blueprint_store" --tenant smoke
bun src/cli.ts manifest --data "$blueprint_store" --tenant smoke
bun src/cli.ts query "okf://$blueprint_store?tenant=smoke" search churned
```

## Packaging and release

```sh
bun run build
./dist/langonrock --version
bun scripts/native-smoke.ts
bun scripts/package-smoke.ts
bun scripts/source-smoke.ts
```

Use a build check for packaging changes. [scripts/build.ts](../../../scripts/build.ts)
accepts `--target` and `--outfile`. Darwin output requires macOS and the script's
code-signing repair. [.github/workflows/release.yml](../../../.github/workflows/release.yml)
checks tag/package version agreement, builds six targets, smoke-tests native
targets, and publishes checksums and binaries on a `v*` tag push. Documenting or
building a release does not itself authorize pushing a tag or publishing.
Each executable must be built on the matching OS/architecture so its embedded
addon matches Bun. The package smoke check imports, commits through compiled
MCP, reopens, and verifies from outside the repository. The source-package check
audits the tarball, installs it in a temporary consumer, compiles the C adapter,
and verifies persistence. Package manager network access may be needed.

## Native performance protocol

```sh
bun bench/dbms/run.ts --pairs 10 --output bench/results/dbms/candidate.json
bun bench/dbms/compare.ts bench/results/dbms/candidate.json
bun bench/operations/run.ts --repetitions 10 --output bench/results/dbms/operations.json
bun bench/operations/report.ts bench/results/dbms/operations.json
```

See the [paired protocol](../../../bench/dbms/README.md) and
[additional workloads](../../../bench/operations/README.md). Run sequentially
without competing tests or benchmarks. Do not modify fingerprinted inputs during
capture. All required correctness checks and the final fingerprint check must
pass before `verified` becomes true. Extend inconclusive sizes from 10 to 30
pairs, retaining their original samples. A result that remains inconclusive is
not a pass. Preserve raw JSON bytes, including failed captures; formatting them
breaks combined-capture provenance hashes.

## Blueprint maintenance checks

- Every relative Markdown and HTML link resolves, including anchor fragments.
- Each command in `template.json` has one workflow directory and appears in
  the entry skill and routing matrix. Each workflow's first heading is its
  `langonrock.workflow.<command>` id.
- Workflow contracts contain Goal, Scope, Triggers, Inputs, Invariants,
  Procedure, Outputs, Review gate, and References.
- Each blueprint Markdown source has a linked HTML companion. Skills use
  `README.html`; references, runbooks, and `AGENTS.md` use the same base name.
- HTML pages remain readable without CDN access and support native section
  expansion, keyboard navigation, and a working theme switch.
- Markdown is authoritative. Regenerate companions after source changes and
  compare the rendered text. Do not maintain independent instructions in HTML.

## References

- [Project entry](../SKILL.md)
- [Architecture and invariants](architecture.md)
- [Document workflow](../workflows/document/SKILL.md)
- [Visual HTML version](verification.html)
