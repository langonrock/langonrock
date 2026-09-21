# Additional database operations

Run this after the frozen paired comparison, with no other benchmarks or tests
running on the host:

```sh
bun bench/operations/run.ts --repetitions 10 --output bench/results/dbms/operations-v1.json
bun bench/operations/report.ts bench/results/dbms/operations-v1.json > bench/results/dbms/operations-v1.md
```

This uses the same seeded 500, 5,000, and 20,000 concept fixtures. Each repetition
starts a fresh maintenance process, imports once, creates 25 documents in one
atomic batch, replaces those 25 documents in nine more batches, reads two history
pages, and restores the original revision. Hashes, pagination, restored content,
and unchanged source files are checked. Import setup is outside these timings.

Two fresh writer processes prepare changes to the same document and revision.
A third process opens a reader and builds its search index. All three wait at a
barrier, report their current RSS while holding their prepared state, then start.
Exactly one writer must commit and one must conflict. The reader must retain its
original content. `simultaneousWorkerRssBytes` sums those three barrier samples,
not their individual peak RSS values. The coordinator's RSS is reported separately.
Publication timings begin after preparation and include lock contention.

Another writer is killed after staging its new HEAD but before replacing the
committed HEAD. A fresh process measures reopen plus one get, verifies the last
acknowledged revision, measures default retention cleanup, and fully verifies all
ten retained revisions. Disk samples include source archives, import mappings,
revision descriptors, snapshots, and abandoned staging. Process-kill recovery
does not establish behavior during a power failure.

A separate disk comparison extracts the pinned legacy revision, imports the same
fixture on each side, performs ten identical single-document edits, and retains
ten snapshots or native revisions. It records logical and allocated source/store
bytes before and after collection. The legacy age grace is explicitly zero;
retention uses wall-clock time while read equivalence uses the fixed evaluation
date. Current manifests must remain identical. This gives an equal-work disk
comparison separate from the longer native-only maintenance scenario.

MCP schema sizes are measured in the coordinator after all timed worker activity.
The SDK is absent from the engine worker's import graph. Default six-tool and
opt-in nine-tool schemas are reported separately. Token counts are a characters
divided by four estimate, not counts from a model tokenizer.

Raw captures include the source/native/primary protocol hashes plus a separate
hash of this directory's TypeScript files, command, fixture hashes, machine,
filesystem, runtime, and evaluation clock. A capture remains unverified until
all checks pass and its initial and final code fingerprints match. Do not edit
these inputs during a run. Preserve failed or interrupted captures explicitly as
unverified. Maintenance costs have no before-side equivalent and are not used
to relax any paired performance limit.
