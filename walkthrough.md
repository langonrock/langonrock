# DBMS conversion decision and verification record

## Status

Radioactive phases 1 and 2 are complete. Phase 3 was evaluated and does not
require UI work. The revised native-engine plan was explicitly approved. Phase 5
is complete. Phase 6 implementation is complete. Phase 7 has passed local
correctness, coverage, build, and packaging checks. The final thirty-pair
comparison has 109 passing metrics and five inconclusive metrics. All thirty
maintenance repetitions pass; Linux and Windows execution remains unverified.
Review corrections are included in the measured candidate. Open verification
gates prevent release approval.

Phases 8 and 9 completed two local review/fix cycles. Phase 10 updated the
contracts and manuals. Phase 11 generated the release notes below from local
implementation commit `6c3a94b`. No push, release, or deployment was performed.
The task is delivered for review, with performance and platform acceptance
explicitly incomplete.

## Integrated correctness and packaging

- All 549 tests pass on macOS arm64 with Bun 1.3.12. Coverage is 96.07% lines
  and 96.87% functions. Type checking, lint, formatting, dependency checking,
  compilation, version output, and the standalone native-adapter check pass.
- The compiled CLI smoke test runs outside the repository. It imports original
  Markdown, reopens the native store, starts the deferred MCP implementation,
  exposes nine tools through explicit opt-in, commits a document, reads its exact
  source through a new process, and verifies the store.
- Explicit migration verifies original sources again while holding the writer
  lock. Tests cover source changes during preparation, an active legacy writer,
  forced exits before and after HEAD replacement, repeat migration, and separate
  tenants. Original source files and the legacy current snapshot remain intact.
- Tracked import/watch tests cover concurrent folder/database edits, deletion,
  unchanged folder files after database edits, database-only documents, exact
  Markdown export, empty bundles, and summary-width changes.
- Raw capture JSON is excluded from automatic formatting. Combined evidence
  records the exact hashes of its input captures, so reformatting those files
  would invalidate their provenance. This exception does not change code lint,
  test coverage, or benchmark acceptance limits.
- Linux and Windows execution remains unverified. The CI matrix includes native
  compilation and package smoke checks; local macOS results do not establish
  other platform behavior or power-loss durability.

## Integrated performance and preflight corrections

The final [performance report](docs/benchmarks/dbms.md) and
[complete comparison](bench/results/dbms/final-acceptance-combined.md) use thirty
independent pairs per size. Every point estimate fits its budget, but five 95%
ratio intervals cross the limit. The unresolved rows are 500-concept import p95,
import-process startup p95, and open p50; and 20,000-concept open p95 and first
search p95. They remain inconclusive. No samples were removed. All 5,000-concept
rows pass. Exact manifest/read/retrieval comparisons pass at every size.

At 20,000 concepts, import p50 is 6.21% faster, warm search p50 23.86% faster,
get p50 57.49% faster, and edit-to-search p50 46.13% faster. Import peak RSS is
3.64% higher; open/read/edit/five-tenant RSS are lower. Open p95 is 8.39% slower
at its point estimate, with a 1.0111–1.3460 ratio interval. Those gains do not
close the unresolved gate. The following captures document earlier code versions.
Their Markdown reports are in `bench/results/dbms`; only the baseline and final
acceptance raw captures are committed.

`final-integrated-v2.json` contains ten paired runs at every size after transport,
history, and tracked-import integration. Four timing rows were inconclusive,
with no failures. The original samples were retained and supplemented with twenty
more pairs at 500 and 20,000 concepts. `final-integrated-combined.json` records
the exact hashes of those three captures and passes their provenance checks.

The combined comparison has one unresolved row: 500-concept open p95. Its point
estimate is +9.85%, with a 95% ratio interval of 0.8868–2.6989. A 10.047 ms
candidate open outlier remains in the data. It was not discarded or classified
as a pass. Other rows pass, including all 20,000-concept rows. These captures
precede the source-fidelity and packaging corrections below and are not the
final candidate's acceptance evidence.

The native store also uses more disk after ten edits. At 20,000 concepts the
first paired run records 477,392,896 allocated native-store bytes versus
244,215,808 legacy-store bytes, with the same 84,705,280 allocated source-folder
bytes. Exact source history is additional retained data. There is no agreed disk
cap, and this increase must remain visible in the final report.

