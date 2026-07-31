# langonrock

[![ci](https://github.com/langonrock/langonrock/actions/workflows/ci.yml/badge.svg)](https://github.com/langonrock/langonrock/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-blue.svg)
![runtime](https://img.shields.io/badge/bun-%E2%89%A5%201.3-black.svg)

**A multi-tenant store for [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog) bundles, built so an agent spends as few tokens and as few round trips as possible reading them.**

OKF is a good authoring format: a directory of Markdown with YAML frontmatter, no SDK, no runtime, readable in Obsidian and diffable in git. It is an expensive _reading_ format. Full frontmatter is paid on every read, prose is written for people, and the reference consumption pattern walks the graph one file at a time, spending an inference turn per hop.

langonrock keeps your Markdown as the source of truth and compiles it into a dense read-side artifact: a manifest the agent keeps in its cached prompt prefix, and section-addressable concepts it fetches in batches. Your bundles stay conformant, so `okflint`, the visualizer and Obsidian keep working on the same folder.

## Why

Measured against the OKF reference consumption pattern over the same corpus and the same twenty questions:

|                                         | OKF navigator | langonrock |
| --------------------------------------- | ------------: | ---------: |
| Tokens billed for a 20-question session |       116,357 | **64,355** |
| Tool calls                              |            30 |     **17** |
| Tokens for one concept read             |           594 |    **213** |

The saving is not that TSV is denser than Markdown. It is that the manifest carries the link graph, so the agent knows every id it needs _before_ fetching anything and gets them in one batched call, and that a concept is addressable by section instead of whole.

Full numbers, including where the store loses, are in [Benchmarks](#benchmarks).

## Features

- **Compiles OKF, does not replace it.** Your directory of Markdown stays the source of truth and stays conformant.
- **A manifest that fits in the prompt.** One dense TSV row per concept: id, bundle, kind, status, grain, summary, outgoing links.
- **Byte-deterministic output.** Identical input compiles to identical bytes, so the manifest stays in the prompt cache across rebuilds.
- **Section addressing.** `get(id, "schema")` returns one slice instead of the whole document, using the concept's own Markdown headings.
- **Batched reads.** Pass every id you need in one call; N concepts cost one round trip.
- **Deterministic retrieval.** BM25 plus a capped one-hop expansion over the link graph, with no model call anywhere in the path.
- **Immutable, content-addressed snapshots.** A backup is a file copy, a restore is a file copy back, and a rollback is a side effect of naming files by their own hash.
- **Multi-tenant.** A tenant is a directory boundary with its own snapshots and its own index.
- **Three connection modes, one interface.** Embedded, local daemon, or HTTP server, selected by a connection string.
- **MCP server.** Four verbs for Claude Code, Cursor, or anything else that speaks MCP.
- **No database.** Two runtime dependencies, both for MCP.

## Quickstart

```sh
curl -fsSL https://raw.githubusercontent.com/langonrock/langonrock/main/install.sh | sh
```

Or run it from source with [Bun](https://bun.com):

```sh
bun install
bun src/cli.ts --help
```

Point it at a folder of bundles, where every immediate subdirectory is one bundle:

```
sources/acme/
  sales/
    tables/orders.md
    tables/customers.md
  ops/
    runbooks/deploy.md
```

```sh
langonrock sync sources/acme --data ./data --tenant acme
```

```
snapshot eaf251169a59 (new), 2 bundles [ops sales], 3 concepts, 850 bytes on disk
```

That is the whole write path. Read it back:

```sh
langonrock manifest --data ./data --tenant acme
```

```
# tenant: acme
# bundles: ops sales
id	bundle	kind	status	grain	summary	links
deploy	ops	runbook	-	-	How to ship the orders service.	-
customers	sales	bigquery_table	deprecated	customer_id	Registered customers, including churned.	-
orders	sales	bigquery_table	-	order_id	One row per completed customer order.	customers
```

Everything an agent needs to plan its reads is in those rows. A `status` cell other than `-` is the concept telling you it is not current. Then fetch only what you chose, and only the part you need:

```sh
langonrock get orders --section schema --data ./data --tenant acme
```

To keep the store following your edits, run the watcher instead of syncing by hand:

```sh
langonrock watch sources/acme --data ./data --tenant acme
```

Add a bundle by creating a folder, remove it by deleting the folder, change one by saving a file.

## Use it from an agent

```sh
langonrock mcp "okf://$PWD/data?tenant=acme"
```

For Claude Code, register it once:

```sh
claude mcp add langonrock -- langonrock mcp "okf:///abs/path/to/data?tenant=acme"
```

Four tools, and no more, because every tool definition costs tokens in the client's system prompt:

| Tool       | What it does                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `manifest` | The whole tenant, or one bundle with `bundle`. Also served as the MCP resource `okf://manifest`, so clients that preload resources get it in the cacheable prefix. |
| `search`   | BM25 over the manifest and bodies, plus a capped one-hop expansion. Returns manifest rows, never bodies.                                                           |
| `get`      | Concepts by id, batched, optionally one `section` each.                                                                                                            |
| `snapshot` | The current digest, to check whether the manifest you hold is stale.                                                                                               |

## Connection modes

The scheme picks the mode, and `open(dsn)` returns the same interface for all of them. Develop embedded, deploy remote, change nothing at the call site.

```
okf:///var/data?tenant=acme            embedded, direct file access
okf+unix:///tmp/okf.sock?tenant=acme   local daemon over a unix socket
okf+http://host:7777?token=...         remote, tenant resolved from the token
```

```sh
langonrock serve --data ./data --socket /tmp/okf.sock
langonrock query "okf+unix:///tmp/okf.sock?tenant=acme" search orders
```

The daemon is usually what you want locally: several clients share one process with warm indexes, so no agent invocation pays cold start.

> [!WARNING]
> Binding TCP always requires tokens, including on `127.0.0.1`, and the server refuses to start without them. A unix socket is already guarded by file permissions and is the only transport allowed to run unauthenticated. Windows has no named pipe support in Bun, so use loopback TCP there.

## Large tenants

The manifest costs around 40 tokens per concept, so it stops being worth reading whole somewhere past a few thousand of them. Narrow instead of paginating:

```ts
await connection.manifest('sales') // one bundle
await connection.search('orders', { bundle: 'ops' })
```

Rows are grouped by bundle in the snapshot, so one bundle is a contiguous slice the reader hands back without parsing. On a 20,000-concept tenant that is 20,486 tokens against 835,922 for the whole manifest, and the slice stays flat as the tenant grows.

## Library

```ts
import { open } from 'langonrock'

const knowledge = open('okf:///var/data?tenant=acme')

const manifest = await knowledge.manifest('sales')
const hits = await knowledge.search('order grain', { k: 5 })
const concepts = await knowledge.get(['orders', 'customers'], 'schema')
```

The compiler, store, reader, watcher and search are all exported too, if you want the pieces rather than the connection.

## How it is stored

```
data/
  tenants/acme/
    current              # one line: the active snapshot id
    snapshots/
      d735c5d3….tnt      # immutable, named by sha256 of its own bytes
      78de7c5c….tnt      # the previous version
    log.jsonl            # append-only audit
```

A snapshot is one self-contained file: the manifest uncompressed and contiguous, a directory of concept offsets and their section ranges, then zstd-compressed bodies. Writes go to a temp file, fsync, rename to the digest name, then an atomic rename of `current`. Readers take no lock, ever, because snapshots are immutable and a reader either sees the old one or the new one.

Because a snapshot is named by its own content, storing an unchanged tree is a no-op and deleting a bundle then restoring it returns to the original snapshot. Rollback is a side effect of the naming scheme rather than a feature.

**Backup** is `cp -r tenants/`. **Restore** is copying it back; the search index rebuilds itself in memory on first use. **Incremental** backup is copying the snapshots you do not have, correct by construction since names are hashes. `langonrock gc` keeps `current` plus the newest N and sweeps partial writes.

> [!IMPORTANT]
> The snapshot holds the compiled read model, not your bundle. Frontmatter is compiled away, so a store is not a backup of your Markdown. Keep the source folder in git.

## Benchmarks

A corpus generated to match the shape of Google's OKF samples: v0.2 frontmatter, prose written for people, `# Schema` and `# Joins` headings, links between concepts, about 2 KB each. Twenty fixed questions with a stated ground truth, and both paths charged for delivering the same concepts. The baseline is the OKF reference consumption pattern — read `index.md`, read a concept, follow its links — running the same BM25 this project uses over the raw Markdown, given perfect navigation and never taking a wrong turn.

Every number below comes from one script, on one machine. Reproduce it with `bun bench/run.ts <bundles> <concepts per bundle>`, which prints a JSON line: `1 500` for the token tables, `10 500` and `40 500` for the scale rows.

### Tokens, 500 concepts in one bundle

A session is twenty questions in one conversation, where content read once stays in context and is re-billed at the cache rate on every later call. Both paths pay under that same model.

| Path                | Billed tokens |  Calls |
| ------------------- | ------------: | -----: |
| OKF index navigator |       116,357 |     30 |
| langonrock          |    **64,355** | **17** |

| What a read costs                    |  Tokens |
| ------------------------------------ | ------: |
| OKF `read_concept`, the whole file   |     594 |
| `get(id)`, frontmatter compiled away |     445 |
| `get(id, "schema")`                  | **213** |
| One search result, eight rows        |     719 |

| What can go in the prompt |  Tokens |
| ------------------------- | ------: |
| The bundle in full        | 264,744 |
| `index.md`                |  16,575 |
| `manifest.tsv`            |  20,549 |

> [!NOTE]
> The manifest is **larger** than a well-kept `index.md` here. Density is not where the saving comes from; batching and section addressing are.

### Scale

| Concepts         |    500 |   5,000 |  20,000 |
| ---------------- | -----: | ------: | ------: |
| Whole manifest   | 20,549 | 205,851 | 835,922 |
| One bundle slice | 20,549 |  20,419 |  20,486 |
| Snapshot on disk | 0.5 MB |  5.0 MB | 20.1 MB |

### Latency, median milliseconds

| Operation                    |   500 | 5,000 | 20,000 |
| ---------------------------- | ----: | ----: | -----: |
| Compile and write a snapshot |    32 |   211 |    782 |
| Open a snapshot, cold        |  0.54 |  3.74 |   16.3 |
| Read the manifest, warm      | <0.01 | <0.01 |  <0.01 |
| Batched `get` of 3 sections  |  0.07 |  0.08 |   0.08 |
| Build the BM25 index         |    29 |   251 |  1,047 |
| BM25 query                   |  0.14 |  1.38 |   7.09 |

`get` is flat: batching a fetch costs the same on a tenant of twenty thousand concepts as on one of five hundred. None of this is where the time goes, though. One saved model round trip is worth about a second, four orders of magnitude more than any row above.

Memory is deliberately absent from that table. The index is rebuilt in memory once per snapshot, and peak process memory at 20,000 concepts landed anywhere between 0.9 and 1.2 GB across runs, too noisy for a single figure to be worth printing. It is still the practical ceiling on how many large tenants one daemon can hold.

### Retrieval accuracy

Whether the concept that answers the question is in the top eight, over the same twenty questions on 500 concepts.

| Retrieval                                  | Hit rate |  MRR |
| ------------------------------------------ | -------: | ---: |
| OKF BM25 over raw Markdown                 |      70% | 0.43 |
| langonrock BM25                            |      65% | 0.26 |
| langonrock BM25 plus the one-hop expansion |  **75%** | 0.27 |

Queries that describe a concept rather than name it land at 95% on both sides.

> [!IMPORTANT]
> The store ranks worse than the raw files on mean reciprocal rank, and that is a real cost of compiling. The frontmatter that gets stripped repeated the concept id in its `resource` and `sources` URLs, which happened to help the ranker. Field weighting recovers the hit rate and the one-hop expansion passes it, but the top position is still better on raw Markdown.

> [!NOTE]
> Numbers come from a synthetic corpus and a deliberately crude `chars / 4` token estimate, and the retrieval table is reported at a single scale because the generator reuses descriptions across bundles, which makes description queries measure the corpus rather than the index. Treat all of this as an order of magnitude and measure your own bundles.

## CLI

| Command         |                                                         |
| --------------- | ------------------------------------------------------- |
| `compile <dir>` | Compile one bundle to a manifest on stdout              |
| `put <dir>`     | Store one directory as one bundle                       |
| `sync <dir>`    | Store every subdirectory as its own bundle              |
| `watch <dir>`   | Keep a tenant in sync with a folder                     |
| `manifest`      | Print the stored manifest                               |
| `get <id…>`     | Fetch concepts by id                                    |
| `serve`         | Run the daemon                                          |
| `query <dsn> …` | `manifest`, `snapshot`, `search`, or `get` over any dsn |
| `mcp <dsn>`     | Serve MCP over stdio                                    |
| `gc`            | Collect old and partial snapshots                       |

Useful options: `--data` (store root), `--tenant`, `--section`, `--k`, `--summary-width`, `--strict` to exit non-zero on any diagnostic, `--dry-run` for `gc`. Run `langonrock --help` for the rest.

Without `--data`, the store lives in the platform data directory: `$XDG_DATA_HOME/langonrock` on Linux, `~/Library/Application Support/langonrock` on macOS, `%LOCALAPPDATA%\langonrock` on Windows. `$LANGONROCK_DATA` overrides it.

## Development

```sh
bun install
bun test
bun run lint
bun run typecheck
bun run build --target=bun-darwin-arm64
```

CI runs the suite on Linux, macOS and Windows. Pushing a `v*` tag cross-compiles six binaries, checksums them, and publishes a release.

> [!NOTE]
> While the repository is private, `install.sh` cannot download anonymously and falls back to an authenticated `gh release download`. Install `gh` and run `gh auth login` first, or grab the asset from the releases page.
