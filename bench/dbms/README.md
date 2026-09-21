# Native DBMS comparison

Run with Bun. No Python, database engine, or Chroma service participates.
Choose unused output paths; rename these examples when repeating a capture.

```sh
bun run bench:dbms --baseline-only --output bench/results/dbms/local-baseline.json
bun run bench:dbms --self-check --pairs 10 --output bench/results/dbms/self-check.json
bun run bench:dbms --output bench/results/dbms/comparison.json
bun bench/dbms/compare.ts bench/results/dbms/comparison.json
```

The baseline is extracted from commit
`0021f08ac63d5123380beb4872a416a016217a5a`. Extraction and stores use a unique
temporary directory. No checkout, reset, user source, or existing benchmark
directory is modified. The runner uses the installed dependencies and records
the Bun version. Run both sides on the same runtime and machine without other
benchmark workers.

The recorded captures retain the original baseline id
`1cbcc009bd93814d56410ed3473d65c101f97d8d`. The current id has the same Git
tree; rewriting commit timestamps changed its identity without changing its
files. New captures use the reachable id so they work from a fresh clone.
Existing captures and their provenance hashes remain unchanged. Clone with
full history when running comparisons; a shallow checkout may omit the baseline.

Each size uses seed 7 with 500 concepts per bundle. Each independent pair runs
five child processes per side: import, open, read/search, edits, and five-tenant
memory. Import starts empty. The remaining phases use the completed import.
Opening a fresh process does not empty the OS filesystem cache.

Read workloads receive ten warmup calls and 100 samples. Ten edits each append
a unique marker, publish it, search, and fetch the result to verify visibility.
Operation timing excludes fixture generation and process startup. Startup is
measured separately from process launch until the worker reports its adapter is
ready. Source restoration occurs outside edit timing. Every raw timing remains
in the JSON result. The evaluation clock is fixed at 2026-09-21, including calls
that determine staleness; elapsed timings use the monotonic runtime clock.

The runner records whole-process peak and steady RSS, without forced garbage
collection. Peak units are bytes on the verified local Bun/macOS runtime. It
refuses implausible units on other platforms rather than silently converting
them. Disk includes source files and all snapshots after ten edits; no historical
versions are pruned for that row.

The comparator checks fixture hashes and exact whole/bundle manifest, get, and
search output signatures before computing regressions. Topic labels from the
corpus generator define query relevance independently of ranking. Hit rate and
MRR count direct hits and exclude linked expansion. They measure these five fixed
topic queries, not general retrieval quality.

Protocol 2 fingerprints the complete candidate source/native build and benchmark
code, records filesystem/runtime information and the operation digest, and checks
the fingerprints again at completion. Incomplete or changed captures are refused.
Every required phase, timing count, and correctness check is validated.

Percentiles pool observations across processes. Seeded bootstrap resampling keeps
each process pair together, including its complete set of warm-call observations.
Both latency percentiles have their own 95% ratio interval. Memory comparisons
use the median of independent whole-process peaks and steady readings. Fixed
limits distinguish passes, failures, and inconclusive measurements. Extend
inconclusive comparisons from ten to thirty pairs without changing the workload.

Use new output paths for every capture. The runners refuse to overwrite existing
raw evidence. For example, extend one inconclusive size and combine it with all
original samples:

```sh
bun bench/dbms/run.ts --pairs 20 --size 500 --output bench/results/dbms/extension-500.json
bun bench/dbms/combine.ts bench/results/dbms/combined.json bench/results/dbms/comparison.json bench/results/dbms/extension-500.json
```

The combiner checks matching source/build/protocol/machine fingerprints and
records the SHA-256 of each input capture. It keeps every original observation.
Do not format raw JSON after capture. The additional
[maintenance and equal-retention workloads](../operations/README.md) report
new operation costs, disk use, and MCP schemas separately.

Protocol 1 raw evidence is preserved. Its initial report took the median of
per-process percentiles, which incorrectly made p95 equal p50 for import, open,
and first search. Those earlier p95 verdicts are not acceptance evidence. The
current comparator can recompute their tails from the preserved raw observations.

The complete acceptance contract, remaining measurements, and platform limits
are in the [implementation plan](../../docs/tasks/task.dbms-performance.md).
