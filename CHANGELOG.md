# Changelog

## Unreleased: native document DBMS

Recorded on 2026-09-21. Implementation commit: `6c3a94b`. Supporting
documentation commit: `9453d6c`.

Langonrock now owns its documents in a native database engine, with atomic
transactions, retained history, and restore. The implementation uses no SQLite,
external database engine, or Python in runtime, builds, tests, or benchmarks.

Measured import, warm search, document reads, and edit-to-search times improved.
Opening and first-search times increased slightly, import memory increased, and
retained disk usage increased substantially. Manifest size is unchanged.

**Release acceptance remains open.** Local correctness and packaging checks pass,
but five performance checks remain inconclusive and Linux/Windows execution is
still pending. This entry documents an unreleased change, not a published version.

### Features

| Area                     | Before                                                               | Now                                                                                                              |
| ------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Document ownership       | Markdown/OKF folders were authoritative; TNT snapshots served reads. | New and explicitly migrated tenants keep authoritative documents in the database.                                |
| Editing                  | Source edits followed by sync.                                       | Native writes commit immediately and are searchable without a separate sync.                                     |
| Transactions             | No equivalent public atomic document-batch operation.                | Create, replace, and delete documents together; a conflicting batch publishes nothing.                           |
| Concurrency and recovery | Source-folder and compiled-snapshot workflow.                        | Coordinated writer processes, readers pinned to committed revisions, and recovery after interrupted publication. |
| History                  | Retained compiled snapshots.                                         | Retained document revisions, paginated history, and restore as a new commit.                                     |
| Folder interchange       | Source folders supplied the read model.                              | Tracked imports detect conflicting folder/database edits; export preserves exact Markdown source.                |
| Maintenance              | Snapshot-oriented operations.                                        | Database verification, retention collection, explicit repair, and migration.                                     |

Legacy tenants keep their existing workflow until explicit migration. Native
ownership does not automatically migrate an existing store.

### Improvements

The tables below compare the original Langonrock implementation at commit
`1cbcc009bd93814d56410ed3473d65c101f97d8d` with the new engine, using **20,000
concepts**. Neither column represents Chroma or direct folder access.

Times are milliseconds. `p50` is the median; `p95` describes the slower end of
the measured distribution. Memory values are decimal MB and represent the median
whole-process peak. Negative changes mean less time or memory. Percentages use
unrounded measurements, so rounded table values may give slightly different ratios.

| Metric                      |    Before |     After |  Change |
| --------------------------- | --------: | --------: | ------: |
| Import p50, ms              | 1,152.527 | 1,080.942 |  -6.21% |
| Import p95, ms              | 1,236.685 | 1,152.643 |  -6.80% |
| Warm search p50, ms         |     0.424 |     0.323 | -23.86% |
| Warm search p95, ms         |     2.418 |     2.307 |  -4.63% |
| Document get p50, ms        |     0.080 |     0.034 | -57.49% |
| Document get p95, ms        |     0.122 |     0.062 | -49.10% |
| Edit-to-search p50, ms      | 1,609.450 |   866.966 | -46.13% |
| Edit-to-search p95, ms      | 1,920.842 | 1,031.714 | -46.29% |
| Opening peak memory, MB     |   129.483 |   102.089 | -21.16% |
| Read/search peak memory, MB |   467.632 |   437.682 |  -6.40% |
| Editing peak memory, MB     |   964.854 |   891.093 |  -7.64% |
| Five-tenant peak memory, MB | 1,472.086 | 1,372.176 |  -6.79% |

All rows in this improvements table pass their agreed performance limits.
Edit-to-search includes the write, reopen/index rebuild, and confirmation that
the changed content can be found.

### Regressions and additional costs

| Metric at 20,000 concepts              |  Before |   After |     Change | Acceptance         |
| -------------------------------------- | ------: | ------: | ---------: | ------------------ |
| Opening p50, ms                        |  26.229 |  27.022 |     +3.02% | Within budget      |
| Opening p95, ms                        |  28.268 |  30.639 |     +8.39% | Inconclusive       |
| First search p50, ms                   | 752.792 | 762.414 |     +1.28% | Within budget      |
| First search p95, ms                   | 794.652 | 802.705 |     +1.01% | Inconclusive       |
| Import peak memory, MB                 | 417.661 | 432.882 |     +3.64% | Within budget      |
| Retained total allocated disk, MB      | 306.721 | 518.947 | About +69% | No agreed disk cap |
| Retained store-only allocated disk, MB | 222.015 | 434.242 | About +96% | No agreed disk cap |

