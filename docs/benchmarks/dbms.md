# Native DBMS performance evidence

The comparison is the previous Langonrock implementation against the native
Langonrock document engine. "Before" is commit
`1cbcc009bd93814d56410ed3473d65c101f97d8d`, which compiles authoritative Markdown
into TNT snapshots. "After" commits authoritative documents with atomic batches,
history, and restore. Neither column is direct folder access or Chroma.

For new captures, the runner uses baseline commit
`0021f08ac63d5123380beb4872a416a016217a5a`, which has the same Git tree as the
recorded baseline above. Its identity changed when commit timestamps were
rewritten. Historical captures keep their original ids and exact bytes.

Performance acceptance remains unresolved. The final comparison has thirty
independent pairs at each size: 109 metric rows pass and five are inconclusive.
No row is a definite failure, and every point estimate fits its budget, but the
five confidence intervals crossing a limit prevent an overall pass. Linux and
Windows execution also remains unverified.

## Final paired results

The [complete comparison](../../bench/results/dbms/final-acceptance-combined.md)
contains all 114 metric rows. Its
[raw combined capture](../../bench/results/dbms/final-acceptance-combined.json)
records the hashes of the initial ten-pair capture and all three twenty-pair
extensions. It is verified against source/build fingerprints. The machine was
an Apple M1 Pro with 32 GiB of RAM.

| Concepts | Independent pairs | Passing rows | Inconclusive rows | Definite failures |
| -------: | ----------------: | -----------: | ----------------: | ----------------: |
|      500 |                30 |           35 |                 3 |                 0 |
|    5,000 |                30 |           38 |                 0 |                 0 |
|   20,000 |                30 |           36 |                 2 |                 0 |

Selected 20,000-concept results follow. Times are milliseconds. Memory is in
decimal megabytes and represents the median whole-process peak. The complete
comparison also includes steady RSS, each process-startup row, sections, slices,
find, and every confidence interval.

| Metric                   |    Before |     After |  Change | Verdict      |
| ------------------------ | --------: | --------: | ------: | ------------ |
| Import p50               | 1,152.527 | 1,080.942 |  -6.21% | Pass         |
| Import p95               | 1,236.685 | 1,152.643 |  -6.80% | Pass         |
| Open p50                 |    26.229 |    27.022 |  +3.02% | Pass         |
| Open p95                 |    28.268 |    30.639 |  +8.39% | Inconclusive |
| First search p50         |   752.792 |   762.414 |  +1.28% | Pass         |
| First search p95         |   794.652 |   802.705 |  +1.01% | Inconclusive |
| Warm search p50          |     0.424 |     0.323 | -23.86% | Pass         |
| Warm search p95          |     2.418 |     2.307 |  -4.63% | Pass         |
| Get p50                  |     0.080 |     0.034 | -57.49% | Pass         |
| Get p95                  |     0.122 |     0.062 | -49.10% | Pass         |
| Edit-to-search p50       | 1,609.450 |   866.966 | -46.13% | Pass         |
| Edit-to-search p95       | 1,920.842 | 1,031.714 | -46.29% | Pass         |
| Import peak RSS, MB      |   417.661 |   432.882 |  +3.64% | Pass         |
| Open peak RSS, MB        |   129.483 |   102.089 | -21.16% | Pass         |
| Read/search peak RSS, MB |   467.632 |   437.682 |  -6.40% | Pass         |
| Edit peak RSS, MB        |   964.854 |   891.093 |  -7.64% | Pass         |
| Five-tenant peak RSS, MB | 1,472.086 | 1,372.176 |  -6.79% | Pass         |

These are all the unresolved rows. Each has a 1.10 maximum accepted ratio.
The spikes remain in the raw samples and bootstrap calculation.

| Concepts | Metric                     | Point change | 95% ratio interval |
| -------: | -------------------------- | -----------: | ------------------ |
|      500 | Import p95                 |       -0.70% | 0.9519–1.3129      |
|      500 | Import-process startup p95 |      -63.19% | 0.3627–2.2908      |
|      500 | Open p50                   |       +1.38% | 0.9609–1.1479      |
|   20,000 | Open p95                   |       +8.39% | 1.0111–1.3460      |
|   20,000 | First search p95           |       +1.01% | 0.9690–1.1391      |

## Manifest and retrieval correctness

Both sides have exactly equal complete and per-bundle manifests, plus equal
checked get/section/slice/find/search outputs and edit visibility. All three
sizes have the same 0.8 hit rate and 0.8 mean reciprocal rank for the five fixed
topic queries. These scores are unchanged, not a claim of perfect retrieval.