The additional operation benchmark passed a one-repetition, 500-concept pilot.
It verifies 25-document batches, two history pages, restore, competing prepared
writers, pinned reads, interrupted publication, recovery, full retained-store
verification, and equal-work disk collection. Its MCP schema probe records 6,869
JSON bytes / 1,718 estimated tokens for six default tools and 8,911 bytes / 2,228
estimated tokens with three opt-in database tools. These estimates use
characters divided by four and exclude tenant-specific advice text.

Preflight corrections before the final candidate freeze:

| Severity | Finding                                                                                                                                                      | Resolution and evidence                                                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blocker  | Normal text decoding discarded a leading UTF-8 BOM and silently replaced invalid bytes; body decoding could also lose a BOM and break source reconstruction. | Four regression cases failed before the fix. Native imports, HTTP source access, CLI input, archive reconstruction, and body decoding now preserve BOMs. Invalid UTF-8 and ill-formed Unicode are rejected. All 29 focused interchange/migration/transport tests pass. |
| High     | Source tarballs included the host's compiled addon, and the install hook required a native build even for remote-only consumers.                             | Package files now include C/header sources only. Native compilation is explicit. An isolated tarball install, native build, transaction, and reopen pass.                                                                                                              |
| High     | TNT1 encoding lacked an explicit guard against offsets exceeding its 32-bit format.                                                                          | The encoder rejects oversized snapshots before allocation/publication; a synthetic-size regression avoids a multi-gigabyte test allocation.                                                                                                                            |
| Medium   | Cached writer metadata matched only the revision ID and did not cap compiled metadata bytes.                                                                 | Cache identity includes artifact digests/checksums, and retained directory/manifest bytes are bounded. Corrupt-root cache bypass has a regression test.                                                                                                                |
| Medium   | Revision/import records and verification HEAD reads allocated entire files before enforcing format limits.                                                   | Metadata reads are bounded before decoding; decoded temporary buffers are released. An oversized-root test fails before reading the full file.                                                                                                                         |
| Medium   | Invalid history cursors were returned as generic missing-resource errors; malformed JSON error bodies could hide remote HTTP context.                        | Invalid cursor errors map to HTTP 400, source hash syntax is validated at the HTTP boundary, and remote errors retain their HTTP status when JSON details are malformed.                                                                                               |

The full suite, build, standalone executable, compiled CLI/MCP, and isolated
source-package install/build/persistence checks pass after these corrections.

## Strict review and fix cycle

The review covered tracked changes and new engine, native, benchmark, test,
packaging, transport, and documentation files. It traced publication and cleanup
errors, cache ownership, metadata validation, source fidelity, migration,
retention, transport authorization, and evidence provenance. Existing lint
limits remain unchanged. New engine modules remain below 300 lines; the CLI
remains below 1,000. Shared source compilation avoids a second identifier/link
implementation. The remote client has no Bun/native imports.

| Severity | Finding                                                                                                                                                                                                | Fix and verification                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Initial import and migration accepted invalid summary widths and could publish revision metadata rejected on reopen. An empty concept set could hide the problem from migration's manifest comparison. | Shared validation now runs during native preparation. Initial import and empty-tenant migration regressions failed before the fix and pass afterward; valid width zero remains supported.                                                                                                                |
| High     | A writer-lock release error could overwrite an indeterminate publication error or turn a durable commit into an error without its revision identity.                                                   | Cleanup preserves a pending publication failure. A release failure after successful publication returns `INDETERMINATE_COMMIT` with that revision. Three fault-injection tests failed before the fix and pass afterward.                                                                                 |
| Medium   | Benchmark output paths could overwrite archived evidence, and a protocol-2 capture without an explicit completion marker could be compared.                                                            | Runners refuse existing outputs. Comparison requires `verified: true`; combination checks provenance and retains all samples. Regression tests cover preservation and completion-marker enforcement.                                                                                                     |
| Medium   | Imported empty bundles could not be deleted, and an unrelated tracked import could recreate a bundle deleted in the database.                                                                          | Bundle deletion now commits the remaining bundle set. Import reconciliation preserves database-side bundle deletions until the folder independently removes/recreates the bundle or adds a document. Both regressions failed before the fix and pass afterward, including restore of the deleted bundle. |

Two fix cycles resolved these findings. All 549 tests pass with 1,336 assertions;
build, lint, types, formatting, dependency checks, and both packaging smokes pass.
The seven new failure-path tests were observed failing before their fixes. The
re-review found no remaining blocker/high code finding. Performance acceptance
and cross-platform execution are separate open gates, not approved by this code
review. Code review verdict: **APPROVED**. Local implementation commit: `6c3a94b`.
Performance verdict: **INCONCLUSIVE**, with five open
rows after the planned thirty-pair limit.

