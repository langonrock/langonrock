# Architecture

This map describes the code in this repository. [README.md](../../../README.md)
is the user guide. [DESIGN.md](../../../DESIGN.md) records design rationale and
earlier proposals; verify current behavior in source and tests before using it
as an API specification.

## Entry points

| Entry                       | Contract                                                   | Implementation                                                                                 |
| --------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `langonrock` CLI            | Compile, sync, watch, serve, query, and administer stores  | [src/cli.ts](../../../src/cli.ts)                                                              |
| `langonrock` package        | Bun-backed `open(dsn)` plus compiler/store exports         | [src/index.ts](../../../src/index.ts), [connection.ts](../../../src/client/connection.ts)      |
| `langonrock/client` package | Fetch-based `connect(dsn)` with no Bun runtime dependency  | [client.ts](../../../src/client/client.ts), [remote.ts](../../../src/client/remote.ts)         |
| Shared connection           | Reads, source edits, sync, and close                       | [src/types.ts](../../../src/types.ts)                                                          |
| HTTP daemon                 | `/v1` routes, token-scoped tenants, source access          | [http.ts](../../../src/server/http.ts), [sourceroutes.ts](../../../src/server/sourceroutes.ts) |
| MCP stdio server            | `manifest`, `search`, `get`, `snapshot`, `write`, `delete` | [mcp/server.ts](../../../src/mcp/server.ts)                                                    |

## Data flow

```text
Markdown source directories
  -> okf/scan, frontmatter, ids, links
  -> compile/manifest and compile/tenant
  -> store/writer -> store/format -> immutable .tnt snapshot + current pointer
  -> store/reader and store/cache -> manifest and sliced concept reads
  -> search/bm25, search/tenant and search/cache -> ranked manifest rows
  -> client/connection or server/http -> CLI, remote client, MCP
```

This is a data-flow outline, not an import graph. The shared connection types
contain no runtime imports. Keep HTTP and MCP behavior in their adapters, and
keep the compiler and storage contracts independent of those protocols.

## Module map

| Area               | Responsibility                                                                      | Start with                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markdown ingestion | Scan bundles, parse frontmatter, derive shortest unambiguous ids, resolve links     | [scan.ts](../../../src/okf/scan.ts), [ids.ts](../../../src/okf/ids.ts), [links.ts](../../../src/okf/links.ts)                                                                         |
| Compilation        | Produce sorted TSV, diagnostics, bodies, section names, and tenant-wide ids         | [manifest.ts](../../../src/compile/manifest.ts), [tenant.ts](../../../src/compile/tenant.ts), [sections.ts](../../../src/compile/sections.ts)                                         |
| Snapshot storage   | Encode/decode TNT1 files, publish snapshots, read slices, invalidate cached readers | [format.ts](../../../src/store/format.ts), [writer.ts](../../../src/store/writer.ts), [reader.ts](../../../src/store/reader.ts), [slice.ts](../../../src/store/slice.ts)              |
| Source editing     | Validate paths, edit Markdown, register source roots, watch changes                 | [source.ts](../../../src/store/source.ts), [sourcepaths.ts](../../../src/store/sourcepaths.ts), [sources.ts](../../../src/server/sources.ts), [watch.ts](../../../src/store/watch.ts) |
| Search             | BM25, bounded link expansion, passage offsets, snapshot-keyed indexes               | [bm25.ts](../../../src/search/bm25.ts), [tenant.ts](../../../src/search/tenant.ts), [cache.ts](../../../src/search/cache.ts), [window.ts](../../../src/search/window.ts)              |
| Transport          | DSN parsing, remote requests, auth grants, HTTP errors, MCP schemas                 | [dsn.ts](../../../src/client/dsn.ts), [tokens.ts](../../../src/server/tokens.ts), [errors.ts](../../../src/server/errors.ts), [server.ts](../../../src/mcp/server.ts)                 |
| Maintenance        | Data directory selection, snapshot collection, platform builds                      | [datadir.ts](../../../src/store/datadir.ts), [gc.ts](../../../src/store/gc.ts), [build.ts](../../../scripts/build.ts)                                                                 |
| Measurement        | Token, retrieval, corpus, and serving benchmarks                                    | [bench/run.ts](../../../bench/run.ts), [bench/ops.ts](../../../bench/ops.ts), [bench/real/](../../../bench/real/)                                                                     |

## Storage boundaries

Each immediate non-hidden directory under a tenant's source root is a bundle.
The store's `sources.json` maps tenant names to those source roots. A first
source creation can register a new tenant automatically. Existing snapshots
without a source mapping must be registered with the original source directory
before editing; an empty replacement root would discard knowledge on sync.

```text
<data root>/
  sources.json
  tokens.json
  sources/<tenant>/                 default root for a newly created tenant
  tenants/<tenant>/
    current                        active SHA-256 digest
    snapshots/<digest>.tnt         compiled snapshot
    log.jsonl                      sync log
    lock                           writer lock while held
```

The snapshot contains a 32-byte TNT1 header, an uncompressed manifest, a JSON
directory of offsets and section ranges, and a zstd-compressed body per concept.
File byte offsets differ from the character offsets used by `ConceptSlice`.
Reader and search caches refresh when the current snapshot digest changes.

## Invariants

- Identical ordered input produces identical compiled snapshot bytes. Do not
  put wall-clock values in the compiled read model. Staleness is computed when
  reading a manifest; the sync log may contain timestamps.
- Publish complete snapshot files through temporary files, sync, and rename.
  Replace the `current` pointer atomically under the tenant writer lock. Readers
  use immutable snapshots without taking that lock.
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
- `writeSource` changes source; `sync` publishes the compiled model. MCP `write`
  and `delete` perform the mutation and sync together. Keep that distinction
  when documenting callers of the lower-level connection interface.
- Keep embedded and remote `Connection` results compatible. The remote-only
  package must not gain a runtime dependency on Bun or the filesystem store.
  Windows named-pipe DSNs parse but opening them is explicitly unsupported.
- Search returns manifest rows with passage positions, not full bodies. Link
  expansion is one hop capped at `k`. MCP `get` applies a default limit of
  15,000 characters per concept; the underlying read API can return full text.
- MCP owns stdout. Send diagnostics to stderr to preserve stdio framing.

## References

- [Project entry](../SKILL.md)
- [Verification by affected layer](verification.md)
- [Public usage and protocol](../../../README.md)
- [Historical design rationale](../../../DESIGN.md)
- [Visual HTML version](architecture.html)