| Concepts | Manifest characters, both sides | Estimated tokens, both sides | Growth |
| -------: | ------------------------------: | ---------------------------: | -----: |
|      500 |                          82,198 |                       20,550 |     0% |
|    5,000 |                         823,408 |                      205,852 |     0% |
|   20,000 |                       3,343,691 |                      835,923 |     0% |

## Method and acceptance

Both sides use Bun 1.3.12 on the same macOS arm64 machine, the same seeded corpus,
and an evaluation date fixed to 2026-09-21. The corpus has 500, 5,000, or 20,000
concepts, split into bundles of 500. The raw files record CPU, memory, filesystem,
OS release, fixture/query hashes, commands, source hashes, benchmark hashes, and
the native binary hash. The runner checks the hashes again before marking a
capture verified.

Captures precede the local implementation commit, so their `candidate` Git label
still names the starting commit. `sourceTree` and `nativeBuild` identify the
edited implementation actually measured; neither label is rewritten afterward.

Each pair alternates which implementation runs first. Import, open, reads,
edits, and five-tenant workloads run in separate fresh processes. Filesystem
caches are not cleared, so these are fresh-process measurements, not cold-disk
measurements. Process initialization and the operation itself are separate rows.
The timings measure engine calls; they exclude HTTP or MCP transport overhead.

Warm reads have ten warmup calls followed by 100 timed calls. Edits include the
write, reopen/index rebuild, and an assertion that a unique marker is searchable.
RSS includes runtime/native allocations and caches, without forced collection.
Five-tenant RSS includes five opened readers and built search indexes. Memory
rows compare medians of the independent per-process measurements.

Latency rows report p50 and p95 with a seeded paired bootstrap 95% ratio interval.
There are ten independent pairs per size initially. An inconclusive size gets
twenty additional pairs. All thirty remain in the combined result. A row passes
only if the interval's upper bound fits the budget. A lower bound above the
budget fails; an interval crossing it remains inconclusive. Outliers stay in the
data, and a gain in one metric cannot offset a failure in another.

| Requirement                                                            | Limit                                                           |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| Search, get, section, slice, and find                                  | At most 5% regression for both latency percentiles              |
| Import, open, first search, edit-to-search, and process initialization | At most 10% regression for both percentiles                     |
| Peak and steady RSS                                                    | At most 10% regression                                          |
| Manifest and retrieval                                                 | Exact manifests and checked outputs, unchanged retrieval scores |
| Disk                                                                   | Report logical and allocated bytes; no agreed percentage cap    |
| New database operations                                                | Report absolute costs; no legacy percentage comparison          |

See the [primary protocol](../../bench/dbms/README.md) and
[maintenance protocol](../../bench/operations/README.md) for runnable commands.
No benchmark, build, runtime, or validation step invokes Python.

## Capture history

The [original baseline](../../bench/results/dbms/baseline.json) was captured at
all three sizes before product edits. Earlier failed and inconclusive captures
remain in `bench/results/dbms`; they have not been overwritten or filtered.
The interrupted `final-reviewed-v2.json` file is unverified and excluded. It was
stopped before the final empty-bundle deletion/import correction.
Names containing `final` describe when a capture was taken, not an acceptance
verdict. Failed and inconclusive runs were followed by documented corrections;
the report does not select the fastest capture among repeated unchanged builds.

| Capture                                                                            | Purpose and result                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [early-native-v2](../../bench/results/dbms/early-native-v2.md)                     | Early implementation exposed import/edit regressions and guided optimization.                                                                                |
| [early-bounded-v2](../../bench/results/dbms/early-bounded-v2.md)                   | All early gate rows passed before transport/history integration.                                                                                             |
| [final-integrated-combined](../../bench/results/dbms/final-integrated-combined.md) | After extensions, 500-concept open p95 remained inconclusive. This precedes source-fidelity and packaging corrections.                                       |
| [final-fidelity-v2](../../bench/results/dbms/final-fidelity-v2.md)                 | Ten pairs at each size; all 5,000/20,000 rows passed, but 500-concept open p50 was inconclusive. This precedes the final validation/publication-error fixes. |
| [operations-v1](../../bench/results/dbms/operations-v1.md)                         | Thirty verified maintenance repetitions, ten per size, before those final fixes.                                                                             |

## Disk and schema accounting

The [final maintenance report](../../bench/results/dbms/operations-acceptance-v1.md)
and [raw capture](../../bench/results/dbms/operations-acceptance-v1.json) contain
ten verified repetitions at each size, with the same source/native fingerprint
as the paired comparison.

