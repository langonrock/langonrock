# langonrock: design document

A purpose-built, multi-tenant store for Open Knowledge Format bundles, optimized for low token cost and low latency when AI agents read it.

Status: build order steps 1 through 3 are implemented. The compiler, the `.tnt` snapshot format, the copy-on-write writer and the batched reader all work and are exercised against real bundles. Steps 4 through 7, meaning the filesystem watcher, the MCP server, BM25 and GC, are still design only.

## Summary

Keep OKF as the authoring format. Compile it into a dense read-side artifact that agents consume. Store many bundles per tenant in an immutable, content-addressed file format that backs up by copying files. Serve it through a small MCP and HTTP interface with three connection modes.

The core bet: this data is small and read-mostly, so most of what makes a database hard does not apply here.

## Why I want this

I found OKF and liked the idea of a portable knowledge format for agents. Two things bothered me immediately.

First, it looks expensive in tokens. Full YAML frontmatter on every concept, human-readable prose written for people rather than models, and no way to ask for part of a document.

Second, it looks slow. The reference consumption pattern walks an index, picks a concept, reads it, follows a link, reads more. Every hop is a round trip through the model.

Beyond that, OKF ships as loose directories. I want many bundles, per-tenant separation, easy add/edit/remove for users, easy backups, and a way for Claude Code and LangGraph to read it without custom glue each time.

I do not want to put this in Postgres. The access pattern is key lookup over tiny immutable documents, and a general-purpose relational engine buys nothing here.

## Part 1: What OKF is

The Google Cloud data team published Open Knowledge Format in June 2026 as v0.1. Version 0.2 shipped 25 July 2026.

It is a vendor-neutral open specification for representing organizational knowledge so agents can consume it. In practice it formalizes the LLM-wiki pattern into a portable format: a directory of Markdown files with YAML frontmatter. No SDK, no runtime, no registry.

The problem it targets is context assembly. Internal knowledge lives in metadata catalogs behind proprietary APIs, wikis, shared drives, code comments, and the heads of senior engineers. Every team building an agent solves the gathering problem again from zero.

### Structure

Each file is a concept, meaning a table, dataset, metric, API, or runbook.

```yaml
---
type: BigQuery Table
title: Orders
description: One row per completed customer order.
resource: https://console.cloud.google.com/bigquery?p=acme&d=sales&t=orders
tags: [sales, revenue]
timestamp: 2026-05-28T14:30:00Z
---
```

The body is ordinary Markdown. Links between files form the knowledge graph.

```
sales/
  index.md
  datasets/orders_db.md
  tables/orders.md
  tables/customers.md
  metrics/weekly_active_users.md
```

Only `type` is required. Everything else is standardized but optional, and bundles may add their own keys. `index.md` gives navigation, `log.md` gives history. Both optional.

### What v0.2 added

Trust and provenance became first-class: `sources`, `generated`, `verified`, `status`, `stale_after`.

If v0.1 asked what your content is, v0.2 asks who stands behind it. That is the part worth adopting. A plain `CLAUDE.md` cannot tell you whether it is still true.

### Design principles from the spec

The format is minimally opinionated, producers and consumers stay independent, and it is a format rather than a platform. No vendor account required to read it.

### What Google actually ships

Repository: `GoogleCloudPlatform/knowledge-catalog`, Apache 2.0.

- The specification, `okf/SPEC.md`, currently v0.2
- A reference enrichment agent in Python 3.13. It walks a BigQuery dataset, drafts a concept per table and view, then runs a second LLM pass that crawls documentation and adds citations, schemas, and join paths. Only useful if your source is BigQuery.
- A visualizer that renders any bundle as a self-contained HTML force-directed graph. No backend, nothing leaves the page.
- `kcmd`, a CLI and MCP server that syncs with Google Cloud Knowledge Catalog
- Four sample bundles: GA4, Stack Overflow, Bitcoin, Acme Retail

Those samples are demos. Google published no general-purpose knowledge corpus.

## Part 2: State of the ecosystem

### The bundle directory