The interrupted `final-reviewed-v2.json` capture is explicitly unverified and
excluded from acceptance. Its runner was stopped before the bundle fixes.
The fresh acceptance pipeline starts at ten pairs and automatically adds twenty
for each inconclusive size. It never deletes or overwrites an earlier capture.
The 12 HTML manuals pass browser checks for offline styles, navigation, theme,
section controls, and desktop/mobile widths. The new workflow's long heading
was corrected after the mobile check exposed overflow.

The final `operations-acceptance-v1` capture is verified at ten repetitions per
size and matches the paired comparison's source/native fingerprints. It covers
batch commits, competing processes, pinned readers, history, restore, interrupted
publication/recovery, full verification, and equal-work retention. At 20,000
concepts, total retained allocated disk including original sources rises from
306,720,768 to 518,946,816 bytes, about 69%. Default/opt-in MCP schemas remain
six/nine tools and 1,718/2,228 estimated tokens. The final report includes these
costs separately from the unchanged document manifests.

## Release notes

The standalone [changelog](CHANGELOG.md) includes before/after tables, gains,
regressions, current connectors, upgrade notes, and open release requirements.

Unreleased native DBMS changes, derived from commit `6c3a94b`. Local correctness,
build, packaging, and documentation checks pass. Five performance confidence
gates and Linux/Windows execution remain open; this is not release approval.

### Features

- Commit document creates, replacements, and deletions atomically. Successful
  native writes are immediately searchable without a separate sync step.
- Browse retained history, restore a previous state as a new revision, collect
  old data, verify a store, and explicitly select a verified repair candidate.
- Use database operations through the CLI, HTTP client, embedded connection, or
  opt-in MCP tools. Migrate legacy stores explicitly and exchange exact Markdown
  through tracked imports and exports.

### Fixes

- Preserve frontmatter, CRLF, Unicode, byte-order marks, and navigation documents
  in source round trips. Reject invalid UTF-8 before committing it.
- Abort a whole conflicting batch and keep readers on one committed revision
  through concurrent writes and collection. Ambiguous commit errors retain the
  revision identity needed to inspect the outcome.
- Delete empty imported bundles, preserve database-side deletions through
  unrelated folder edits, and restore their earlier state from history.

### Improvements

- At 20,000 concepts, measured median import time falls 6.21%, warm search time
  23.86%, and edit-to-search time 46.13%. Manifest growth is zero. Import peak
  RSS rises 3.64%; retained allocated disk including originals rises about 69%.
  The [full report](docs/benchmarks/dbms.md) includes every inconclusive row.
- Keep six MCP tools by default. Three database tools are opt-in and add 510
  estimated schema tokens, measured separately from document manifests.
- Build the native adapter without Python or an external database engine.
  Remote-only consumers need no native build. Source consumers build the adapter
  explicitly; standalone binaries embed it. Benchmarks now use Bun throughout.

## Confirmed decisions

The user confirmed the discovery defaults on 2026-09-21:

- Make the database authoritative for documents, with CRUD, atomic transactions,
  crash recovery, revision history, and restore. Do not add a public SQL interface.
- Support multiple reader/writer processes on one machine.
- Require zero manifest token growth, at most 5% search/get regression, and at
  most 10% memory/open/import/edit-to-search regression, considering measured noise.
- Preserve existing CLI/HTTP/MCP/client usage where possible; provide Markdown
  import/export and explicit migration.
- Use no Python, including dependencies, benchmark tooling, and validation.
- Build a Langonrock-owned storage engine. The user explicitly rejected SQLite
  and other existing database engines when reviewing the initial plan. Use no
  database engine or service as a dependency.

The user explicitly approved the revised native-engine implementation plan.

## Repository findings

The baseline is commit `1cbcc009bd93814d56410ed3473d65c101f97d8d` on `feat/SGB`.
The initial working tree was clean. Current ownership is Markdown sources plus
immutable compiled TNT1 files. Existing source hash checks and file writes are
separate operations. The read model and BM25 behavior should be preserved while
the database adds transactional ownership.

The current benchmark needs fresh-process isolation, separate import/reuse
timings, peak and steady RSS, and an edit-to-search assertion. Existing token
counts are estimates. The Chroma comparator launches Python and must be removed
from the delivered executable workflow.

