# Native document DBMS with measured performance limits

Status: implementation delivered locally. Performance acceptance and
Linux/Windows execution remain open.

## Confirmed request

Convert Langonrock into an authoritative document database without repeating the
previous memory, startup, import, and manifest regressions. The user confirmed
the four discovery defaults on 2026-09-21:

- Document CRUD, atomic multi-document transactions, crash recovery, revision
  history, and restore. No public SQL interface or relational query language.
- Multiple reader and writer processes on one machine. Writers may serialize;
  distributed writes and network filesystems are outside this contract.
- No additional manifest tokens; search/get at most 5% slower; memory,
  open/import/edit-to-search at most 10% worse, accounting for measured noise.
- Preserve existing CLI, HTTP, MCP, and client usage where possible. Provide
  Markdown import/export and explicit migration from existing stores.
- Use no Python in the implementation, dependencies, benchmarks, or validation.
- Build Langonrock's own storage engine. Do not use SQLite, another embedded
  database engine, or a database service. This replaces the earlier storage
  proposal following the user's explicit correction.

The user explicitly approved this revised native-engine plan. Proceed through
phases 5–11 without requesting the same approval again.

## Current evidence

- Branch: `feat/SGB`. The working tree was clean before these planning documents.
- Baseline commit: `1cbcc009bd93814d56410ed3473d65c101f97d8d`.
- Local runtime: Bun 1.3.12, macOS arm64.
- `src/compile/manifest.ts` reads Markdown, derives IDs, and compiles bodies.
  `src/compile/tenant.ts` resolves cross-bundle IDs and writes compact TSV.
- `src/store/writer.ts` recompiles and compresses a full immutable TNT1 snapshot.
  `src/store/reader.ts` loads metadata and reads bodies on demand.
- `src/client/connection.ts` checks a source hash and then separately writes the
  file. The hash check and write are not one database transaction.
- `src/search/cache.ts` rebuilds BM25 per snapshot. The compiled format and
  current ranking behavior are the read-performance reference.
- `bench/run.ts` repeats open in one process and mixes initial and repeated
  compilation. `bench/ops.ts` does not verify search visibility in its edit
  round trip. `bench/billing.ts` samples memory after explicit garbage collection.
- `bench/chroma.ts` launches `uv` and `bench/chroma.py`. Neither can remain an
  executable dependency of this solution.
- Existing `.tnt` snapshots do not contain original Markdown frontmatter.
- `src/okf/frontmatter.ts` splits an exact prefix from the otherwise unchanged
  body. Saving that prefix allows source reconstruction from existing body bytes.
- `src/store/lock.ts` steals a writer lock after 30 seconds based on file age.
  That rule is unsafe for an authoritative engine with long-running writers.
- `src/store/atomic.ts` issues one write without checking its returned byte count
  and skips directory synchronization on Windows. The native engine must verify
  full writes and platform-specific publication durability instead of inheriting
  those assumptions.

The frozen baseline now contains ten independent repetitions at 500, 5,000,
and 20,000 concepts. Its 150 workload processes completed before product edits.
The verified `early-bounded-v2` matrix passes every measured row at all three
sizes and preserves every checked whole/bundle manifest, get, section, slice,
find, and search result. Median import changes are -5.56%, -11.59%, and -2.09%;
median edit-to-search changes are -25.81%, -43.99%, and -45.54% at 500, 5,000,
and 20,000 concepts respectively. Import RSS changes are -23.33%, -11.37%, and
+6.30%. The early gate passes for this internal-engine candidate. Raw samples,
source/harness/build fingerprints, and every confidence interval are in
`bench/results/dbms/early-bounded-v2.{json,md}`. The completed DBMS still requires
the final comparison after history and public integration. Earlier failed and
inconclusive captures remain preserved separately.

## Lifecycle position

1. Classification and project rules: complete, using `langonrock implement`.
2. Discovery: complete, with the decisions above.
3. UX design: condition evaluated; no graphical interface is involved.
4. Plan: approved.
5. Feature blueprint: complete.
6. Execute: in progress; the early gate passes, history and integration follow.
7. Tests: pending.
8. Review: pending.
9. Fix loop: pending, at most three review cycles.
10. Blueprint updates: pending.
11. Changelog: pending.

## Proposed storage design