Disk accounting includes immutable snapshots, source archives, descriptors,
import state, and staging. The equal-work comparison applies the same ten edits
to each side and then retains ten versions. It reports the preserved original
folder separately and adds it to the total; it does not count a retained native
source archive as a reason to exclude that original folder.

Native retention preserves complete source history, including frontmatter and
navigation documents. Legacy retention preserves compiled snapshots. The native
engine also uses compression level one. These semantics have a disk cost and
must accompany the latency and memory results.

| Concepts | Before total allocated bytes, keep 10 | After total allocated bytes, keep 10 |
| -------: | ------------------------------------: | -----------------------------------: |
|      500 |                             7,655,424 |                           12,963,840 |
|    5,000 |                            76,402,688 |                          129,048,576 |
|   20,000 |                           306,720,768 |                          518,946,816 |

At 20,000 concepts, total allocated disk increases about 69%, including the
preserved original folder. Store-only allocated bytes rise from 222,015,488 to
434,241,536, about 96%. Total logical bytes rise from 267,221,627 to 479,387,681.
Before collection, after the same ten edits, store-only allocated bytes are
244,215,808 before and 477,392,896 after. The full report has every logical,
allocated, source, pre-collection, and post-collection row.

Manifest equality is exact, including individual bundle manifests. Character
counts divided by four are only token estimates. MCP schema estimates are
separate and exclude tenant-specific advice. Six tools remain the default;
the three database tools require explicit opt-in.

| MCP configuration      | Tools | Schema JSON bytes | Estimated tokens |
| ---------------------- | ----: | ----------------: | ---------------: |
| Default                |     6 |             6,869 |            1,718 |
| Database tools enabled |     9 |             8,911 |            2,228 |

Opt-in adds 510 estimated schema tokens. That cost is not included in the
zero-growth manifest result.

## New operation costs

These 20,000-concept operations have no equivalent atomic/history guarantee in
the old implementation. Times are milliseconds; they are absolute measurements,
not before/after improvements. The maintenance report includes all three sizes.

| Operation                                      |       p50 |       p95 |
| ---------------------------------------------- | --------: | --------: |
| Create 25 documents in one batch               |   277.915 |   283.968 |
| Replace 25 documents in one batch              |   132.410 |   145.239 |
| First history page, five revisions             |     1.061 |     4.250 |
| Next history page, five revisions              |     0.929 |     1.241 |
| Restore                                        |   258.206 |   263.298 |
| Reopen/get after interrupted publication       |    26.958 |    28.209 |
| Verify retained data and collect, keep ten     | 1,995.591 | 2,034.579 |
| Winning writer publication after preparation   |    26.828 |    33.860 |
| Conflicting writer rejection after preparation |    30.021 |    35.341 |

Each contention run verifies exactly one commit and one conflict, while a pinned
reader keeps the old changed document. Median simultaneous worker RSS is
1,099,071,488 bytes; the coordinator separately reports 151,814,144 bytes. Median
individual peaks are 375,062,528 bytes for the winning writer and 378,175,488 for
the conflicting writer. The raw capture also retains the reader's individual
peak, every process sample, and the interrupted-writer recovery checks.

## Limits and release status

The corrected implementation passes 549 tests with 1,336 assertions and 96.07%
line / 96.87% function coverage under Bun. Type checking, lint, dependency checks,
the native/executable build, compiled CLI/MCP smoke, and source-package
install/build/persistence smoke pass. Twelve documentation manuals also pass
desktop/mobile browser checks. These checks complement the benchmark; they do
not turn an inconclusive performance result into a pass.

The corpus is deterministic and synthetic. These measurements do not establish
performance for every document size, bundle layout, hardware configuration, or
concurrent workload. Writer contention tests use two prepared writers and one
pinned reader; they are not a sustained load test. Simultaneous worker RSS is
sampled at a barrier after both writers prepare and the reader builds its index,
with coordinator memory reported separately. It is not a summed peak over time.

Forced process exits cover publication, migration, and collection boundaries.
They establish observed process-crash behavior on this machine, not power-loss
safety. Linux/Windows CI jobs are configured but have not run for this change.
Their execution remains a release blocker. No push, release, or deployment is
part of this task.

The architecture-specific release runner labels were checked against the
[GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
That checks configuration availability, not execution of this project's jobs.

Use the [operations guide](../dbms.md) for migration, rollback, backups, and
failure handling, and the [task record](../tasks/task.dbms-performance.md) for
requirement status.
