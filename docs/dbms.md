# Native document database

New and explicitly migrated tenants store authoritative Markdown documents in
Langonrock's own engine. The engine uses Bun/TypeScript, immutable files, and a
small project-owned C adapter for OS locks and durable file replacement. It has
no SQL interface, SQLite, external database engine, or Python dependency.

The compiled TNT1 read model, deterministic identifiers, manifest text, and BM25
search semantics remain shared with legacy tenants. Legacy tenants keep their
original source workflow until explicit migration.

## Install and platform verification

Source installation requires Bun 1.4.2 or newer and a C compiler. Windows builds
require an MSVC developer environment. Run `bun run build:native` in a source
checkout, or `bun node_modules/langonrock/scripts/build-native.ts` in an installed
consumer. The adapter builds directly, without node-gyp or downloaded headers.
Installation alone does not require a native build, so applications using only
`langonrock/client` can install the package without Bun or a C compiler.
Standalone release executables embed their native adapter and need no compiler.

Local verification covers macOS arm64 with Bun 1.3.12. Linux and Windows have CI
jobs but have not been executed for this change. Their verification remains an
open release requirement. Killing processes tests crash recovery, not loss of
power or every filesystem's durability behavior.

## Reader and cache lifetime

`open(dsn)` connections release their cached readers through `await close()`.
Direct readers from `openTenant()` should be closed with `reader.close?.()` in a
`finally` block; legacy readers do not own a descriptor. The callable factories
`createReaderCache(root)` and `createSearchCache(root)` both expose `close()`.
Closing a cache rejects new acquisitions and releases its ownership. Existing
reader leases remain usable until their own `close()` calls.

The CLI daemon shares one read cache between HTTP requests and watcher warm-up.
Stopping the server closes that cache. Native MCP writes and deletes return their
transaction's snapshot and diagnostics without a follow-up sync. Legacy tenants
retain source editing followed by recompilation. The six default MCP tools and
the three opt-in database tools remain unchanged.

## Create and edit documents

```ts
import { open } from 'langonrock'

const knowledge = open('okf:///absolute/path/data?tenant=acme')
const first = await knowledge.transact({
  changes: [
    {
      operation: 'write',
      bundle: 'notes',
      path: 'intro.md',
      content: '---\ntype: concept\n---\n# Introduction\nSaved atomically.\n'
    }
  ]
})
const previous = await knowledge.readSource('notes', 'intro.md')

if (previous !== undefined) {
  await knowledge.transact({
    expectedRevision: first.revision,
    changes: [
      {
        operation: 'write',
        bundle: 'notes',
        path: 'intro.md',
        replaces: previous.hash,
        content: `${previous.content}\nUpdated.\n`
      },
      {
        operation: 'write',
        bundle: 'notes',
        path: 'second.md',
        content: '# Second document\n'
      }
    ]
  })
}

await knowledge.close()
```

All changes in a transaction become visible together. Omitted `replaces`
asserts creation. Replacement and deletion require the exact current source
hash. `expectedRevision` optionally also asserts the tenant's current revision.
A conflicting batch publishes nothing. Public batches allow 1–1,000 changes
and at most 16 MiB of source text. Duplicate targets, including case-only
duplicates, are refused.

`writeSource`, `deleteSource`, and `deleteBundle` commit immediately in native
tenants. `sync()` returns the current committed state without creating another
revision. Use `transact()` when several edits must become visible together.
Imports and connection writes share the same compiler; adding a path can change
existing concept IDs. Re-read the manifest after such changes.

A revision identifies a transaction, while a snapshot identifies compiled bytes.
Two source revisions can share a snapshot. Use revision IDs for concurrency,
history, and restore; use snapshot IDs for read-model cache validation.

## History and restore

With an open connection:

```ts
const page = await knowledge.history({ limit: 20 })
const older =
  page.next === undefined
    ? undefined
    : await knowledge.history({ limit: 20, before: page.next })

const current = page.revisions[0]
const selected = older?.revisions[0]

if (current !== undefined && selected !== undefined) {
  await knowledge.restore({
    revision: selected.revision,
    expectedRevision: current.revision
  })
}
```