Build a Langonrock-owned engine in Bun/TypeScript around immutable revision
files and atomic publication of one tenant head. Keep the TNT1 compiled read
format and BM25 ranking. The engine owns transactions, source storage, history,
recovery, locking, and collection. No third-party database implements them.

The performance hypothesis is that a small head read and the existing compiled
reader can keep their costs while new source/history data stays on disk. It must
pass the early benchmark before the remaining integrations proceed. Owning the
engine does not itself prove any performance improvement.

### File layout and source representation

```text
tenants/<tenant>/
  HEAD                         versioned, checksummed committed root
  writer.lock                  persistent OS lock target, never age-reclaimed
  retention.lock               coordinates opening readers with collection
  snapshots/<digest>.tnt       existing compiled manifest, directory, and bodies
  sources/<digest>.src         indexed source prefixes, paths, hashes, navigation
  revisions/<digest>.rev       immutable revision metadata and parent reference
  staging/<transaction>/       private preparation, never visible to readers
```

`HEAD` names the revision, source archive, compiled snapshot, format version,
and any retention boundary. A read can locate its `.tnt` file directly from
`HEAD`; it must not walk revision history or deserialize the source archive.
The legacy `current` file remains meaningful only for unmigrated TNT1 stores.

The `.src` format has a bounded, validated header, an indexed directory, and
payload ranges. Each document records its bundle/path, source hash, and either:

- The exact original frontmatter prefix and the concept ID of its body in the
  paired `.tnt` snapshot. Reconstruct source by concatenating prefix and body.
- A standalone payload for navigation files that the compiler does not include
  in `.tnt`. A plain Markdown concept needs no frontmatter prefix.

This source representation uses the compiler's current exact prefix/body split.
It avoids compressing and storing a second complete copy of every concept body.
Do not add source hashes, revision IDs, or transaction metadata to manifest TSV.
Keep unknown frontmatter, malformed YAML, CRLF, Unicode, and empty files exact
within the existing UTF-8 source contract. If a future compiler transforms body
bytes, it must change the storage format or store an explicit original payload.

Each published revision has a complete source mapping paired with a complete
compiled snapshot. Unchanged whole artifacts can be reused by digest. Initially
retain full immutable compiled snapshots per changed revision, as the baseline
does; measure that disk cost openly. Do not introduce a per-document filesystem
object store, a B-tree, or an LSM implementation without benchmark evidence.

Reuse compressed body blocks when an edit leaves them unchanged, with verified
content identity. Compile and compress a changed body only once. Bound temporary
buffers and keep reader metadata, required search indexes, and a bounded cache of
the active writer's metadata live.
Opening for manifest/get/search must not load source payloads or historical data.

The early memory gate required a refinement of preparation. The source archive
retains per-bundle diagnostics; other compiler metadata comes from TNT. A transaction
verifies the base snapshot digest, recompiles affected bundles, and copies verified
compressed blocks for untouched bundles. Global ID and link resolution still run
through the shared compiler, including collisions introduced in another bundle.
When a transaction only replaces existing paths within a bundle, the compiler
reuses unchanged local concepts and diagnostics and parses only changed sources
against the complete existing ID map. Creates and deletes rebuild that bundle
so new ID collisions and previously broken links are resolved normally.
The source directory includes exact body offsets so reading one source does not
construct a second tenant reader. Every committed revision still has complete
standalone `.tnt` and `.src` artifacts; no delta replay or new storage engine is
introduced. Repeated edits may reuse one tenant's committed source directory and
local concept metadata. The cache is populated only after an acknowledged edit,
matches a freshly read revision, and admits at most 50,000 documents with a source
archive of at most 32 MiB. It also retains the compiled reader metadata already
created during that commit, avoiding a second parse on read-after-write. It stores
no decompressed body collection and does not
populate during ordinary import or read-only open. Evicted metadata remains valid
for operations already holding it. Its full RSS is included in the edit benchmark.
These refinements are under benchmark, not yet accepted results.

Keep compiled snapshot digests separate from revision identities. A navigation
file or frontmatter edit can create a revision without changing the compiled
snapshot. IDs, titles, sections, links, ordering, and staleness continue to use
the existing compiler rules.

### Transaction and publication contract

1. Validate tenant, paths, batch size, and duplicate targets before preparation.
2. Pin one committed base revision. Read needed sources and prepare the complete
   candidate `.tnt`, `.src`, and revision descriptor in a private staging directory.
   Never modify a published artifact in place.
