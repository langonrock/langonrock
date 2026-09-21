# Architecture

This map describes the code in this repository. [README.md](../../../README.md)
is the user guide. [DESIGN.md](../../../DESIGN.md) records design rationale and
earlier proposals; verify current behavior in source and tests before using it
as an API specification.

## Entry points

| Entry                       | Contract                                                                    | Implementation                                                                                 |
| --------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `langonrock` CLI            | Compile, sync, watch, serve, query, and administer stores                   | [src/cli.ts](../../../src/cli.ts)                                                              |
| `langonrock` package        | Bun-backed `open(dsn)` plus compiler/store exports                          | [src/index.ts](../../../src/index.ts), [connection.ts](../../../src/client/connection.ts)      |
| `langonrock/client` package | Fetch-based `connect(dsn)` with no Bun runtime dependency                   | [client.ts](../../../src/client/client.ts), [remote.ts](../../../src/client/remote.ts)         |
| Shared connection           | Reads, immediate native writes, atomic batches, history, restore, and close | [src/types.ts](../../../src/types.ts)                                                          |
| HTTP daemon                 | `/v1` routes, token-scoped tenants, source access                           | [http.ts](../../../src/server/http.ts), [sourceroutes.ts](../../../src/server/sourceroutes.ts) |
| MCP stdio server            | Six default tools, with opt-in `transact`, `history`, and `restore`         | [mcp/lazy.ts](../../../src/mcp/lazy.ts), [mcp/server.ts](../../../src/mcp/server.ts)           |

## Data flow

```text
Document transactions or explicit Markdown imports
  -> shared frontmatter, ids, links, and compilation
  -> db/transaction, documents, publish
  -> immutable TNT1 + source archive + revision + optional import map
  -> durable authoritative HEAD
  -> db/reader and readcache -> pinned manifest and sliced reads
  -> search/bm25 and search/tenant -> ranked rows using the same pinned reader
  -> connection, HTTP, CLI, MCP

Unmigrated legacy sources
  -> store/writer -> immutable TNT1 + current
  -> legacy reader through the common read cache
```

This is a data-flow outline, not an import graph. The shared connection types
contain no runtime imports. Keep HTTP and MCP behavior in their adapters, and
keep the compiler and storage contracts independent of those protocols.

## Module map

| Area                | Responsibility                                                                      | Start with                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markdown ingestion  | Scan bundles, parse frontmatter, derive shortest unambiguous ids, resolve links     | [scan.ts](../../../src/okf/scan.ts), [ids.ts](../../../src/okf/ids.ts), [links.ts](../../../src/okf/links.ts)                                                                                      |
| Compilation         | Produce sorted TSV, diagnostics, bodies, section names, and tenant-wide ids         | [manifest.ts](../../../src/compile/manifest.ts), [tenant.ts](../../../src/compile/tenant.ts), [sections.ts](../../../src/compile/sections.ts)                                                      |
| Snapshot storage    | Encode/decode TNT1 files, publish snapshots, read slices, invalidate cached readers | [format.ts](../../../src/store/format.ts), [writer.ts](../../../src/store/writer.ts), [reader.ts](../../../src/store/reader.ts), [slice.ts](../../../src/store/slice.ts)                           |
| Source editing      | Validate paths, edit Markdown, register source roots, watch changes                 | [source.ts](../../../src/store/source.ts), [sourcepaths.ts](../../../src/store/sourcepaths.ts), [sources.ts](../../../src/server/sources.ts), [watch.ts](../../../src/store/watch.ts)              |
| Search              | BM25, bounded link expansion, passage offsets, snapshot-keyed indexes               | [bm25.ts](../../../src/search/bm25.ts), [tenant.ts](../../../src/search/tenant.ts), [cache.ts](../../../src/search/cache.ts), [window.ts](../../../src/search/window.ts)                           |
| Transport           | DSN parsing, remote requests, auth grants, HTTP errors, MCP schemas                 | [dsn.ts](../../../src/client/dsn.ts), [tokens.ts](../../../src/server/tokens.ts), [errors.ts](../../../src/server/errors.ts), [server.ts](../../../src/mcp/server.ts)                              |
| Maintenance         | Data directory selection, snapshot collection, platform builds                      | [datadir.ts](../../../src/store/datadir.ts), [gc.ts](../../../src/store/gc.ts), [build.ts](../../../scripts/build.ts)                                                                              |
| Measurement         | Token, retrieval, corpus, and serving benchmarks                                    | [bench/run.ts](../../../bench/run.ts), [bench/ops.ts](../../../bench/ops.ts), [bench/real/](../../../bench/real/)                                                                                  |
| Native transactions | Prepare source changes, validate preconditions, publish complete commits            | [api.ts](../../../src/db/api.ts), [transaction.ts](../../../src/db/transaction.ts), [publish.ts](../../../src/db/publish.ts)                                                                       |
| Native reading      | Pin immutable descriptors, retain request leases, bound caches                      | [reader.ts](../../../src/db/reader.ts), [readcache.ts](../../../src/db/readcache.ts), [writecache.ts](../../../src/db/writecache.ts)                                                               |
| Native history      | Committed ancestry, verified restore, retention, corruption diagnosis               | [history.ts](../../../src/db/history.ts), [restore.ts](../../../src/db/restore.ts), [gc.ts](../../../src/db/gc.ts), [verify.ts](../../../src/db/verify.ts), [repair.ts](../../../src/db/repair.ts) |
| Interchange         | Explicit migration, exact source export, three-way folder import                    | [migration.ts](../../../src/db/migration.ts), [export.ts](../../../src/db/export.ts), [import.ts](../../../src/db/import.ts)                                                                       |
| OS adapter          | Kernel locks, file synchronization, atomic replacement                              | [platform.ts](../../../src/db/platform.ts), [native](../../../native/README.md), [build-native.ts](../../../scripts/build-native.ts)                                                               |
| DBMS evidence       | Frozen paired performance and separate new-operation costs                          | [paired protocol](../../../bench/dbms/README.md), [operations](../../../bench/operations/README.md)                                                                                                |