Pages contain newest revisions first, with a default limit of 20 and a maximum
of 100. Cursors belong to one tenant and committed history. Collection can expire
a cursor; restart pagination after that conflict. An artifact left by a failed
writer is not a committed revision and is absent from history.

Restore verifies the selected revision and publishes its complete source state
as a new transaction. It preserves history and fails if the expected current
revision changed. It cannot restore a pruned revision. Existing tracked import
baselines remain attached to the current database.

## CLI, HTTP, and MCP

```sh
langonrock transact --data ./data --tenant acme --from batch.json
langonrock history --data ./data --tenant acme --limit 20
langonrock restore "$REVISION" --expected-revision "$CURRENT" --data ./data --tenant acme
langonrock query "$DSN" transact --from batch.json
langonrock query "$DSN" history --limit 20
langonrock mcp "$DSN" --database-tools
```

`batch.json` contains the `TransactionRequest` object shown above. Omitting
`--from` reads it from stdin. Local and remote connection APIs expose the same
`transact`, `history`, and `restore` methods. `langonrock/client` uses fetch and
does not import the native adapter or Bun APIs.

| HTTP route                                   | Operation                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `POST /v1/{tenant}/transact`                 | Atomic batch, returning `revision`, `snapshot`, counts, and diagnostics |
| `GET /v1/{tenant}/history?limit=20&before=…` | Retained committed history                                              |
| `POST /v1/{tenant}/restore`                  | Body `{ "revision": "…", "expectedRevision": "…" }`                     |

The existing source, manifest, search, get, and snapshot routes remain available.
Token grants select the tenant and authorize writes. Embedded `serve()` callers
must set `writable: true` or authorize writes through their configured source
callback; the default is read-only. The CLI daemon enables native writes subject
to its existing access controls. Single-source HTTP writes retain their existing
1 MiB body limit. The atomic batch transport limit is 17 MiB, including JSON.

MCP has six tools by default. `--database-tools`, or the factory's third argument
`{ databaseTools: true }`, explicitly adds `transact`, `history`, and `restore`.
Their schema cost is reported separately from document manifest size.

## Import and export

```sh
langonrock import ./sources/acme --data ./data --tenant acme
langonrock watch ./sources/acme --data ./data --tenant acme
langonrock export ./exported-acme --data ./data --tenant acme
```

`import` and `sync <directory>` import a folder of bundles. `put` imports one
bundle. Each location has a persisted map of last-imported source hashes. An
unchanged folder file does not overwrite a database edit. If both versions change
differently, the import fails atomically and the watcher reports the conflict.
Resolve the documents deliberately and retry the import. Database-only documents
remain present. Empty bundles and navigation files survive interchange.

These folder commands and the package-root `put*` helpers target native
ownership. They refuse an unmigrated legacy tenant; migrate it explicitly first.
Configured legacy connection source writes, connection `sync()`, and legacy
watchers continue using their source-folder workflow until migration.

Export writes the pinned current revision to a new directory, preserving exact
frontmatter, Markdown, CRLF, Unicode, nested paths, and navigation files. It
refuses an existing destination. To export an older state, restore the desired
revision first with its expected current revision. Export does not modify the
tracked source folder.

Sources must be valid UTF-8. Byte-order marks are preserved in source storage
and export. Invalid byte sequences and ill-formed Unicode strings are rejected
before publication instead of being silently replaced during decoding.

## Migrate a legacy tenant

Stop its legacy daemon, watcher, writers, and source editors before migration.
Keep a copy of the original source and store directories. Use the same bundle
name and summary width used to compile the legacy tenant.

```sh
langonrock migrate ./sources/acme --data ./data --tenant acme --dry-run
langonrock migrate ./sources/acme --data ./data --tenant acme
langonrock verify --data ./data --tenant acme
```