Local inspection reports Bun 1.3.12 and macOS arm64. The compiler preserves
body text exactly after removing a frontmatter prefix, allowing original source
reconstruction from that prefix and the existing compressed body. The current
30-second writer-lock takeover and unchecked single file write need replacement
for native-engine transaction guarantees. Platform durability requires evidence
beyond the existing Windows directory-sync no-op.

## Original proposed design

Build the storage engine in Bun/TypeScript using immutable files and a single
published `HEAD`. Keep TNT1 artifacts and existing BM25 retrieval. A companion
source archive stores exact prefixes, paths, hashes, and navigation files, reusing
compiled bodies instead of duplicating full source text. Small immutable revision
descriptors provide history without loading it during ordinary reads.

Use OS locks and durable file publication through a narrow project-owned adapter.
The proposal includes a small native binding built without Python if stable Bun
APIs do not cover those operations. Validate it across the existing platforms
before building the commit protocol. No database library supplies transactions,
locking, recovery, history, or storage.

Persist complete revision artifacts, then atomically replace and durably flush
the committed head. Keep preconditions under the writer lock and pin one revision
per read. Test every interrupted publication boundary, short writes, long-lived
writers, corrupt committed roots, and indeterminate commit outcomes.

Existing write method signatures remain, but successful DBMS writes immediately
commit. A subsequent `sync()` remains valid without duplicating the commit.
Batch callers use an explicit transaction operation. Migration requires original
sources for lossless recovery; old snapshots alone cannot recover frontmatter.

At plan approval, this design was a proposal without performance evidence.

## Initial planning and early evidence

- [Implementation plan](docs/tasks/task.dbms-performance.md)
- Revised planning verification: Prettier passed for both documents and all five
  local Markdown links resolve. Product files and dependency manifests are unchanged.
- Baseline capture: complete at all three sizes with ten independent repetitions,
  saved in `bench/results/dbms/baseline.json` before any product edits.
- Benchmark self-check: identical manifest/get/search outputs for two paired
  500-concept runs of the frozen revision. Comparator tests, lint, and types pass.
- Implementation: native platform binding, source archive, checksummed root,
  compiler input extraction, pinned readers, and atomic publication implemented.
- Focused verification: transaction conflicts, exact UTF-8 source reconstruction,
  seven forced-exit boundaries, independent-process writers, corrupt roots,
  body/source checksums, and short writes pass locally on macOS arm64.
- Early performance gate: ten paired runs at 500 concepts still fail import
  at +19.88% and median edit-to-search at +15.96%. Read outputs match exactly.
  Memory remains within budget in this small case. No integration gate has passed.
- Diagnostics with two repetitions were used to find bottlenecks. The second
  diagnostic run overlapped implementation edits and is not frozen evidence.
- Platform CI is configured for native compilation without Python. Linux and
  Windows results are unverified; local tests do not establish power-loss safety.