3. Acquire the tenant writer lock. Re-read `HEAD` and check the base revision and
   all document hash preconditions under the lock. Any conflict aborts the batch.
4. Write every byte of each prepared artifact, check short writes, flush files,
   publish their immutable names, and durably flush their parent directories
   using the platform adapter. Validate any existing artifact before reusing it.
5. Write and flush a new checksummed `HEAD` to a unique temporary file, atomically
   replace `HEAD`, and finish the required publication flush before acknowledging
   the commit. This is the single publication boundary for every changed document
   and the compiled read model together.
6. Release the writer lock. A request started after an acknowledged commit must
   resolve the new head. Existing requests keep their pinned revision; search
   ranking and body fetch must use that same revision.

No mutable source directory or independent log decides which revision committed.
An immutable `.rev` descriptor records history but is not committed merely
because it exists. Only the published `HEAD` chain determines committed history.
The design uses copy-on-write publication, so it does not require a separate
redo/undo WAL or replay of all past writes on ordinary open.

Serialize competing writers through OS locking and return an explicit conflict
or bounded busy response. Never automatically replay a mutation against changed
source hashes. Cross-tenant batches are rejected.

### Locking and platform durability

Replace the 30-second stale-file rule with a kernel-owned lock on a persistent
file. A paused but live writer must keep ownership; a dead process must release
it through the OS. Do not unlink the lock file while the store exists or reclaim
ownership based on elapsed time, PID reuse, or a guessed heartbeat.

