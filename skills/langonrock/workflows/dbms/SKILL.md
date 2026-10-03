---
name: langonrock-dbms
description: Implement and verify Langonrock's native document engine without Python or an external database engine.
---

# langonrock.workflow.dbms

## Goal

Deliver authoritative document transactions, recovery, history, and restore
within the approved performance budgets.

## Scope

Native file storage, compiler integration, clients, transports, migration,
Markdown interchange, packaging, and before/after measurement. No SQL interface,
distributed storage, database dependency, Python, deployment, or release push.

## Triggers

- `/langonrock dbms`
- Implement or modify authoritative native storage or its benchmark contract.

## Inputs

- [Approved plan](../../../../docs/tasks/task.dbms-performance.md).
- Baseline commit `1cbcc009bd93814d56410ed3473d65c101f97d8d`.
- Existing [engineering rules](../../reference/engineering-guidelines.md) and
  [verification commands](../../reference/verification.md).

## Invariants

- The native committed root is authoritative for new and migrated stores.
  Original Markdown remains authoritative only in unmigrated legacy stores.
- Preserve deterministic compiled reads, compact manifests, tenant boundaries,
  hash preconditions, and the remote client's runtime independence.
- Publish complete immutable artifacts before one durable head replacement.
  Validate preconditions while holding the kernel-owned tenant writer lock.
- Acknowledged commits survive reopen. Report ambiguous publication outcomes;
  never silently discard a corrupt committed head or replay a conflicted write.
- Pin a single revision through each read, including ranking and body fetch.
  History and source archives stay out of ordinary read initialization.
- No Python execution, Python-dependent builds, SQLite, or other database engine.
- Freeze the benchmark protocol and capture all three baseline sizes before
  product edits. Do not weaken thresholds or classify uncertain results as passes.
- Manifest token growth is zero. Search/get regression is at most 5%; memory,
  startup, import, and edit-to-search regression is at most 10%.
- Migrate explicitly and preserve original files. TNT1 alone cannot recover
  frontmatter; refuse claims of lossless source migration without originals.
- Decode source bytes with fatal UTF-8 validation and preserve byte-order marks.
  Runtime `.text()` decoding is unsuitable for exact source interchange.
- Validate compile settings before publishing revision metadata, including for
  empty tenants. Cleanup failures must preserve ambiguous commit identities.
- Cache identity includes committed artifact digests and checksums. Bound
  retained bytes and hold leases until in-flight readers release them.
- Keep native compilation explicit for source consumers. The remote-only entry
  must install and run without loading or building the native adapter.
- Preserve raw benchmark files. Refuse output reuse and require an explicit
  verified completion marker. Combine captures only when their provenance agrees.
  Commit only the baseline and final acceptance raw captures; keep intermediate
  raw JSON out of Git and commit its Markdown report instead.

## Procedure

1. Follow tasks in the approved plan, updating their status and evidence.
2. Capture isolated Bun benchmarks at 500, 5,000, and 20,000 concepts.
3. Verify platform locks and durable publication, including interrupted writers.
4. Implement native formats and transactions, then run the early performance gate.
5. Complete history, restore, collection, transport parity, and interchange.
6. Run required tests, build, coverage, quality review, and the full comparison.
7. Fix blocker/high findings, update contracts and manuals, and record release notes.

## Outputs

- Native engine and regression coverage.
- Reproducible raw benchmark samples and per-metric verdicts.
- Updated [task record](../../../../docs/tasks/task.dbms-performance.md) and
  [walkthrough](../../../../walkthrough.md).

## Review gate

- [ ] Every approved requirement is implemented or explicitly reported incomplete.
- [ ] Crash, corruption, concurrency, retention, and migration tests pass.
- [ ] Existing public usage and intentional semantic changes are documented.
- [ ] All performance gates pass at every required size.
- [ ] No forbidden runtime/build dependency or weakened quality threshold.
- [ ] Blueprint sources and manuals agree.

## References

- [Project entry](../../SKILL.md)
- [Approved plan](../../../../docs/tasks/task.dbms-performance.md)
- [Operations and migration](../../../../docs/dbms.md)
- [Performance evidence](../../../../docs/benchmarks/dbms.md)
- [Interactive HTML view](README.html)