**Disk usage is the largest regression.** Both sides receive the same ten edits
and retain ten versions. Total disk includes the preserved original source
folder. The new history retains exact document sources, while the old history
retains compiled snapshots; the native engine also uses compression level one.
These differences explain additional storage work but do not erase its cost.

| Concepts | Before total allocated disk, bytes | After total allocated disk, bytes |
| -------: | ---------------------------------: | --------------------------------: |
|      500 |                          7,655,424 |                        12,963,840 |
|    5,000 |                         76,402,688 |                       129,048,576 |
|   20,000 |                        306,720,768 |                       518,946,816 |

Source installations now need a C compiler for the small OS adapter, plus Bun
1.3 or newer for the engine. Windows source builds require an MSVC developer
environment. Standalone executables embed the adapter. Remote-only consumers
of `langonrock/client` need neither Bun nor a native build.

### Manifest size and MCP token cost

Complete and per-bundle manifests are exactly equal before and after. Checked
get, section, slice, find, and search outputs also match. The five fixed topic
queries retain the same 0.8 hit rate and 0.8 mean reciprocal rank at every size.
These checks establish parity on the benchmark, not perfect retrieval accuracy.

| Concepts | Manifest characters, before and after | Estimated tokens, before and after | Growth |
| -------: | ------------------------------------: | ---------------------------------: | -----: |
|      500 |                                82,198 |                             20,550 |     0% |
|    5,000 |                               823,408 |                            205,852 |     0% |
|   20,000 |                             3,343,691 |                            835,923 |     0% |

Six MCP tools remain enabled by default. Enabling the three database tools adds
510 estimated schema tokens, separately from document manifest size.

| MCP configuration      | Tools | Schema JSON bytes | Estimated schema tokens |
| ---------------------- | ----: | ----------------: | ----------------------: |
| Default                |     6 |             6,869 |                   1,718 |
| Database tools enabled |     9 |             8,911 |                   2,228 |

Token counts are character-count estimates divided by four, not tokenizer
measurements. MCP schema measurements exclude tenant-specific advice.

### Connectors and interfaces available now

These are the interfaces available after the conversion. The DBMS operations
extend the existing connection model; this list does not imply every interface
was introduced by this change.

| Interface                    | Access                               | Scope                                                                                                                                   |
| ---------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Embedded API                 | `open("okf://…")` from `langonrock`  | Direct database access inside a Bun application.                                                                                        |
| HTTP/HTTPS API               | `okf+http://…` or `okf+https://…`    | Remote access from any language, with token-scoped tenants and write permissions.                                                       |
| Unix socket                  | `okf+unix://…`                       | Local clients share one daemon and its indexes. The client runtime must support Unix sockets.                                           |
| JavaScript/TypeScript client | `connect()` from `langonrock/client` | A fetch-based remote client without Bun or native-store dependencies.                                                                   |
| MCP over stdio               | `langonrock mcp`                     | AI clients use `manifest`, `search`, `get`, `snapshot`, `write`, and `delete`; database tools add `transact`, `history`, and `restore`. |
| CLI                          | `langonrock` commands                | Shell access, automation, querying, and database administration.                                                                        |
| Markdown/OKF folders         | Import, watch, and export            | File interchange with tracked conflict detection and exact source export.                                                               |

There are no dedicated PostgreSQL, MySQL, Notion, Google Drive, Slack, or S3
connectors, and no SQL/JDBC/ODBC interface. Such integrations currently need the
HTTP API or Markdown/OKF interchange. Windows named pipes are unsupported;
local Windows clients use authenticated loopback HTTP. MCP transport is stdio.

### Fixes

- Preserve frontmatter, line endings, Unicode, byte-order marks, nested paths,
  and navigation documents in source round trips. Reject invalid UTF-8 and
  ill-formed Unicode before publication.
- Preserve database-side document and bundle deletions through unrelated folder
  imports. Empty imported bundles can be deleted and restored from history.