- Severity-ranked review and fix history were pending at this stage; see the
  [completed code review](#strict-review-and-fix-cycle).
- Blueprint updates and customer-facing changelog follow implementation.

## Implementation findings in execution order

- `Bun.file(fd).slice()` did not preserve correct descriptor reads in the pinned
  reader regression test on Bun 1.3.12. Explicit positional `node:fs` reads now
  keep a reader on its opened immutable file. Both the old and new reader are
  exercised across publication.
- Bun requires direct `require()` for Node-API addons, including executable
  embedding. The adapter has one documented lint exception for that loader.
- Native snapshots add checksums outside the manifest and use compression level
  one. Edits recompile affected bundles. Unchanged bundles reuse compressed
  blocks only after verification of the complete base snapshot digest.
- A ten-pair 5,000-concept trial with concurrent bundle loading measured import
  at +5.89% and edit-to-search at -29.26%. Writer RSS still failed at +35.93%.
  Import RSS was inconclusive. These are intermediate results, not acceptance.
- A bounded cache now reuses committed source and local concept metadata for
  the active writer. Every lookup checks the current revision. Source bodies
  remain on disk; the cache is neither populated by import nor ordinary reads.
- The cache also reuses the committed reader directory and manifest. Archive
  leases protect concurrent source reads while eviction frees obsolete buffers.
  A regression test holds two leases across a replacement and verifies that
  bytes remain valid until both readers release them.
- A later ten-pair 5,000-concept trial measured import +7.16%, import RSS +9.00%,
  and edit RSS +12.23%, all statistically inconclusive. Edit-to-search was
  -38.21% at p50 and -27.26% at p95. The early gate still has not passed.
- Explicit buffer ownership now releases temporary decompression buffers,
  completed body-read regions, and obsolete search posting arrays. Compression
  reuses a bounded UTF-8 scratch buffer. No forced collection is used.
- Existing HTML manuals retain their original layout and styles; only the DBMS
  route and authority rule change. The new workflow has its own HTML companion.
- Replacement-only transactions now compile only changed sources against the
  complete local ID map. A full-build comparison covers links, diagnostics,
  malformed YAML, and navigation updates. A ten-pair 500-concept trial measured
  edit-to-search -21.42% and edit RSS -6.88%; initial import still failed at +20.55%.
- The benchmark reporting audit found that protocol 1 reported the median of
  per-process percentiles. This made import/open/first-search p95 repeat p50.
  Earlier p95 verdicts are not acceptance evidence. The corrected comparator
  pools observations and bootstraps independent process pairs for each percentile.
  Protocol 2 adds source/build/protocol fingerprints, process startup, strict
  workload validation, a fixed evaluation clock, complete bundle manifests, and
  topic-based direct-hit rate/MRR. Original raw baseline evidence remains intact.
- On macOS, the pre-publication ordering barrier uses `F_BARRIERFSYNC`, falling
  back to `F_FULLFSYNC` when unsupported. The acknowledgement barrier still uses
  `F_FULLFSYNC`. All artifact files and directories are synchronized first.
  [Apple's storage ordering explanation](https://developer.apple.com/videos/play/wwdc2019/419/)
- The provenance audit caught an unsupported brace glob in the source-tree
  fingerprint. It matched no files and produced an empty-tree digest. The
  interrupted capture is retained outside the repository as
  `diagnostic-invalid-provenance.json`, explicitly unverified with its
  invalidation reason. It is not acceptance evidence. Fingerprinting
  now scans each required pattern separately, rejects unmatched patterns, and
  has regression coverage for empty and changed inputs.
- Source prefixes now remain strings during initial compilation and are encoded
  directly into the final archive buffer. This removes per-document prefix
  buffers and an intermediate concatenation without changing persisted bytes.
  A new frozen ten-pair matrix is measuring this candidate at all three sizes.
- The verified protocol-2 matrix is complete; its report is
  `bench/results/dbms/early-native-v2.md`. Import RSS changes are +4.45%,
  +2.55%, and +4.20%; edit-to-search p50 changes are -23.58%, -42.36%, and -44.26%
  at the three sizes. Checked outputs are equivalent. The gate still fails:
  500-concept import is +18.60% at p50 and +24.75% at p95; some process-startup
  rows fail and others remain inconclusive. These are internal-engine results;
  the public transports have not yet been converted.
- A regression reproduced `EBADF` when a pinned reader was closed while a batch
  get was still running. Descriptor ownership now delays the physical close
  until outstanding operations settle while refusing new operations immediately.
  Committed-root and revision validation also now reject malformed checksum
  ranges, retention membership, bundle metadata, dates, and diagnostics.
- A publication experiment writes independent immutable artifacts concurrently,
  waits for every write to settle before cleanup or HEAD publication, and uses
  exclusive creation for private staging files. Required file/directory flushes,
  ordering, and final acknowledgement flush remain. Focused recovery and reader
  tests pass; a separate 500-concept trial is measuring the change.
- That publication trial still failed 500-concept import at +16.01% p50 and
  +14.83% p95. Deferring MCP SDK loading then reduced process startup by roughly
  63–65% and import RSS by 24% in a ten-pair trial, while import itself remained
  above budget. Existing synchronous MCP creation and the six tools are preserved;
  60 focused MCP/CLI tests pass through the deferred entry point.
- Initial imports now compile files as their reads finish, using the complete
  precomputed ID map. At most 32 asynchronous body compressions run at once.
  The first 30-pair 500-concept trial measured import p50 +4.53% (pass), import
  p95 +9.76% (inconclusive; ratio interval 1.0652–1.1129), and import RSS -21.59%.
  All other rows passed. It still did not establish acceptance.
- The next candidate avoids per-file intermediate compiler maps and duplicate
  synchronization of the staged head. The ordering operation itself flushes the
  staged file; macOS `F_FULLFSYNC` already includes the behavior of `fsync`.
  All publication barriers remain. Compiler, transaction, corruption, and crash
  tests pass, as do types and targeted lint. A new full matrix is in progress.
  [Apple fcntl contract](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fcntl.2.html)
- The full streaming matrix completed with no definite failures. Every
  5,000-concept row passed. Extending the unchanged 500-concept candidate to
  30 pairs retained the original ten pairs: import p95 remained inconclusive
  at +10.63%, with ratio interval 1.0432–1.1674. At 20,000 concepts, import RSS
  (+9.20%) and opening also remained inconclusive in the ten-pair matrix.
  The reports are `bench/results/dbms/early-streaming-*.md`; the gate did not
  pass.
- The current import experiment bounds outstanding source reads to 32 per bundle
  and uses Bun's direct text reads. Compression shares the bounded worker helper.
  Reader initialization now builds its ID, title, and staleness maps in one pass,
  avoiding the previous temporary tuple array. Types, targeted lint, and focused
  compiler/reader/transaction tests pass; the complete `early-bounded-v2` matrix
  is running with frozen source and harness fingerprints.
- New regression tests verify byte-identical asynchronous compression for Unicode
  sources, waiting for failed compression work before freeing buffers, preserving
  a retention boundary changed after preparation, and actually scanning each
  delivered source directory for forbidden dependencies. All passed locally.
- **Early performance gate: passed.** The verified `early-bounded-v2` matrix has
  ten independent pairs at each size and no failed or inconclusive rows.
  At 20,000 concepts, import p50 is -2.09%, edit-to-search p50 -45.54%, import RSS
  +6.30%, edit RSS -10.92%, and five-tenant RSS -6.04%. Manifests and checked read
  outputs remain exact. This permits T06 history/restore/collection work; it does
  not replace final integrated benchmarks or unexecuted platform verification.

## History, restore, and collection

The native engine now returns history pages of at most 100 revisions. Cursors
are scoped to a tenant and checked against committed ancestry, so abandoned
prepared descriptors cannot become history. Cursor validation walks ancestry;
this maintenance cost is separate from ordinary reader initialization.

Restore validates complete snapshot and source hashes, checks source/body
identity and reconstruction, then publishes a new revision through the normal
compare-and-swap commit protocol. Collection retains ten revisions by default,
supports dry runs, and durably publishes the retention boundary before deleting
unreferenced artifacts or abandoned staging. It holds writer and retention
locks in that order. Open readers retain their descriptors; deletion failures
are reported for later cleanup. Repeated collection never follows pruned parents.

Explicit verification checks every retained committed revision, or a named
candidate for repair. A verified candidate is not proof it was committed.
Repair requires the exact current HEAD file hash, preserves that file in
`recovery/`, and selects the explicitly requested verified revision with a
single-revision retention boundary. It does not run automatically on corruption.

Validation: 32 tests passed across database, history, collection, verification,
and recovery, with 208 assertions. Forced exits cover collection lock acquisition,
HEAD preparation/replacement/durability, and deletion. Focused lint and types
pass. Linux and Windows execution still require their configured CI runners.

## Client and transport integration

`open()` and the fetch-only `connect()` now return `DatabaseConnection` with
atomic batches, history, and restore. New embedded stores use native ownership;
configured legacy stores retain their original source-editing workflow until
explicit migration. Native edits are immediately visible and `sync()` reports
the existing revision. Public open/collection helpers route native and legacy
stores separately. The HTTP server requires existing write grants and explicit
write configuration, while stored source reads and history accept read grants.

The reader cache retains at most 16 tenants. A request holds a lease until its
whole operation finishes, so publication, eviction, connection close, and GC
cannot switch the body fetched after search ranking. Search indexes refresh
when the evaluation date changes. Six default MCP tools remain unchanged;
`--database-tools` adds `transact`, `history`, and `restore`. Ambiguous commits
preserve their revision identity across HTTP and do not prompt an MCP hash retry.

The CLI exposes transaction/history/restore and local verify/repair commands.
New-store invalid paths return HTTP 400 and missing mutation preconditions return
428 before tenant creation. New embedded stores persist HEAD rather than creating
a mutable source directory or sources.json. Tests now assert those intentional
changes while preserving the legacy source behavior and diagnostics.

Validation: seven new integration tests passed with 53 assertions; all 155
existing tests in the affected connection/client/source/MCP/CLI suites passed
with 265 assertions. Type checking and focused lint pass. HTTP tests needed local
socket access outside the filesystem sandbox and used the approved test command.