For a legacy single-bundle source directory, include `--bundle <name>`.
Dry run checks exact compiled read equivalence and source reconstruction without
publishing. Migration checks the legacy pointer and original source hashes again
under the writer lock, then publishes the native root. Repeating a completed
migration reports the existing result. Failure before publication leaves the
legacy store usable; failure around publication requires inspecting the current
root before retrying.

Migration preserves the original Markdown, `current`, and legacy snapshots.
Native collection protects the preserved legacy current snapshot. A `.tnt` file
alone lacks original frontmatter and cannot support lossless migration.

For rollback before any native writes, stop every process and use the preserved
pre-migration store and original folder with the previous executable. Prefer a
separate restored directory to editing database internals. After native writes,
first export the desired native revision and import that export into a fresh
legacy store. Reusing the old `current` alone would discard those new writes.
Validate its manifest and selected source documents before restarting clients.

## Collection, verification, and repair

```sh
langonrock gc --data ./data --tenant acme --keep 10 --dry-run
langonrock gc --data ./data --tenant acme --keep 10
langonrock verify --data ./data --tenant acme
```

Native collection retains ten committed revisions by default. It verifies kept
artifacts, durably publishes the retention boundary, then removes unreferenced
snapshots, archives, revision descriptors, import maps, and staging files.
Readers already holding a snapshot continue to use that revision. Deletion
failures are reported and can be retried. Never remove the persistent lock files
while a store is in use.

`verify` reads stored artifacts independently of the ordinary read cache and
checks source reconstruction, complete snapshot digests, metadata, and retained
ancestry. Corrupt HEADs fail closed. The engine does not silently fall back to
an older revision.

Explicit repair requires a verified candidate and the exact HEAD hash reported
by verification:

```sh
langonrock verify "$REVISION" --data ./data --tenant acme
langonrock repair "$REVISION" --expected-head "$HEAD_HASH" --data ./data --tenant acme
```

Use `--expected-head missing` only when HEAD is absent. Repair preserves the old
HEAD in `recovery/`, verifies the candidate again, and establishes that revision
as the sole retained root. A candidate's validity does not prove it was committed;
the operator must select it deliberately. Preserve the store before repair.

## Storage and failure contract

```text
tenants/acme/
  HEAD
  snapshots/<sha256>.tnt
  sources/<sha256>.src
  revisions/<sha256>.rev
  imports/<sha256>.imp
  staging/
  writer.lock
  retention.lock
```

TNT1 contains compressed concept bodies and the compiled manifest. Source
archives contain exact source prefixes, paths, hashes, and navigation documents,
reusing TNT bodies. Immutable revision records provide history without loading
it during ordinary reads. Import maps load only when an operation needs them.

Preparation happens outside the writer lock. Publication validates its base
revision under a kernel-owned tenant lock, writes and synchronizes all immutable
artifacts, then atomically replaces HEAD and completes the durability barrier.
Readers take a brief retention lock while pinning an immutable snapshot file.
Each search holds the same reader through ranking and body retrieval.

A normal return acknowledges the durable commit. A failure after replacing HEAD
can return `IndeterminateCommitError` with its revision, or HTTP 503 with
`code: "INDETERMINATE_COMMIT"`. Inspect history/current state before deciding
whether to retry. A conflict returns `CONFLICT`; re-read source hashes and the
revision. The engine never automatically replays a conflicted transaction.

Copy the complete tenant directory for backup while writers and collection are
stopped, or use a filesystem snapshot that captures all files consistently.
Copying one `.tnt` is only a compiled-read backup. Restore complete native backups
to a separate directory and run `verify` before serving them.

The engine is local and document-oriented. It does not provide SQL, replication,
cross-tenant transactions, or guarantees for network filesystems. Normal writes
prepare a complete immutable snapshot, reusing unchanged compressed bodies.
Batching related edits avoids publishing a snapshot per document.

See the [performance protocol](../bench/dbms/README.md),
[maintenance measurements](../bench/operations/README.md), and
[performance report](benchmarks/dbms.md) for evidence and remaining gates.