- Reject invalid import and migration settings before publishing an unreadable
  revision.
- Preserve the revision identity when publication succeeds but cleanup fails,
  so callers can inspect an ambiguous commit outcome.
- Keep source packages free of host-specific compiled addons. Remote-only
  package installation does not force native compilation.

### Costs of new database operations

These operations have no equivalent atomic/history guarantee in the old
implementation. Values are absolute timings at 20,000 concepts from ten fresh
maintenance repetitions, not before/after speed improvements.

| Operation                                              |   p50, ms |   p95, ms |
| ------------------------------------------------------ | --------: | --------: |
| Create 25 documents in one transaction                 |   277.915 |   283.968 |
| Replace 25 documents in one transaction                |   132.410 |   145.239 |
| Read the first five history revisions                  |     1.061 |     4.250 |
| Restore a retained revision                            |   258.206 |   263.298 |
| Reopen/get after interrupted publication               |    26.958 |    28.209 |
| Verify retained data and collect, keeping ten versions | 1,995.591 | 2,034.579 |

### Validation and open release requirements

Local verification used an Apple M1 Pro with 32 GiB of RAM, macOS arm64, and
Bun 1.3.12. The benchmark uses the same seeded inputs, alternates execution
order, and retains every sample. Each dataset size has thirty independent pairs,
including the planned extensions for inconclusive results.

| Concepts | Paired runs | Passing metric rows | Inconclusive rows | Definite failures |
| -------: | ----------: | ------------------: | ----------------: | ----------------: |
|      500 |          30 |                  35 |                 3 |                 0 |
|    5,000 |          30 |                  38 |                 0 |                 0 |
|   20,000 |          30 |                  36 |                 2 |                 0 |
|    Total |          90 |                 109 |                 5 |                 0 |

All point estimates fit their budgets. However, the following 95% confidence
intervals cross the maximum accepted after/before ratio of 1.10, so overall
performance acceptance has not passed.

| Concepts | Inconclusive metric        | Point change | 95% after/before ratio interval |
| -------: | -------------------------- | -----------: | ------------------------------- |
|      500 | Import p95                 |       -0.70% | 0.9519 to 1.3129                |
|      500 | Import-process startup p95 |      -63.19% | 0.3627 to 2.2908                |
|      500 | Opening p50                |       +1.38% | 0.9609 to 1.1479                |
|   20,000 | Opening p95                |       +8.39% | 1.0111 to 1.3460                |
|   20,000 | First search p95           |       +1.01% | 0.9690 to 1.1391                |

| Verification                                            | Recorded result                                              |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| Automated tests                                         | 549 pass, 0 fail; 1,336 assertions.                          |
| Coverage                                                | 96.07% lines; 96.87% functions.                              |
| Types, lint, formatting, and dependency checks          | Pass.                                                        |
| Native build and standalone/source-package smoke checks | Pass locally.                                                |
| Maintenance, concurrency, and recovery benchmark        | Thirty verified repetitions, ten per dataset size.           |
| Linux and Windows execution                             | Pending; CI configuration is not execution evidence.         |
| Overall release acceptance                              | Open due to performance uncertainty and platform validation. |

Timings measure engine calls and exclude HTTP/MCP overhead. Processes are fresh,
but filesystem caches are not cleared, so these are not cold-disk measurements.
Interrupted-process tests exercise crash recovery, not power-loss behavior on
every filesystem. Results describe this machine and workload.

### Upgrade notes

- Existing legacy stores require explicit migration with their original source
  files. Follow the migration and rollback procedure in the database guide.
- Native writes commit immediately. Use `transact` when several changes must be
  published together; native `sync()` does not create a second revision.
- Keep the six default MCP tools unless database tools are needed. Enable the
  latter with `--database-tools`.
- Budget for increased retained disk usage and choose retention deliberately.
  A pruned revision cannot be restored.

### References

- [Database guide and migration instructions](docs/dbms.md)
- [Full performance report and methodology](docs/benchmarks/dbms.md)
- [Complete before/after metric table](bench/results/dbms/final-acceptance-combined.md)
- [Maintenance and disk measurements](bench/results/dbms/operations-acceptance-v1.md)
- [Decision and verification record](walkthrough.md)