[BundleDex](https://bundledex.net/) indexes 381 bundles from 333 authors, of which 148 carry the OKF-conformant badge. Domains run across education, healthcare, infrastructure, finance, COBOL, philosophy. Some come from Databricks and Pulumi, most from individuals.

Quality signals are thin. Stars, a conformance badge, and a Draft marker. There is no unified install path, since each bundle links to its own repository. Treat it as an awesome-list, not a trusted registry.

### Community tooling

- `okflint`, deterministic conformance checker, Python, MIT, `uv tool install okflint`
- Kiso, validator and static-site builder, Java, Apache-2.0
- OpenWiki, wires codebases into OKF, Python, MIT
- `superops-team/okf`, Go CLI that generates bundles from git repositories with incremental sync
- `signed-okf`, cryptographic signatures and optional OriginTrail anchoring
- `hermes-okf`, filesystem memory storing agent decisions as concepts
- `okf-skill`, a single-file agent skill for Claude Code and Cursor
- Obsidian works as-is, since a bundle is already a vault

### LangGraph and LangChain

[`okf-agents`](https://github.com/RonCodes88/okf-agents), `pip install okf-agents`, MIT, Python 3.11 to 3.13.

```python
from okf_agents import OKFBundle, create_okf_tools
bundle = OKFBundle.load("./my_markdown_docs")
tools = create_okf_tools(bundle)
```

It exposes `read_concept`, `search_concepts`, `list_links`, `read_index`, two retrievers (`OKFRetriever` for keyword, `OKFGraphRetriever` for semantic plus link expansion), a router, and a navigator subgraph with hop and token budgets.

Maturity: 4 stars, 28 commits. One person, a few weeks old. Read the code before trusting it. It is small enough to audit in an afternoon or replace outright.

### MCP servers

`okf-mcp`, `okf-ingest` (verbs `context`, `search`, `impact`, `diff`, `doctor`), and okfbundle.com. All community.

### Verdict

There is no ready-made knowledge base to download that makes an agent smarter. What exists is a format plus an uneven community directory.

The real value of OKF today is as a convention for knowledge you write yourself. Your schemas, metrics, runbooks, architecture decisions. That is what this project stores.

## Part 3: Where the tokens and the time go

The format is not slow. The consumption pattern is. OKF is files on disk. Cost comes from three places, and only one is the syntax.

### Metadata tax

Full frontmatter runs 60 to 120 tokens per concept, paid on every read whether or not the fields matter to the question. YAML repeats key names in every record. For 500 concepts at 8 keys and roughly 3 tokens per key name, that is about 12k tokens of nothing but field names.

### Round-trip tax

This is the slow part, and the largest. The navigator pattern goes index, choose, read, follow link, read more. Each hop is a full inference turn. Four hops at roughly 2 seconds each before the agent starts answering. Latency here is round trips, not tokens.

### Prose tax

Markdown written for humans carries connective tissue. "This table contains one row per completed order, and is typically joined with..." The model needs `grain=order_id`.

### Two principles

Move token cost from query time to build time.

The model should never spend a turn deciding what to read next if a deterministic index could have told it.

## Part 4: The compiled read model

### Separate what humans write from what agents read

OKF fuses the two, and that is where it loses on efficiency. Humans write Markdown. A compiler emits a compact artifact. The OKF source stays intact, so `okflint`, the visualizer, and Obsidian keep working.

### A dense manifest that fits in context

Budget 10 to 15 tokens per concept. Then the agent makes one hop: read the manifest, know exactly which three files it needs, fetch them in parallel. No traversal.

Drop YAML for a positional encoding. Declare keys once in a header.

```
# manifest.tsv
id	kind	grain	summary	links
orders	table	order_id	completed orders, 2019-, ~40M rows	customers payments
customers	table	customer_id	registered incl. churned	orders
rev_net	metric	-	gross - refunds - tax	orders payments
```

Against the YAML equivalent this cuts structural overhead per record by roughly four to five times. The `links` column carries the whole graph, so the agent plans traversal without opening anything.

Constraint the compiler enforces: summaries are single-line and contain no tabs.

### Section-addressable shards

`get(id, section)` returning one slice costs a fraction of the full document.

An earlier draft invented `@schema` and `@joins` markers and assumed an offline LLM pass would rewrite prose into them. That turned out to be unnecessary. Markdown headings already are the section markers, and real bundles use them: every Google sample concept carries `# Schema`, `# Common query patterns`, `# Metrics`. The compiler slugs each heading and records its byte range, so section addressing works on unmodified OKF with no model in the build path.

Fenced code blocks have to be excluded before scanning, because a `# comment` line inside a SQL or shell example is not a heading and these bundles are full of them.

Measured on the GA4 sample: fetching the `events_` concept whole costs 9419 bytes, fetching `--section schema` costs 5486. The saving grows with document size, and it costs nothing to have.

Stripping prose to bare facts is still the bigger win and still wants an LLM pass. That is a later step, and it is now optional rather than load-bearing.

### Prompt caching is the multiplier

Put the manifest at the front of the prompt. It stays stable across turns, so it hits cache at roughly 10 percent of the cost.

This makes byte-determinism a hard requirement on the compiler, not a nicety. Identical input must produce identical output, or every rebuild invalidates the cache and the multiplier disappears. Concretely: rows sorted by id, link lists sorted, no timestamp in the file, and stats reported to stderr rather than embedded. Sorting uses plain code-unit comparison, never `localeCompare`, which varies by machine.

Rough order of magnitude for 500 concepts:

| Approach                  | Effective tokens | Round trips |
| ------------------------- | ---------------- | ----------- |
| Naive OKF navigator       | ~5.5k            | 4 to 5      |
| Compiled manifest, cached | ~1.4k            | 2           |

The win comes from replacing model-driven traversal with deterministic selection in one hop, not from TSV being shorter.

### Scaling break point

The manifest stops fitting somewhere around 2000 concepts, call it 25k tokens. Past that, shard by domain. A domain-level manifest of 50 lines stays cached, then the domain manifest loads. Still two hops.

### Retrieval

Take the model out of the loop. BM25 or embeddings return top-k, then a deterministic one-hop expansion over the link graph. Zero model calls in the retrieval path. Largest single latency win, and it is independent of the format.

### How to measure

Do not measure bundle size. Measure tokens to first correct answer and number of round trips, against a fixed set of about 20 real questions. Without that you will optimize bytes and miss that the latency was all in the hops.

### Cheapest possible version

Generate `manifest.tsv` over your existing OKF and put it in the prompt prefix. Roughly 40 lines of script, and it captures most of the gain. Do this before building anything else.

## Part 5: Storage architecture

### The observation that shapes everything

This data is tiny and read-mostly. A tenant with 10 bundles at 500 concepts and 2KB each is about 10MB. Writes are human-scale, meaning someone edits a concept, not 50k writes per second.

That frees you from nearly everything that makes a database hard. No WAL, no MVCC, no page manager, no vacuum, no B-tree. You can rewrite the whole tenant file on every edit, about 10ms on an SSD, and still sit orders of magnitude inside budget.

"From scratch" should mean your own data model, semantics, and API on top of boring proven pieces. Not writing a storage engine. Your advantage here is the layout compiled for the prompt.

### Split writes from reads

The easiest way to give users CRUD is to not build CRUD. Source of truth is a directory of OKF Markdown they already know how to edit in Obsidian, VS Code, or git. A daemon watches and compiles.

Add a bundle by creating a folder. Remove it by deleting the folder. Modify it by saving a file.

The store is the compiled read side.

### Three layers

1. **Immutable content-addressed snapshot.** One `.tnt` file holding the manifest, the directory, and every concept blob. Its name is `sha256` of its own bytes, so an identical bundle always lands on the same file and re-storing it is a no-op.
2. **Tenant ref.** A one-line `current` file naming the active snapshot. The only mutable thing in the system. Updated by atomic rename.
3. **Derived, disposable.** BM25 index, embeddings. Rebuildable from layers 1 and 2. The manifest is not here: it lives inside the snapshot, because it must be byte-identical to what the compiler produced.

Layer 3 being disposable is what makes backups easy. You back up layers 1 and 2 and nothing else.

### Why blobs live inside the snapshot

An earlier draft put each concept in its own content-addressed file and made a snapshot an index over them. That buys cross-snapshot dedup: editing one concept in a 500-concept bundle would rewrite one blob instead of all of them.

It was not worth it. The whole premise of this design is that a tenant is about 10MB and writes are human-scale, which is exactly the case where rewriting everything is cheap and a second level of indirection is not. A self-contained snapshot also makes the two operations that matter trivially correct: a backup is a file copy, and a restore is a file copy back.

The cost is honest and worth stating. Retaining N old versions costs N full snapshots rather than N deltas. At 12KB to 30KB per real bundle after zstd, that is not a number worth engineering around yet. Revisit it if a tenant passes roughly 500MB, which is the same threshold that would force the write path to change anyway.

### Disk layout

```
data/
  tenants/acme/
    current              # one line: active snapshot id
    lock                 # present only while a writer holds it
    snapshots/
      d735c5d3....tnt    # immutable, named by sha256 of its own bytes
      78de7c5c....tnt    # previous version
    log.jsonl            # append-only audit
  derived/acme/
    bm25.idx             # not built yet
```

### The tenant file format

```
[header]    magic "TNT1", version, section offsets
[manifest]  TSV, uncompressed, contiguous
[dir]       id -> (offset, len, section_offsets)
[blobs]     zstd, one per concept
```

The manifest sits contiguous and uncompressed on purpose. Slice the byte range and send it straight to the prompt. No parsing, no decompression, no allocation. It is the read that happens every turn, and the others are rare.

### Write path

```
write new blobs -> write new .tnt snapshot -> fsync -> rename("current")
```

Copy-on-write. Readers never see a partial state, because rename is atomic. One writer per tenant, enforced by a lock file. A crash mid-write leaves an orphan `.tnt` for the GC to sweep, and never corrupts visible state.

Choosing this write model removes transactions, isolation, and crash recovery from the project. Revisit only if a tenant passes roughly 500MB.

### Readers take no lock at all

Snapshots are immutable, so reads are always safe and parallel, even during a write. This is the payoff of copy-on-write: the hard part of concurrency does not exist.

### Multi-tenancy

A tenant is a directory boundary. The tenant id never comes from a user-supplied path, and is always resolved through a lookup table.

Derived indexes are per tenant, never shared. A shared search index leaks content across tenants through ranking.

One trap specific to content addressing: a global blob store turns the hash into an existence oracle, letting one tenant probe whether another holds given content. Use a per-tenant blob namespace by default. You lose cross-tenant dedup, which at 10MB per tenant costs nothing.

### Why not Postgres

You give up ad-hoc queries, cross-tenant transactions, and external inspection tools, and you own the bugs. For key lookup over small immutable documents, none of that bites.

If analytical queries over metadata ever become a requirement, SQLite per tenant gives you 90 percent of it for free while keeping the one-file-per-tenant property that makes backup a copy.

## Part 6: Agent API

Few verbs, all deterministic. Tool count is itself a token cost, since 4 tools run about 200 tokens of schema and 15 run about 1500.

```
manifest(tenant)            -> TSV, usually already in the cached prefix
get(ids[], section?)        -> batch, one round trip for N concepts
search(query, k)            -> BM25 plus deterministic one-hop expansion
put(bundle, changes)        -> only if agents write
```

Batching `get` is what kills latency. The agent reads the manifest, picks three ids, fetches all three in one call. Two round trips total.

Add a `bundle` column to the manifest so the agent filters without loading anything extra.

## Part 7: Connection modes and protocol

### Three modes, one core

Write the core as a library. The daemon and server are thin wrappers of a few hundred lines each. Same shape as SQLite to libSQL, or DuckDB to MotherDuck.

**Embedded.** The app links the library and opens a path. No network, fastest, one process.

**Local daemon.** Unix socket on Linux and macOS, named pipe on Windows. Several local clients (Claude Code, a LangGraph app, the CLI) share one process holding warm indexes. This is probably the default mode, because it removes cold start from every agent invocation.

**Network server.** HTTP over TCP with auth. Remote, multi-machine, real multi-tenancy.

### Connection strings

The scheme picks the mode.

```
okf:///var/data/okf                    embedded
okf+unix:///tmp/okf.sock               local daemon
okf+npipe://./pipe/okf                 local daemon, Windows
okf+https://host:7777?token=...        remote
```

`Open(dsn)` returns the same interface in all four cases. Develop embedded, deploy remote, no code change.

### Wire protocol

HTTP/1.1 and JSON. Do not invent a wire protocol, because you do not have the problem that would justify one.

One exception that matters. The manifest goes out as raw bytes, not wrapped in JSON.

```
GET  /v1/{tenant}/manifest   -> text/tab-separated-values
POST /v1/{tenant}/get        -> {"ids":[...], "section":"schema"}
POST /v1/{tenant}/search     -> {"q":"...", "k":8}
```

JSON-escaping a TSV adds bytes and parse cost to the payload you transfer most. Send it raw with an `ETag` set to the snapshot hash. The client sends `If-None-Match` and a 304 skips the transfer entirely between turns.

### Auth

Bearer token per tenant, mapped server-side. The tenant in the path is never trusted. Resolve it from the token and check it matches. Once the token carries the tenant, the path is convenience, not authorization.

## Part 8: Cross-platform

The architecture above assumes POSIX in three places. Fix these on day one, not the week before release.

### Mandatory file locking on Windows

On POSIX you can delete or replace an open file and readers keep their descriptor. Windows raises a sharing violation, so the rename fails if anything holds the file open. Same for a memory-mapped file, which cannot be deleted or truncated while mapped.

The design already handles this, and it is the reason the design is worth keeping. Snapshots are immutable and never overwritten. The only rename targets `current`, a tiny file nobody holds open. Deleting old snapshots belongs to the GC, which can retry later.

Go's `os.Rename` uses `MoveFileEx` with replace on Windows, so atomic replacement works on all three platforms.

### Directory fsync

POSIX requires fsync on the parent directory after rename for real durability. Windows does not let you open a directory that way. Put it behind a per-platform function and make it a no-op on Windows.

### Filenames

Windows reserves `CON`, `PRN`, `NUL`, `AUX`, forbids `: * ? < > |`, and caps paths at 260 characters unless long paths are enabled. macOS is case-insensitive by default, so a bundle holding both `Orders.md` and `orders.md` collides.

This would bite hard if concept ids became filenames. They do not. Blobs are named by hex hash, lowercase and fixed-length, safe on every filesystem, and the `id -> hash` mapping lives in the manifest. That was accidental in the original sketch and is now the main reason it ports cleanly.

### Line endings

Git on Windows converts LF to CRLF and changes the content hash. Put `* -text` in the source folder's `.gitattributes`, or normalize before hashing. Pick one and write it down.

### File watching

`fsnotify` covers all three platforms with different temperaments. FSEvents on macOS coalesces events, `ReadDirectoryChangesW` on Windows overflows its buffer under bursts, and inotify on Linux has a watch limit. Debounce, and run a periodic full rescan as a backstop. Never trust watch events alone.

### Data directories

```
Linux    $XDG_DATA_HOME/okf   (fallback ~/.local/share/okf)
macOS    ~/Library/Application Support/okf
Windows  %LOCALAPPDATA%\okf
```

Always allow an explicit override by flag and environment variable.

## Part 9: Runtime choice

### The workload barely involves the language

Look at what runs on the hot path. Read a file region, slice bytes, write to a socket. Hash on write, zstd decompress, HTTP, filesystem watching.

Almost all of that is I/O or work delegated to native code, with essentially no CPU-bound JavaScript. The bottleneck is syscalls. This is exactly the profile where the gap between Go and Bun disappears into noise.

### Bun

`bun build --compile` produces a self-contained executable with the runtime embedded. Cross-compilation covers all six targets, including `bun-windows-arm64`, added in 2026.

```
bun build --compile --target=bun-windows-arm64 ./src/main.ts --outfile okf.exe
```

Binary size runs about 60MB against 10 to 15MB for Go. Noticeable for a CLI, not fatal.

In favor:

- The MCP TypeScript SDK is the most mature of the three, and this project ships an MCP server
- LangGraph JS shares types with the client, so one schema and no drift
- `bun:sqlite` is built in, which is exactly the fallback plan if analytical queries appear
- Development speed, which matters on a project that will change shape several times

Against:

- 60MB per target
- Windows is Bun's newest platform, and Windows is already where the storage traps live. Stacking the least-proven runtime there is the one objection I still take seriously.
- A long-lived daemon under GC needs more care in JS than in Go
- Bun moves fast and occasionally breaks things, which weighs more on a data layer meant to last

### One design change Bun forces

The `Bun.mmap` docs state plainly that deleting or truncating the file will crash Bun.

That collides with the GC deleting old snapshots. If a reader has the file mapped, you do not get an error, you lose the process. POSIX makes deleting a mapped file safe, and Bun gives no such guarantee.

The fix is to not use mmap at all, and it is right regardless of language. A 6k-token manifest is about 25KB, so reading it takes microseconds. `Bun.file().slice(offset, len)` gives a lazy byte range that streams to the socket without copying into the JS heap.

mmap only pays at a scale this project does not reach, and here it imports real risk for nothing.

### Go

`GOOS=windows GOARCH=amd64 go build`, with `CGO_ENABLED=0` so you keep static binaries and avoid glibc versus musl problems. Six targets cover everything: `linux/{amd64,arm64}`, `darwin/{amd64,arm64}`, `windows/{amd64,arm64}`.

### Decision

If the stack is TypeScript, use Bun. Choose Go instead if Windows is a first-class target with paying users from day one, because of maturity on the platform where storage is most treacherous.

Rust is a legitimate third option if you want tighter control over zero-copy reads. `memmap2` covers all three platforms well. Given the decision to drop mmap, that advantage mostly evaporates.

### The insurance that makes this reversible

Write the on-disk format specification as its own document, separate from the implementation. The `.tnt` layout, section ordering, hash algorithm, naming scheme.

The format is the durable artifact and the reader is disposable. If Bun disappoints as a daemon in two years, rewrite the reader in Go against the same bytes and nobody migrates anything.

## Part 10: Distribution and signing

Build matrix is one CI job producing six binaries.

Install channels: Homebrew tap for macOS and Linux, Scoop or winget for Windows, a `curl | sh` script, plus plain GitHub Releases.

Signing is the friction that surprises people. A binary downloaded through a browser hits Gatekeeper on macOS, which blocks it without a Developer ID and notarization at 99 USD per year. Windows SmartScreen warns without a code signing certificate, a few hundred USD per year.

`brew install` and `curl | sh` bypass macOS quarantine, and `scoop` or `winget` soften it on Windows. If the audience is developers, start with those channels and defer signing. For anything wider, budget it now.

### Signing arrives earlier than expected

Apple Silicon does not merely warn about unsigned binaries, it refuses to run them. The kernel sends SIGKILL before any code executes, so a broken signature looks like a program that produces no output and exits 137.

Bun 1.3.12 walks straight into this. It writes a truncated `LC_CODE_SIGNATURE` on macOS arm64, so every `bun build --compile` output is dead on arrival, and `codesign` rejects the file outright with "invalid or unsupported format for signature". Removing the broken signature and re-signing ad-hoc is the only fix that holds. `scripts/build.ts` does this automatically on darwin.

The practical lesson for Part 9: the runtime choice carries platform risk beyond the obvious. This was macOS, the platform assumed to be safe, not Windows.

## Part 11: Backups

- **Full.** Copy `tenants/`. A tar is enough.
- **Incremental.** Snapshots are immutable and named by hash, so copying the missing ones is correct by construction, with no diff step.
- **Point in time.** Every retained snapshot is a full copy, so retention costs size times count. Cheap at the scale this targets, and the reason retention policy is still an open decision.
- **Restore.** Copy back, delete `derived/`, let it rebuild.
- **Audit.** `log.jsonl` is append-only and gives replay plus "who changed this".

Run the restore in CI weekly. An untested backup is not a backup.

## Part 12: Build order

1. Compiler from an OKF folder to `manifest.tsv`. On its own this captures most of the token win.
2. `.tnt` format, copy-on-write writer, atomic rename
3. Reader with batched `get`
4. Filesystem watcher for automatic sync
5. MCP server with the four verbs
6. Per-tenant BM25
7. GC for orphan snapshots and blobs

Steps 1 to 3 are roughly two days and already usable. Stop after each and measure before continuing.

Rough totals: portable embedded core 3 to 4 days, daemon with socket and pipe 1 day, HTTP server with auth 2 days, build matrix and installers 1 day. The Windows traps in Part 8 are the bulk of the schedule risk.

Start embedded and only embedded, with tests running on all three platforms in CI from the first commit. A connection mode is easy to add later. Portability retrofitted is a rewrite.

## Settled decisions

- **Hash is sha256.** `Bun.CryptoHasher` does not support blake3. blake2b256 is available, but sha256 also lets you verify a blob with `shasum` from a shell, which matters for a store you want to inspect and back up by hand.
- **Zero runtime dependencies.** `Bun.YAML.parse` handles OKF frontmatter including the nested v0.2 `sources` array, and `Bun.Glob` handles directory walking.

## Open decisions

- Whether agents get `put`, or writes stay human-only through the source folder
- Whether to keep OKF as the literal on-disk source, or accept any Markdown and treat OKF conformance as an export target
- Embedding-based search, or BM25 only for v1. BM25 first, since it has no model dependency and no index-refresh problem.
- Retention policy for old snapshots

## References

- [How the Open Knowledge Format can improve data sharing, Google Cloud Blog](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing)
- [GoogleCloudPlatform/knowledge-catalog](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/README.md)
- [OKF ecosystem tools](https://okf.md/tools/)
- [BundleDex, the OKF bundle directory](https://bundledex.net/)
- [okf-agents, LangChain and LangGraph](https://github.com/RonCodes88/okf-agents)
- [okf-mcp](https://github.com/hdean-ssp/okf-mcp)
- [Bun single-file executables](https://bun.com/docs/bundler/executables)
- [Bun.mmap API reference](https://bun.com/reference/bun/mmap)