## Storage boundaries

New and explicitly migrated tenants own their documents. Each immediate
non-hidden directory under an imported source root is a bundle. Optional
`sources.json` entries select folders to import and watch. Native writes need
no source registration. Unmigrated legacy edits still require original sources;
database-only transactions require explicit migration.

```text
<data root>/
  sources.json
  tokens.json
  tenants/<tenant>/
    HEAD                           authoritative native root
    snapshots/<digest>.tnt         compiled snapshot and compressed bodies
    sources/<digest>.src           exact prefixes, source metadata, navigation
    revisions/<digest>.rev         immutable committed ancestry
    imports/<digest>.imp           last-imported folder hashes
    staging/                       unpublished artifacts
    writer.lock                    persistent file, kernel-owned lock
    retention.lock                 coordinates opening and collection
    current                        preserved only for legacy/migrated stores
```

The snapshot contains a 32-byte TNT1 header, an uncompressed manifest, a JSON
directory of offsets and section ranges, and a zstd-compressed body per concept.
File byte offsets differ from the character offsets used by `ConceptSlice`.
The native reader pins its file descriptor under a brief retention lock. The
shared read cache holds at most 16 tenants and keeps request leases alive through
ranking and body retrieval. Eviction or close releases the cache's ownership
without closing active requests. Search indexes also refresh at the evaluation
date boundary so staleness remains current. Writer metadata retains at most one
tenant and has size/count limits; it does not retain decompressed body text.

## Invariants

- Identical ordered input produces identical compiled snapshot bytes. Do not
  put wall-clock values in the compiled read model. Staleness is computed when
  reading a manifest; revision records may contain timestamps.
- Native commits publish complete immutable artifacts before one durable HEAD
  replacement. Validate the expected revision under an OS writer lock. Report
  failures after replacement as indeterminate with the revision identity.
  Never use an age-based takeover of a live native lock.
- Keep history and source archives out of ordinary read initialization. Preserve
  one pinned reader for each whole operation. Collection publishes retained
  ancestry durably before deleting artifacts; live pinned reads remain valid.
- Corrupt committed roots fail closed. Full verification bypasses ordinary read
  caches. Repair requires a deliberate candidate and an exact expected HEAD
  hash, preserves the old head, and never runs automatically.
- Preserve existing TNT1 compatibility when changing the encoder or reader.
  Changes to the on-disk contract need explicit compatibility decisions and
  format/restore coverage.
- Derive ids through the shared compiler rules. A new sibling can change a
  concept's id; source paths and concept ids are not interchangeable.
- Plain Markdown still compiles and emits diagnostics. CLI `--strict` is the
  conformance gate; missing frontmatter is not a universal ingestion failure.
- Validate tenant, bundle, and concept paths before filesystem access. Keep
  tenant identity bound to the selected transport and token grant.
- TCP requires tokens; a non-loopback listener requires TLS. Unix socket
  access uses filesystem permissions. Write access over TCP requires a
  writable grant.
- At the `Connection` boundary, omitted `replaces` asserts creation; replacing
  or deleting one source file checks its current hash. HTTP expresses these
  preconditions through conditional headers. Low-level source helpers do not
  enforce the connection's hash contract. Whole-bundle deletion has a separate
  API and no per-file replacement hash.
- Native `writeSource` and delete operations commit immediately. Native `sync`
  returns the current state without a second revision. Use `transact` to group
  changes. Legacy source editing retains edit-then-sync behavior. Low-level
  Markdown file helpers remain file utilities, not native transactions.
- Import compares the last imported hash, folder hash, and database hash. Refuse
  conflicting changes atomically; retain database-only edits and documents.
  Migration requires originals and quiescent legacy writers, revalidates sources
  before publication, and preserves the legacy checkpoint.
- Keep embedded and remote `Connection` results compatible. The remote-only
  package must not gain a runtime dependency on Bun or the filesystem store.
  Windows named-pipe DSNs parse but opening them is explicitly unsupported.
- Search returns manifest rows with passage positions, not full bodies. Link
  expansion is one hop capped at `k`. MCP `get` applies a default limit of
  15,000 characters per concept; the underlying read API can return full text.
- MCP owns stdout. Send diagnostics to stderr to preserve stdio framing.
- Keep six default MCP tools. Database tools are explicit opt-in. Defer loading
  the MCP SDK until the MCP factory/server is actually used.
- No Python, SQLite, or other database engine in runtime, build, tests, or
  benchmarks. Build the OS adapter directly with the host C compiler. Local
  platform tests do not establish Linux or Windows behavior.
- Preserve the [approved performance limits](../../../docs/tasks/task.dbms-performance.md#workloads-and-limits).
  Freeze capture inputs; retain every sample and inconclusive result. Raw JSON
  captures are immutable because combined evidence hashes their exact bytes.

## References

- [Project entry](../SKILL.md)
- [Verification by affected layer](verification.md)
- [Public usage and protocol](../../../README.md)
- [Historical design rationale](../../../DESIGN.md)
- [Native database operations](../../../docs/dbms.md)
- [Visual HTML version](architecture.html)