Use `flock` on supported local Unix filesystems and `LockFileEx` on Windows
through a narrow, project-owned platform adapter. These are OS APIs, not database
engines. Their documented handle lifetime and release behavior inform the adapter.
[Linux flock manual](https://man7.org/linux/man-pages/man2/flock.2.html),
[Windows LockFileEx documentation](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex)

The adapter exposes nonblocking lock attempts, release, durable file publication,
and cleanup. Its handles must survive JavaScript GC until explicitly released,
and contention must not block the server event loop. Use a small Node-API C
binding built with the platform compiler and a Bun build script if Bun's stable
filesystem APIs cannot supply these operations. No node-gyp, Python generator,
third-party storage library, or external database process is allowed. Ship the
binding for each existing binary target; users must not need a compiler to run
the released CLI. Verify source-package installation separately.

Do not assume `bun:ffi` is a production-ready shortcut: Bun's documentation
currently marks it experimental and recommends Node-API for stable native
integration. Validate the chosen adapter against the pinned runtime before
building the transaction layer.
[Bun native integration documentation](https://bun.sh/docs/runtime/ffi)

Verify file flush, replacement, and directory-entry durability on each supported
OS, including Windows replacement flags and failure handling. The existing
Windows no-op directory sync is not sufficient evidence of durable publication.
No atomicity or power-loss guarantee may be inferred solely from successful
process-kill tests. Document tested filesystem assumptions and unsupported cases.
[Windows MoveFileExW documentation](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)

### Recovery and integrity

- Before `HEAD` publication, interruption leaves the previous revision committed.
  Private staging and unreferenced prepared artifacts never become visible.
- After durable publication, reopening must resolve the complete new revision.
  Once replacement may have occurred, an error is an indeterminate commit outcome,
  not proof of rollback. Return a transaction/revision identity for inspection;
  never instruct a client to replay the write blindly.
- Check format versions, bounded lengths/offsets, digests, and referenced artifact
  identity. Verify payload integrity on access and offer an explicit full-store
  verification operation; do not hash the entire corpus on every normal open.
  Add optional per-body checksums to the TNT1 directory for new snapshots and
  framed checksums to source records. Keep legacy TNT1 reading compatible; do
  not claim per-body verification when an old file has no stored checksum.
- A malformed committed root or missing committed artifact is corruption. Fail
  with an actionable error rather than silently selecting an older revision and
  losing acknowledged writes. Explicit repair may select a verified revision.
- Reconcile abandoned staging only with proven exclusive ownership. Do not delete
  another process's preparation based on its age. Recovery must be repeatable.

### History, restore, and maintenance

- History is paginated through immutable revision descriptors. Ordinary reads
  do not traverse history. Revisions refer directly to complete source/read roots.
- Restore creates a new revision under the normal transaction protocol after
  checking the caller's expected current revision. It can reuse the retained
  source archive and `.tnt` files without replaying the whole change history.
- GC runs under the same writer serialization as commit. It publishes a durable
  retention boundary before pruning, retains every artifact reachable from kept
  roots, and never makes a retained revision depend on deleted older data.
- Coordinate reader creation with a brief retention lock while reading `HEAD`
  and opening required file handles. Keep those handles through the operation.
  GC must not race that opening window; if Windows refuses removal of an open
  artifact, retain it and report the skipped cleanup rather than forcing deletion.
- Preserve the existing default of ten retained snapshots for explicit GC,
  document its revision mapping, and offer a dry run. Never auto-prune history
  during an ordinary read or write. Include retention and staging bytes in disk
  benchmarks; storage savings are not promised.

## API and compatibility decisions

Keep the current `Connection` type available. Add a `DatabaseConnection` type
that extends it with the following operations, returned by the DBMS-capable
embedded and remote constructors:

```ts
type DocumentChange =
  | {
      operation: 'write'
      bundle: string
      path: string
      content: string
      replaces?: string
    }
  | { operation: 'delete'; bundle: string; path: string; replaces: string }

interface TransactionRequest {
  changes: DocumentChange[]
  expectedRevision?: string
}

interface RevisionResult extends SyncResult {
  revision: string
}

interface HistoryOptions {
  before?: string
  limit?: number
}

interface RestoreRequest {
  revision: string
  expectedRevision: string
}

interface DatabaseConnection extends Connection {
  transact(request: TransactionRequest): Promise<RevisionResult>
  history(options?: HistoryOptions): Promise<RevisionPage>
  restore(request: RestoreRequest): Promise<RevisionResult>
}
```

`RevisionPage` contains bounded revision metadata and an opaque next cursor.
No arbitrary SQL or asynchronous user callback runs inside a transaction.

| Existing behavior                                   | Proposed compatibility behavior                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `writeSource` / `deleteSource` followed by `sync()` | Same signatures and hashes; database writes commit immediately; subsequent `sync()` reports or rebuilds derived state without a duplicate revision |
| Reads return compact manifest rows and slices       | Same schema and output for identical content, options, and evaluation date                                                                         |
| `snapshot()` returns a 64-character content digest  | Preserve compiled digest; expose independent revision identity in new DBMS operations                                                              |
| CLI `compile`                                       | Keep folder-to-manifest compilation without creating a database                                                                                    |
| CLI `put`, `sync <dir>`, and `watch`                | Explicit import operations into database ownership, with tracked import hashes and conflicts instead of silent overwrite of database edits         |
| Source routes                                       | Keep names, hash preconditions, and response formats; operate on stored source documents after migration                                           |
| CLI/HTTP batch and history access                   | Add `transact`, `history`, and `restore`; use the existing tenant grants, request bounds, and TLS rules                                            |
| MCP                                                 | Preserve six default tools; expose new DBMS operations through explicit opt-in tools and report their schema token cost separately                 |
| `langonrock/client`                                 | Continue to use fetch and runtime-free shared types; no `bun:sqlite` or filesystem imports                                                         |
| Existing TNT1 stores                                | Read without implicit migration; reject DBMS-only mutation with actionable migration guidance until migrated                                       |

Immediate visibility of source edits is an intentional behavior change. Callers
that need several edits to become visible together must use `transact()`.
Standalone low-level Markdown helpers remain file utilities; they do not mutate
the authoritative database until an explicit import.

New stores use database ownership. Migration preserves original directories and
legacy snapshots, verifies round-trip source and read equivalence, and publishes
the database only after validation. It requires original sources to recover full
document contents. A `.tnt`-only store remains readable and exportable as compiled
data, but must not be presented as a lossless source/history migration.

Markdown export writes to an explicit target and preserves frontmatter,
navigation files, nested paths, and exact source text. Import/watch maintain a
last-imported mapping: simultaneous folder and database changes produce a
conflict. Exports and imports do not establish a second automatic authority.

## Benchmark contract

### Reproducibility

- Extract the baseline runtime from the pinned commit into a task-owned temporary
  directory. Never reset or switch the user's branch. Execute no old Python tool.
- Use one Bun/TypeScript benchmark runner with narrow baseline/candidate adapters.
  Freeze fixtures, query sets, limits, and protocol before changing product code.
- Generate 500, 5,000, and 20,000 concepts with seed 7 and 500 concepts per bundle,
  giving 1, 10, and 40 bundles. Hash the complete input and operation sequence.
- Use unique temporary directories, fresh child processes, and separate stores.
  Never run a benchmark that deletes an existing `bench/.store` or user source.
- Record commit/source-tree hashes, harness hash, fixture hash, Bun version,
  native-adapter build hash, OS, filesystem, CPU, memory, durability settings,
  and commands in machine-readable JSON.
- Run baseline and candidate sequentially on the same machine, alternating their
  order across paired repetitions. Do not run competing benchmark workers.
- Distinguish fresh-process start from an OS cold filesystem cache. Do not label
  warmed filesystem measurements as cold-disk performance.
- Record every sample, p50, p95, absolute differences, percentage differences,
  and a pass/fail/inconclusive verdict per metric and dataset size.

### Workloads and limits

| Measurement         | Definition                                                                                                                          | Limit                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Initial import      | Empty store to durable, readable committed state; corpus generation excluded equally                                                | +10%                                     |
| Open                | Fresh process to usable reader, with process launch also reported separately                                                        | +10%                                     |
| First search        | Fresh process through index build and verified first result                                                                         | +10%                                     |
| Warm search         | Existing semantics, top-k, expansion, and passage locations; varied fixed queries                                                   | +5%                                      |
| Warm get            | Identical full-body, batched-section, Unicode-slice, and find workloads                                                             | +5%                                      |
| Edit-to-search      | Read hash, edit unique marker, commit/sync, and verify marker through search plus get                                               | +10%                                     |
| Memory              | Whole-process peak and steady RSS for import, read/search, and edit workloads; fixed one/five-tenant cases                          | +10%                                     |
| Manifest            | Whole and per-bundle exact bytes plus existing token estimate at a fixed evaluation date                                            | No increase                              |
| Retrieval           | Exact baseline outputs and ground-truth hit rate/MRR with unchanged queries                                                         | No loss                                  |
| Disk                | Logical and allocated bytes for source + store, including archives/staging/history, before and after equal edit/retention workloads | Report, no agreed percentage cap         |
| New DBMS operations | Atomic batches, contention, history page, restore, recovery                                                                         | Report separately; old equivalent is N/A |

Keep the existing `chars / 4` token estimate clearly labeled; exact manifest
equality provides the stronger no-increase check. Do not treat estimated tokens
as an exact model-token count or hide new MCP schema costs in manifest numbers.

RSS must include native-adapter allocations and all process caches. Measure peaks with
the child runtime's resource accounting after validating units on the current
platform; collect steady RSS at named checkpoints without forced GC. Report
post-GC figures only as an additional diagnostic. For multi-process workloads,
report total simultaneous memory as well as individual peaks.

Start with ten independent paired repetitions and at least 100 timed warm calls
per workload after a fixed warmup. Apply the timing limits to both p50 and p95.
Use a seeded bootstrap of independent process pairs for a 95% ratio interval.
Pass only when its upper bound is within the limit; fail when its lower bound
exceeds it; otherwise mark inconclusive and extend to thirty pairs. If still
inconclusive, the gate remains unresolved. Keep limits and sample rules fixed.
Deterministic content/correctness checks use exact pass/fail results.

Do not compensate for a failed memory/startup/token gate with a gain in another
metric. Do not omit the 20,000-concept case. DBMS-only guarantees get their own
correctness evidence and costs, not misleading before/after percentages.

## Tasks and dependencies

Use `[ ]`, `[/]`, and `[x]` to track execution after approval. New paths below
are intended file targets, not files claimed to exist already.

### T01. Create the approved feature contract

- [x] Complexity: medium. Approved contract created; routing and local links verified.
- Targets: `skills/langonrock/workflows/dbms/SKILL.md` and its `README.html`,
  `skills/langonrock/SKILL.md`, `skills/langonrock/template.json`,
  `skills/langonrock/reference/routing-matrix.md`, matching HTML companions,
  and `AGENTS.md` / `AGENTS.html` navigation where needed.
- Capture native-engine authority, the publication boundary, no-Python constraint,
  benchmark gate, compatibility changes, and migration rules.
- Verify routing consistency, links, matching manuals, and touched formatting.

### T02. Build and freeze the before/after benchmark

- [x] Complexity: complex. Baseline captured: 30 repetitions, 150 isolated workloads.
      Protocol 2 now verifies source/build/harness fingerprints, process startup,
      topic-based retrieval checks, complete bundle manifests, strict workload
      validation, and cross-process latency tails. The separate maintenance protocol
      verifies batches, contention, history, restore, recovery, equal retention disk,
      and default/opt-in schema costs. Final candidate acceptance remains under T09.
- Targets: `bench/dbms/{run,worker,protocol,fixtures,metrics,compare}.ts`,
  `bench/dbms/adapters/{legacy,current}.ts`, `bench/dbms/README.md`,
  `bench/results/dbms/`, `test/benchmark.test.ts`, `package.json`,
  `tsconfig.json`, and `.gitignore`.
- Reuse the seeded corpus generator, but supply isolated roots and explicit
  fixture/query hashes. Include benchmark code in TypeScript checking.
- Validate adapter equivalence by comparing the unmodified revision with itself.
  Run repeatability checks and archive all three baseline sizes before product
  changes. Test comparator boundaries, missing metrics, and incorrect outputs.
- Verify using proposed `bun run bench:dbms -- --before <revision> --after <path>`
  and `bun test test/benchmark.test.ts`; record exact final command syntax.

### T03. Enforce dependency constraints

- [x] Complexity: small. Dependency guard, Python comparator removal, and clean
      frozen-lockfile installation passed locally without Python.
- Targets: `bench/chroma.py`, `bench/chroma.ts`, benchmark documentation,
  `scripts/check-runtime-dependencies.ts`, `package.json`,
  `test/runtime-dependencies.test.ts`, CI.
- Remove the old Python-backed comparator instead of silently substituting
  another Chroma implementation. Third-party comparisons are outside this task.
- Add a focused check for Python scripts, Python package manifests, Python
  subprocesses, and dependencies/install hooks requiring Python. Historical
  prose references do not constitute a runtime dependency or an executable recipe.
- Verify clean install/build/test/benchmark paths use no Python; inspect the
  dependency lock and install scripts, not just top-level package names.
- Check imports and runtime dependencies for external storage engines. In
  particular, `bun:sqlite` is forbidden even though it needs no package entry.

### T04a. Validate the platform adapter

- [/] Complexity: complex. Local macOS lock, flush, and standalone addon checks
  pass. Linux and Windows execution remains unverified. Depends on T02 and T03.
- Targets: `src/db/platform.ts`, `native/store_platform.c`, `native/README.md`,
  `scripts/build-native.ts`, `scripts/build.ts`, `package.json`,
  `.github/workflows/{ci,release}.yml`, `test/platform.test.ts`,
  and `test/helpers/lock-worker.ts`.
- Establish nonblocking OS locks and durable publication using a small Node-API
  binding if stable Bun APIs do not cover them. Build directly with native
  compilers and Bun orchestration, without Python or node-gyp. Keep this code out
  of the remote-only package. Account for source installs and all binary targets.
- Verify mutual exclusion across processes, lock release after forced exit,
  live-writer ownership beyond 30 seconds, short-write handling, interrupted
  publication, native-handle cleanup, and the compiled CLI loading its adapter.
- Run each OS-specific behavior on that OS through the existing CI matrix.
  Unsupported or unverified behavior remains a blocker, not permission to use
  an unsafe stale-file fallback or silently drop a supported platform.

### T04. Implement compiler input and native file formats

- [x] Complexity: complex. Native formats, exact source reconstruction, compiled
      read parity, metadata limits, Unicode/BOM behavior, and invalid compile settings
      have regression coverage. Platform execution limits remain under T04a.
      Depends on T04a.
- Targets: `src/compile/manifest.ts`, `src/compile/tenant.ts`,
  `src/compile/documents.ts`, `src/okf/frontmatter.ts`,
  `src/db/{format,sourcearchive,documents,head}.ts`,
  `src/store/{format,reader}.ts`, `test/db.test.ts`,
  `test/sourcearchive.test.ts`, compiler and format tests.
- Extract shared compilation from folder I/O without duplicating ID/link rules.
  Add versioned/checksummed native formats and lazy source access. Preserve exact
  source prefixes and reuse compiled bodies instead of storing full text twice.
  Keep TNT1 compatibility and identical manifests. Route native and legacy heads
  explicitly; do not allocate all source metadata during ordinary read-only open.
- Verify unknown-format rejection, truncated headers, out-of-bounds offsets,
  checksum mismatches, deterministic output, exact frontmatter/CRLF/Unicode round
  trips, navigation files, cross-bundle collisions, and unchanged get results.

### T05. Implement atomic commit and early performance check

- [x] Complexity: complex. Atomic publication and forced-exit tests pass locally.
      The verified `early-bounded-v2` matrix passes every early performance row at
      500, 5,000, and 20,000 concepts. Cross-platform and final integrated verification
      remain under T04a/T09. Depends on T04.
- Targets: `src/db/{transaction,publication,recovery,errors}.ts`,
  `src/store/{writer,cache,lock,atomic}.ts`, `src/search/cache.ts`,
  `test/{transaction,concurrency,recovery}.test.ts`, `test/helpers/db-worker.ts`.
- Implement precondition checks under OS lock, private staging, artifact flushes,
  atomic HEAD publication, bounded contention, and pinned reader/index ownership.
  Batch initial import into one transaction. Do not retain duplicate full source
  and body representations after preparation or eager-load history on open.
- Verify lost-update prevention, batch abort, independent-process writers,
  read consistency, prepared-artifact failures, and reopen after process kills
  before/after each publication step. Verify indeterminate-outcome reporting,
  repeated recovery, and fail-closed behavior for corrupted committed roots.
- Run the benchmark at all three sizes before transport integration. Investigate
  and fix gate failures within this design. A storage redesign must update the
  plan; do not loosen limits or continue on the assumption it will improve later.

### T06. Add history, restore, and safe collection

- [x] Complexity: complex. History, verified restore, durable collection,
      full retained-store verification, and explicit repair pass 32 focused tests.
      Forced process exits cover each collection publication boundary and deletion.
      Pinned readers survive collection; repeated collection preserves restore.
      Platform execution limitations remain under T04a. Depends on T05 passing.
- Targets: `src/db/{history,restore,gc}.ts`, `src/store/gc.ts`,
  `src/store/reader.ts`, `test/{history,restore,gc,recovery}.test.ts`.
- Implement bounded history pages, restore-as-new-commit, durable retention
  boundaries, archive/snapshot collection, and reader/artifact lifetime management.
- Verify restore across creates/deletes/renames, stale expected revisions,
  source-only revisions, collection with active readers/writers, and interrupted
  GC recovery. Retained history must remain restorable after repeated collections.

### T07. Integrate clients and transports

- [x] Complexity: complex. Embedded, HTTP/client, CLI, and opt-in MCP database
      operations pass seven new integration tests and 155 existing transport tests.
      Request leases preserve one reader through ranking and body fetch, including
      concurrent publication and GC. Full-package checks remain under T09.
      Depends on T05 and T06.
- Targets: `src/types.ts`, `src/index.ts`, `src/client/{connection,remote,client}.ts`,
  `src/server/{http,sourceroutes,dbmsroutes,errors}.ts`,
  `src/mcp/{server,dbms}.ts`, `src/cli.ts`, `src/commands/dbms.ts`.
- Add the DBMS connection contract and transport adapters. Preserve existing
  response shapes, token grants, path validation, TLS checks, and MCP stdout.
  Extract only command code needed to keep new functions within lint limits.
- Targets for verification: `test/{connection,client,connector,source,bundle,join,
token,tls,mcp,cli}.test.ts` and new `test/dbms-transports.test.ts`.
- Verify embedded/HTTP/MCP parity, batch auth and bounds, atomic preconditions,
  idempotent sync, six default MCP tools, opt-in DBMS tools, and client packaging
  without Bun runtime or native-adapter dependencies.

### T08. Implement explicit migration and Markdown interchange

- [x] Complexity: complex. Explicit migration, exact export, tracked imports,
      and watcher conflicts are implemented. Focused suites and the full suite cover
      crash boundaries, source revalidation, separate tenants, retained legacy data,
      empty bundles, and round trips. Depends on T06 and T07.
- Targets: `src/db/{migration,import,export}.ts`, `src/store/watch.ts`,
  `src/server/sources.ts`, `src/commands/dbms.ts`,
  `test/{migration,interchange,watch}.test.ts`.
- Add migration dry run, validated publication, repeat-run behavior, exact source
  export, and tracked folder import/watch conflicts. Preserve original data.
- Verify interruption before/after publication, missing original sources,
  legacy read-only snapshots, navigation documents, conflicting external edits,
  and independent-tenant migration. Require a quiescent legacy writer during
  migration and revalidate source hashes before publishing.
- Document rollback using the preserved legacy store before any DBMS writes;
  after new DBMS writes, export the desired revision before returning to legacy
  operation so rollback does not silently discard new documents.

### T09. Complete correctness and performance verification

- [/] Complexity: complex. Type checking, lint, formatting, dependency guard,
  local build, standalone native smoke, and compiled CLI/MCP package smoke pass.
  All 549 tests pass with 96.07% line and 96.87% function coverage. The isolated
  source-package install/build/persistence check passes. The final frozen paired
  comparison has thirty pairs per size: 109 metrics pass and five remain
  inconclusive. All thirty maintenance repetitions pass with matching source
  fingerprints. Linux/Windows execution remains unverified.
  Depends on T03 through T08.
  Radioactive phase 7.
- Targets: affected tests, `bench/results/dbms/`, and this task's evidence record.
- Run `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun test`,
  `bun run build`, and `./dist/langonrock --version`.
- Maintain 85% line/function coverage and all existing lint limits. Add meaningful
  crash/conflict tests; killing a process does not prove power-loss durability.
  Record durability configuration and limits of local crash testing explicitly.
- Rerun the full before/after matrix, including history retention and five-tenant
  memory. Keep raw JSON and generate a Markdown report with every verdict.
- Exercise the existing Linux/macOS/Windows CI matrix. Report local macOS results
  separately from CI results; do not claim platforms that have not run.

### T10. Review and fix

- [x] Complexity: medium. Two review/fix cycles pass the full suite and build.
      No remaining blocker/high code finding. Implementation commit: `6c3a94b`.
      Performance acceptance remains inconclusive under T09.
      Depends on T09. Radioactive phases 8 and 9.
- Targets: all changed files, this plan, and `walkthrough.md`.
- Run the strict code-quality review, recording severity, evidence, and fixes.
  Resolve all blocker/high findings and reverify affected behavior, at most
  three review cycles. Unresolved findings or failed performance gates prevent
  completion. Commit only the task's changes using Conventional Commits.

### T11. Update contracts, manuals, and release notes

- [x] Complexity: medium. Operations, migration/rollback, architecture, packaging,
      final result tables, manuals, and commit-derived release notes are complete.
      See the [performance report](../benchmarks/dbms.md) and
      [release notes](../../walkthrough.md#release-notes).
      Depends on T10. Radioactive phases 10 and 11.
- Targets: `README.md`, `DESIGN.md`, `docs/dbms.md`, `docs/benchmarks/dbms.md`,
  `skills/langonrock/reference/{architecture,verification}.md`,
  the DBMS workflow, matching blueprint HTML companions, `walkthrough.md`,
  this task file, and root navigation if rules changed.
- Replace the Markdown-authority rule for migrated/new stores, retain accurate
  legacy instructions, document immediate commits and import conflicts, and
  publish actual benchmark deltas with limitations and failed/inconclusive rows.
- Generate customer-facing Features/Fixes/Improvements release notes from the
  task commits. Commit final documentation so the task leaves a clean working
  tree without staging unrelated work. No push or publication is included.

## Completion requirements

- [x] Authoritative document CRUD and atomic multi-document transactions.
- [x] Langonrock-owned engine with no embedded or external database dependency.
- [/] Multi-process concurrency and crash recovery pass on macOS arm64;
  Linux/Windows execution remains unverified.
- [x] Paginated history, complete-source restore, and safe retention.
- [x] Preserved existing usage plus documented intentional behavior changes.
- [x] Explicit migration and lossless Markdown import/export where sources exist.
- [x] No Python execution or dependency anywhere in the delivered workflow.
- [/] Frozen before/after evidence has thirty pairs at each size. All point
  estimates fit the limits, but five confidence intervals cross them, so the
  agreed performance gate remains unresolved.
- [/] Local tests, coverage, build, and code review pass without weakened
  thresholds; five performance confidence gates and platform execution remain open.
- [x] Updated feature contract, manuals, review record, and changelog.

## References

- [Decision log](../../walkthrough.md)
- [Project implementation workflow](../../skills/langonrock/workflows/implement/SKILL.md)
- [Architecture](../../skills/langonrock/reference/architecture.md)
- [Verification](../../skills/langonrock/reference/verification.md)
- [Bun native integration](https://bun.sh/docs/runtime/ffi)
- [Linux flock](https://man7.org/linux/man-pages/man2/flock.2.html)
- [Windows LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex)
- [Windows MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)
