# langonrock

[![ci](https://github.com/langonrock/langonrock/actions/workflows/ci.yml/badge.svg)](https://github.com/langonrock/langonrock/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-blue.svg)
![runtime](https://img.shields.io/badge/bun-%E2%89%A5%201.3-black.svg)

**A multi-tenant store for [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog) bundles, built so an agent spends as few tokens and as few round trips as possible reading them.**

OKF is a good authoring format: a directory of Markdown with YAML frontmatter, no SDK, no runtime, readable in Obsidian and diffable in git. It is an expensive _reading_ format. The agent pays for full frontmatter on every read, the prose is written for people, and the reference consumption pattern walks the graph one file at a time, spending an inference turn per hop.

langonrock keeps your Markdown as the source of truth and compiles it into a dense read model: a manifest the agent keeps in its cached prompt prefix, and section-addressable concepts it fetches in batches. Your bundles stay conformant, so `okflint`, the visualizer and Obsidian keep working on the same folder.

## Why

Measured against the OKF reference consumption pattern over the same corpus and the same twenty questions:

|                                         | OKF navigator | langonrock |
| --------------------------------------- | ------------: | ---------: |
| Tokens billed for a 20-question session |       116,357 | **64,355** |
| Tool calls                              |            30 |     **17** |
| Tokens for one concept read             |           594 |    **213** |

The saving comes from the manifest carrying the link graph. The agent knows every id it needs _before_ it fetches anything, so one batched call covers them all, and it can ask for a single section instead of the whole concept. The manifest itself is not smaller than the Markdown it replaces.

That corpus is a warehouse catalogue, and the saving is a property of the documents rather than of the store. The same twenty-question harness over a set of RFCs saves 98 percent; over four novels it saves 2. Full numbers, including where the store loses, are in [Benchmarks](#benchmarks).

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
- **Refuses to leak its own credentials.** TCP needs a token, and any address past loopback needs TLS, or the server declines to start.
- **MCP server.** Four verbs for Claude Code, Cursor, or anything else that speaks MCP.
- **Editable over the network.** Create, change and delete concepts through the API, with a mandatory precondition so two editors cannot silently overwrite each other.
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

Add a bundle by creating a folder, remove it by deleting the folder, change one by saving a file. If you are going to run the daemon anyway, skip this command: [`serve` starts the same watcher itself](#running-a-server).

## Use it from an agent

```sh
langonrock mcp "okf://$PWD/data?tenant=acme"
```

That is an MCP server on stdio. There is no plugin and nothing to download: registering it only records the command a client should run, so the binary has to be on the machine first.

```sh
curl -fsSL https://raw.githubusercontent.com/langonrock/langonrock/main/install.sh | sh

claude mcp add langonrock -- langonrock mcp "okf:///abs/path/to/data?tenant=acme"
```

Everything after `--` is the command being registered, and the path in the connection string has to be absolute. The client is what starts the process, and its working directory is not yours.

At the start of each session the client runs that command, asks the server what it offers, and puts the four tool definitions in its system prompt. Nothing is discovered and nothing is fetched, so a server that fails to start shows up as tools that are quietly absent. `claude mcp list` is what tells you.

Any connection string works, so point it at a [running daemon](#running-a-server) and every agent invocation shares one process with warm indexes rather than paying cold start:

```sh
claude mcp add langonrock -s project -- langonrock mcp "okf+unix:///tmp/okf.sock?tenant=acme"
```

`-s project` writes to `.mcp.json` in the repository instead of your own settings, so committing it hands the same knowledge to everyone who clones. That only works if the connection string resolves on their machines too, which in practice means a socket or a server rather than a path.

> [!TIP]
> MCP is not the only way in. A client that can run shell commands can call the CLI directly, with a line in its instructions saying the command exists. The four tool definitions cost tokens in every session whether or not anyone asks about knowledge, and a line of prose costs almost nothing but relies on the model remembering. Register the server when knowledge is consulted constantly, and reach for the CLI when it is occasional.

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
okf+https://host:7777?token=...        the same over tls
```

The daemon is usually what you want locally. Several clients share one process with warm indexes, so no agent invocation pays cold start.

## Running a server

This needs two directories. Your Markdown lives wherever you already keep it, and the store is a separate folder the server owns.

```sh
mkdir -p ~/okf/sources/acme/sales ~/okf/data
echo '{ "acme": "/home/me/okf/sources/acme" }' > ~/okf/data/sources.json
```

`sources.json` maps each tenant to its folder. Write that path in full, because nothing expands `~` inside a JSON string. The file does two things at once: it makes the tenant writable over the API, and it tells `serve` to compile the folder at startup and keep watching it.

```sh
langonrock serve --data ~/okf/data --socket /tmp/okf.sock
```

```
snapshot 9ac37f10832c (new), 1 bundle [sales], 1 concepts, 342 bytes on disk
watching /home/me/okf/sources/acme for tenant acme
langonrock serving /home/me/okf/data on /tmp/okf.sock (0 tokens, 1 writable tenant)
```

Those three lines say the whole story: it compiled, it is watching, and it is listening. You do not need a separate `sync` first, and you do not need `langonrock watch` in another terminal. Running both would put two watchers on one tenant.

Without `--socket` the daemon listens on `<data>/langonrock.sock`.

Progress goes to stderr so stdout stays clean for piping, and Bun paints anything written with `console.error` red. Those lines are status, not failures.

```sh
langonrock query "okf+unix:///tmp/okf.sock?tenant=acme" search orders
```

> [!TIP]
> `ENOENT: no such file or directory, watch '...'` at startup means a path in `sources.json` does not exist. The folder has to be there before the server starts, and every immediate subdirectory of it is a bundle, so `sources/acme/sales/orders.md` works where `sources/acme/orders.md` gives you an empty tenant.

### Over TCP, with a password

The password is a bearer token in `<data>/tokens.json`. Mint one rather than inventing it, because that token is the whole of the authentication:

```sh
langonrock token --data ~/okf/data --tenant acme            # read-only
langonrock token --data ~/okf/data --tenant acme --write    # may edit source
```

```
9f3c1e…  (64 hex characters, on stdout so you can capture it)
recorded a read-only grant for acme in ~/okf/data/tokens.json. A running
server reads that file only at startup, so restart it before the token works
```

The command appends to the file, keeps whatever is already in it, and leaves it at mode `600`. You can still write it by hand: a bare string is a read-only grant, an object opts a token into writing.

```json
{
  "read-only": "acme",
  "editor-token": { "tenant": "acme", "write": true }
}
```

```sh
langonrock serve --data ~/okf/data --host 127.0.0.1 --port 7777
langonrock query "okf+http://127.0.0.1:7777?token=$TOKEN" manifest
```

> [!WARNING]
> Binding TCP always requires tokens, including on `127.0.0.1`, and the server refuses to start without them. A unix socket is already guarded by file permissions and is the only transport allowed to run unauthenticated. Windows has no named pipe support in Bun, so use loopback TCP there.

> [!IMPORTANT]
> Tokens are read once, at startup. Adding one or revoking one by editing the file changes nothing until the server restarts, so a token you believe you have withdrawn keeps working until then.

### Over TLS

A bearer token is only as private as the connection carrying it, so anything past loopback needs a certificate.

```sh
langonrock serve --data ~/okf/data --host 0.0.0.0 --port 7777 \
  --tls-cert /etc/langonrock/fullchain.pem \
  --tls-key /etc/langonrock/privkey.pem
```

```sh
langonrock query "okf+https://knowledge.example.com:7777?token=$TOKEN" manifest
```

The server refuses to bind anything but `127.0.0.1`, `::1` or `localhost` in cleartext, and says so instead of starting:

```
refusing to serve 0.0.0.0 without tls: every request would carry its token in
cleartext. Pass tls, or bind 127.0.0.1 and terminate tls in a proxy in front
```

Both shapes are fine. Terminate TLS here, or bind loopback and let nginx or Caddy do it. What the server will not do is put your token on the wire in the clear.

### Reading it over plain HTTP

The token decides the tenant, so the path only needs one when the server has no tokens at all.

```
GET  /v1/{tenant}/manifest[?bundle=sales]  the manifest, ETag is the snapshot digest
GET  /v1/{tenant}/snapshot                 {"snapshot": "…", "concepts": n}
POST /v1/{tenant}/get                      {"ids": [...], "section"?: "schema"}
POST /v1/{tenant}/search                   {"q": "...", "k"?: n, "expand"?: false, "bundle"?: "..."}
```

```sh
curl -H 'Authorization: Bearer read-only' http://127.0.0.1:7777/v1/manifest

curl -X POST -H 'Authorization: Bearer read-only' -H 'content-type: application/json' \
  -d '{"ids":["orders"],"section":"schema"}' http://127.0.0.1:7777/v1/get
```

Send `If-None-Match` with the ETag you hold and an unchanged manifest answers `304` with no body.

## Editing over the network

An editor needs to create, change and delete concepts remotely. It does that by writing the **source Markdown**, never a snapshot. The watcher recompiles from source, so it would overwrite a snapshot written directly within seconds. Writing source is the path the design endorses, and it leaves the read API above untouched. No HTTP request ever writes a snapshot.

The two files from [Running a server](#running-a-server) are what turn this on. `sources.json` says where a tenant's Markdown is, and `tokens.json` says which tokens may change it. A tenant with no entry in `sources.json` stays readable and refuses writes, which is the right default and needs no flag. Folders are never moved into the store; source usually lives in a git repository of its own.

```
GET    /v1/{tenant}/source                 list files with sizes and hashes
GET    /v1/{tenant}/source/{bundle}/{path} read one, ETag is its content hash
PUT    /v1/{tenant}/source/{bundle}/{path} write
DELETE /v1/{tenant}/source/{bundle}/{path} delete
DELETE /v1/{tenant}/bundles/{bundle}       delete a whole bundle
POST   /v1/{tenant}/sync                   recompile now, return the new digest
```

Writing the first file into a folder creates the bundle, and deleting the folder removes it, exactly as it works on disk.

> [!IMPORTANT]
> A write must name the version it replaces: `If-Match: "<hash>"` to overwrite, or `If-None-Match: *` to insist the concept is new. Neither header is a `428`, a stale hash is a `412`. Two people editing one concept is the normal case for an editor, and a silently lost update is the worst failure this API could have, so the unsafe call is impossible rather than discouraged.

Through the library the precondition is an argument, enforced identically whether you are embedded or remote:

```ts
const knowledge = open('okf+https://host:7777?token=editor-token')

const before = await knowledge.readSource('sales', 'tables/orders.md')
await knowledge.writeSource('sales', 'tables/orders.md', edited, before?.hash)
await knowledge.writeSource('sales', 'metrics/new.md', created) // no hash: must not exist
const { snapshot } = await knowledge.sync()
```

The listing tells you which concept each file becomes, so a client never has to reimplement the naming rule:

```json
{
  "bundle": "sales",
  "path": "tables/orders.md",
  "id": "sales/orders",
  "hash": "…",
  "bytes": 412
}
```

A file with no `id` is not a concept. It has no frontmatter, so the compiler skips it. That is how a cloned repository's `README.md` shows up as what it is instead of vanishing without explanation.

`sync` returns what the compiler noticed on the way: a missing `type`, a link resolving to nothing, a file skipped. That is the lint an editor should put in front of whoever is writing.

```ts
const { snapshot, diagnostics } = await knowledge.sync()
```

> [!WARNING]
> Concept ids are the shortest unambiguous form of their path, so **creating** a file can rename a concept nobody touched: adding `staging/orders.md` turns an existing `orders` into `tables/orders`. Re-read the listing or the manifest after a sync rather than assuming ids are stable.

`PUT` returns as soon as the file is on disk, so saving is fast; the snapshot follows on the watcher's debounce. Call `sync` when you need the new digest immediately. On a large tenant a compile is a few hundred milliseconds, so an aggressively autosaving editor should raise `--debounce` rather than sync on every keystroke.

The same verbs are on the command line against any connection string, so you can edit a local store and a remote one the same way:

```sh
langonrock query "$DSN" source                              # list, with hashes
langonrock query "$DSN" read sales tables/orders.md         # content out, hash on stderr
langonrock query "$DSN" write sales metrics/new.md --create < new.md
langonrock query "$DSN" write sales tables/orders.md --replaces "$HASH" < edited.md
langonrock query "$DSN" delete sales tables/old.md --force
langonrock query "$DSN" sync
```

`--create`, `--replaces <hash>` and `--force` are the command-line spelling of the same precondition. There is no default. The server refuses a write that says nothing, and `--force` is the honest name for taking whatever is there right now.

## Large tenants

The manifest costs around 40 tokens per concept, so it stops being worth reading whole somewhere past a few thousand of them. Narrow instead of paginating:

```ts
await connection.manifest('sales') // one bundle
await connection.search('orders', { bundle: 'ops' })
```

The snapshot groups rows by bundle, so one bundle is a contiguous slice the reader hands back without parsing. On a 20,000-concept tenant that is 20,486 tokens against 835,922 for the whole manifest, and the slice stays flat as the tenant grows.

## Library

```ts
import { open } from 'langonrock'

const knowledge = open('okf:///var/data?tenant=acme')

const manifest = await knowledge.manifest('sales')
const hits = await knowledge.search('order grain', { k: 5 })
const concepts = await knowledge.get(['orders', 'customers'], 'schema')
```

The compiler, store, reader, watcher and search are all exported too, if you want the pieces rather than the connection.

### From an app that is not on Bun

The package above needs Bun. The store uses `Bun.file`, `Bun.Glob`, `Bun.YAML` and zstd, none of which exist on Node. A desktop editor usually cannot import it, because Electron's main process is Node and Tauri's front end is a webview.

`langonrock/client` is the same `Connection` over the network only, with nothing under it but `fetch`:

```ts
import { connect } from 'langonrock/client'

const knowledge = connect('okf+http://127.0.0.1:7777?token=...')
const before = await knowledge.readSource('sales', 'tables/orders.md')

await knowledge.writeSource('sales', 'tables/orders.md', edited, before?.hash)
await knowledge.sync()
```

It runs on Node, Deno, Electron, Tauri and the browser, and a test asserts that rather than trusting it. The test bundles the entry point for Node and fails on any `Bun.` reference or filesystem import.

For a desktop app the shape that works is one HTTP client with two configurations. Locally, ship the `langonrock` binary as a sidecar and spawn `langonrock serve --socket <path>`; remotely, point the same client at a server with a token. The client refuses an embedded `okf://` string with an explanation rather than failing silently, since it has no filesystem to open.

> [!NOTE]
> Windows has no unix socket here, so a local sidecar there means loopback TCP, and the server refuses TCP without tokens. Generate one per session and pass it in the connection string.

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

Backup is `cp -r tenants/`. Restore is copying it back; the search index rebuilds itself in memory on first use. Incremental backup is copying the snapshots you do not have, correct by construction since names are hashes. `langonrock gc` keeps `current` plus the newest N and sweeps partial writes.

> [!IMPORTANT]
> The snapshot holds the compiled read model, not your bundle. Frontmatter is compiled away, so a store is not a backup of your Markdown. Keep the source folder in git.

## Benchmarks

A corpus generated to match the shape of Google's OKF samples: v0.2 frontmatter, prose written for people, `# Schema` and `# Joins` headings, links between concepts, about 2 KB each. Twenty fixed questions with a stated ground truth, and both paths charged for delivering the same concepts. The baseline is the OKF reference consumption pattern: read `index.md`, read a concept, follow its links. It runs the same BM25 this project uses over the raw Markdown, with perfect navigation and never a wrong turn.

Every number below comes from one script, on one machine. Reproduce it with `bun bench/run.ts [profile] [bundles] [concepts per bundle]`, which prints a JSON line: `1 500` for the token tables, `10 500` and `40 500` for the scale rows, and a profile name for [the other document shapes](#document-shape).

### Tokens, 500 concepts in one bundle

A session is twenty questions in one conversation. Content read once stays in context and costs the cache rate on every later call. Both paths pay under that same model.

| Path                               | Billed tokens |  Calls |
| ---------------------------------- | ------------: | -----: |
| OKF index navigator                |       116,357 |     30 |
| langonrock, manifest in the prompt |    **64,355** | **17** |
| langonrock, search first           |        56,394 |     36 |

The store has two strategies and the benchmark bills both. Keeping the manifest in the cached prefix costs the fewest round trips, which is the one this project optimises for. Ranking first and fetching what ranked never reads the manifest at all, which is cheaper in tokens here and much cheaper on a large tenant, at one extra turn per question. [Document shape](#document-shape) has the crossover.

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
| Snapshot on disk | 0.5 MB |  5.1 MB | 20.7 MB |

### Latency, median milliseconds

| Operation                    |   500 | 5,000 | 20,000 |
| ---------------------------- | ----: | ----: | -----: |
| Compile and write a snapshot |    31 |   253 |    829 |
| Open a snapshot, cold        |  0.55 |  4.45 |   17.6 |
| Read the manifest, warm      | <0.01 | <0.01 |  <0.01 |
| Batched `get` of 3 sections  |  0.08 |  0.11 |   0.09 |
| Build the BM25 index         |    22 |   193 |    674 |
| BM25 query                   |  0.10 |  0.55 |   1.83 |

`get` is flat: batching a fetch costs the same on a tenant of twenty thousand concepts as on one of five hundred. None of this is where the time goes, though. One saved model round trip is worth about a second, four orders of magnitude more than any row above.

That table leaves memory mostly out on purpose. The store rebuilds the index in memory once per snapshot, and peak process memory at 20,000 concepts landed around 0.85 GB — down by roughly a third since the postings moved into typed arrays and the build stopped holding every body at once. It is still the practical ceiling on how many large tenants one daemon can hold. The index build itself streams the bodies off a single read of the snapshot's blob region, and `serve` rebuilds the index right after each sync, so the first search after a save does not pay for it.

### Retrieval accuracy

Whether the concept that answers the question is in the top eight, over the same twenty questions on 500 concepts.

| Retrieval                                  | Hit rate |      MRR |
| ------------------------------------------ | -------: | -------: |
| OKF BM25 over raw Markdown                 |      70% |     0.43 |
| langonrock BM25                            |      70% |     0.43 |
| langonrock BM25 plus the one-hop expansion |  **75%** | **0.44** |

The last row is what you get without configuring anything. Expansion is on unless a caller passes `expand: false`, which is what the middle row measures, and the CLI and the MCP tools offer no way to turn it off at all.

Queries that describe a concept rather than name it land at 95% on both sides.

> [!IMPORTANT]
> Compiling no longer costs ranking. The frontmatter the compiler strips used to repeat the concept id in its `resource` and `sources` URLs, which happened to help the ranker, and for a while the store ranked worse than the raw files because of it. Indexing the concept's own names — its id and its frontmatter `title`, weighted above the other cells — recovers all of it: the store now matches raw Markdown on mean reciprocal rank and passes it on hit rate with the expansion on.

> [!NOTE]
> Everything above this point comes from a synthetic corpus and a deliberately crude `chars / 4` token estimate. The retrieval table covers a single scale only, because the generator reuses descriptions across bundles, which makes description queries measure the corpus rather than the index. Treat all of this as an order of magnitude and measure your own bundles.

### Document shape

Everything above describes a warehouse catalogue. To find out what the store does to documents that are not reference tables, the same harness runs over four real public-domain corpora, converted to OKF concepts mechanically: frontmatter is `type` and `title`, headings are the document's own, and no link, table or section is added that the source does not already have.

| Profile             | What it is                                                     | Concepts |
| ------------------- | -------------------------------------------------------------- | -------: |
| `reference`         | Generated warehouse catalogue, the corpus used above           |      500 |
| `scripture`         | The King James Bible, one concept per chapter                  |    1,189 |
| `scripture-coarse`  | The same text, one concept per book, chapters as headings      |       66 |
| `book`              | Four novels, one concept per chapter                           |      102 |
| `book-coarse`       | The same text, one concept per novel, chapters as headings     |        4 |
| `handbook`          | Mrs Beeton's _Book of Household Management_, one per recipe    |    1,282 |
| `handbook-untitled` | The same recipes with no `title` field, the name left as an H1 |    1,282 |
| `spec`              | Twenty-eight IETF RFCs, one concept per document               |       28 |

Twenty questions per profile, ground truth stated the same way, every path charged for delivering the same concepts. `manifest` is the manifest-in-the-prompt strategy, `search` is search-first; the store's cost is the better of the two.

| Profile            |    Corpus | `manifest.tsv` | OKF billed |  `manifest` |   `search` | Saving |
| ------------------ | --------: | -------------: | ---------: | ----------: | ---------: | -----: |
| `spec`             |   767,143 |          1,176 |    756,168 |  **13,995** |     52,033 |    98% |
| `scripture-coarse` | 1,067,694 |          2,028 |  1,278,420 |  **39,395** |     67,020 |    97% |
| `handbook`         |   613,230 |         26,198 |    125,798 |      71,797 | **19,874** |    84% |
| `book-coarse`      |   343,265 |            113 |    338,296 | **122,236** |    186,451 |    64% |
| `scripture`        | 1,076,465 |         38,283 |    159,174 |     148,029 | **75,207** |    53% |
| `reference`        |   264,744 |         20,549 |    116,357 |      64,355 | **56,394** |    52% |
| `book`             |   344,540 |          1,772 |    130,101 | **127,077** |    188,093 |     2% |

Round trips are not in that table because they are the same everywhere: the manifest strategy spends 16 to 21 calls, search-first spends 35 to 40. Search-first buys tokens with one extra turn per question, and this project treats a turn as the expensive resource.

| Profile     | OKF `read_concept` | `get(id)` | `get(id, section)` |
| ----------- | -----------------: | --------: | -----------------: |
| `spec`      |             23,439 |    23,321 |            **388** |
| `book`      |              3,261 |     3,244 |              3,244 |
| `scripture` |                852 |       841 |                841 |
| `reference` |                594 |       445 |            **213** |
| `handbook`  |                292 |       279 |             **87** |

The ordering is not by corpus size. It is by how much structure the document already carries, and two things pay:

- **Headings.** `get(id, section)` can only return a slice if the document names its slices. An RFC numbers every subsection, so a question about one costs 388 tokens instead of 23,439. A Bible chapter and a novel chapter have no headings at all, so the section read and the whole read are the same read.
- **Links.** Batching saves a round trip only when the manifest knows which concepts belong together. Mrs Beeton's "No. 105" cross-references and the RFC citation graph both compile into the `links` column. The Bible and the novels have none, so the store spends exactly as many turns as the navigator.

What is left when a corpus has neither is the frontmatter the compiler strips, and on real prose that is almost nothing: 17 tokens per chapter on the novels, 11 on the Bible, against the 149 a full OKF sample header costs.

> [!IMPORTANT]
> On prose with no headings and no links, langonrock is worth about two percent. The advantage is not compression and it does not come from having a store; it comes from documents that were already structured. A folder of chapters is better served by reading the files.

#### Which strategy, and when

The manifest is paid once and amortised over the session; a search is paid per question. That puts the crossover at a fixed ratio rather than a corpus size.

| Profile            | `manifest.tsv` | One search result | Ratio | Cheaper  |
| ------------------ | -------------: | ----------------: | ----: | -------- |
| `handbook`         |         26,198 |               256 |   102 | search   |
| `scripture`        |         38,283 |               427 |    90 | search   |
| `reference`        |         20,549 |               719 |    29 | search   |
| `book`             |          1,772 |               165 |    11 | manifest |
| `scripture-coarse` |          2,028 |               288 |     7 | manifest |
| `spec`             |          1,176 |               649 |     2 | manifest |

Over twenty questions the crossover lands near twenty. Below it, keep the manifest in the prompt and pay for it once; above it, never read the manifest and rank instead. The store already exposes both, and the MCP tool descriptions already say so; nothing here needs a code change, only the right call.

#### Concept grain is a corpus decision with a large price

`scripture` and `scripture-coarse` are the same 1,189 chapters of the same text. The only difference is whether a chapter is a concept or a heading inside a concept.

| Bible, manifest strategy | Manifest | 20 reads | Manifest re-read at cache rate |      Total |
| ------------------------ | -------: | -------: | -----------------------------: | ---------: |
| One concept per chapter  |   38,283 |   16,820 |                        ~93,000 |    148,029 |
| One concept per book     |    2,028 |   16,900 |                        ~20,500 | **39,395** |

Seventy-three percent cheaper, and the store is byte-for-byte the same. What changed is that 1,189 rows re-read on every turn became 66, while the read stayed one chapter (845 tokens against 841) because chapters became addressable sections. Nearly two thirds of the original bill was the manifest, not the text.

It does not generalise to the novels: `book` to `book-coarse` saves 4 percent, because their manifest was 1,772 tokens to begin with and the cost is the 3,244-token chapter itself. Coarsening helps a corpus whose manifest is large, not one whose documents are large. For the novels, the smallest addressable unit is still a whole chapter, and only sub-document sections would change that.

> [!NOTE]
> The OKF column moves too, and against the baseline. At book grain `read_concept` returns a whole book of the Bible, 34,430 tokens, so the baseline's bill goes from 159,174 to 1,278,420. The honest comparison for a grain change is store against store.

Retrieval over the same questions, top eight:

| Profile     | OKF raw Markdown | langonrock |  plus expansion |
| ----------- | ---------------: | ---------: | --------------: |
| `spec`      |       95% / 0.74 | 95% / 0.80 | **100% / 0.81** |
| `handbook`  |       90% / 0.71 | 95% / 0.83 | **100% / 0.83** |
| `scripture` |       90% / 0.80 | 90% / 0.80 |      90% / 0.80 |
| `reference` |       70% / 0.43 | 70% / 0.43 |  **75% / 0.44** |
| `book`      |       80% / 0.72 | 80% / 0.69 |      80% / 0.69 |

The store meets or beats the raw files everywhere except the novels' top position, where prose with no headings and no links gives the compiler nothing to work with. `handbook` is the profile that used to prove the opposite — 50% against the baseline's 90% — and what it was measuring was a design cost, not noise: Mrs Beeton numbers her recipes, so the id is `recipe_181` and the words "rabbit soup" lived only in the `title` the compiler strips. The index now folds every concept's title in next to its id, weighted above the other fields, and the penalty is gone.

`handbook-untitled` is the same bundle with the title moved out of the frontmatter and into the body as an H1, which is what a document that was downloaded rather than authored looks like. It used to beat the titled bundle by thirty-five points; now it is the control that shows the fold works:

| Where the title lives      | langonrock | plus expansion |  MRR |
| -------------------------- | ---------: | -------------: | ---: |
| `title:` frontmatter       |    **95%** |       **100%** | 0.83 |
| An H1 in the body          |        85% |            90% | 0.71 |
| Raw Markdown, the baseline |        90% |              — | 0.71 |

Indexing the title costs zero prompt tokens and no manifest width: it rides in the snapshot directory, never in a row the agent pays for on every turn.

> [!NOTE]
> The real corpora are downloaded on first run and cached in `bench/.cache`, so only the first run needs a network. They are converted by parsers written against one edition of each text; the harness fails loudly if an edition stops matching rather than benchmarking a corpus it silently mangled.

### The serving layer

Everything above measures reading. The rest of the store is a serving layer, and it has its own costs. `bun bench/ops.ts [profile] [bundles] [concepts per bundle]` prints these; they are medians over repeated runs on one machine.

|                                | 500 concepts | 1,189, `scripture` | 5,000 concepts |
| ------------------------------ | -----------: | -----------------: | -------------: |
| Snapshot on disk               |      0.52 MB |            2.08 MB |        5.24 MB |
| Sync an unchanged tree         |      21.9 ms |            51.6 ms |       189.2 ms |
| Sync after editing one concept |      22.3 ms |            51.8 ms |       184.0 ms |
| Edit on disk, read to visible  |      23.1 ms |            52.3 ms |       197.4 ms |
| Resident memory per tenant     |      1.77 MB |            33.0 MB |        64.4 MB |

One query, by how you reached it. Cold is a fresh embedded invocation that has to build the index first; warm is the same question against an index already in memory in the same process; the socket row is a real `serve` over a unix socket, so it carries serialisation and IPC.

|                                   | 500 concepts | 1,189, `scripture` | 5,000 concepts |
| --------------------------------- | -----------: | -----------------: | -------------: |
| Cold: open, index, one query      |      27.5 ms |           151.9 ms |       237.0 ms |
| Warm, in process                  |     0.107 ms |           0.300 ms |       1.359 ms |
| Over a unix socket, a real daemon |     0.281 ms |           0.456 ms |       1.458 ms |
| Over a socket, read the manifest  |     0.101 ms |           0.117 ms |       0.119 ms |
| Over a socket, batched `get`      |     0.205 ms |           0.185 ms |       0.137 ms |
| Through MCP, the same search      |     0.272 ms |           0.490 ms |       1.450 ms |
| The same search, no MCP layer     |     0.158 ms |           0.330 ms |       1.403 ms |

**A daemon is worth 98 to 333 times.** Cold against the socket row, which is the honest pair: 27.5 against 0.281, 151.9 against 0.456, 237.0 against 1.458. An embedded invocation rebuilds the BM25 index from nothing before it can answer anything, and that is the whole of the difference.

**Transport is a fixed cost, not a proportional one.** The socket adds 0.10 to 0.17 ms over the in-process figure at every size, and the MCP layer adds another 0.05 to 0.16 ms. Neither grows with the corpus, so the larger the tenant the less either matters: at 5,000 concepts the socket costs 7 percent on top of the query and MCP costs 3.

The write path, through the HTTP source routes where the precondition lives:

|                                      | 500 concepts | 1,189, `scripture` | 5,000 concepts |
| ------------------------------------ | -----------: | -----------------: | -------------: |
| Read, then write naming its hash     |     0.656 ms |           0.664 ms |       0.797 ms |
| A write naming a stale hash, refused |     0.340 ms |           0.121 ms |       0.117 ms |
| Stale writes actually refused        |        5 / 5 |              5 / 5 |          5 / 5 |

**Losing a write race is cheap to discover.** A write that names the version it replaces costs under a millisecond end to end, and one that names a stale version is refused for less than that, because nothing is written. Every stale write in every run was refused rather than merged.

> [!NOTE]
> Those two tables are the corrected ones. An earlier revision reported the speed-up as 170 to 530 times by comparing cold start against the in-process warm figure, without ever starting a daemon. That excluded the transport a daemon actually adds, and overstated it by roughly 1.7 times.

**Immutability is paid in disk, linearly in edits.** A snapshot is one file named by its own hash and nothing is shared between two of them, so a one-line change writes a full copy. Ten edits leave eleven snapshots and eleven times the corpus on disk at every scale tested, which is 57.6 MB from a 5.2 MB corpus. Rollback really is free and a backup really is a file copy, but `gc` is not optional housekeeping; it is what makes the design affordable.

**A sync that changes nothing costs the same as one that changes something.** 21.9 ms against 22.3 ms, 189.2 against 184.0. Content addressing detects the no-op and correctly declines to write a new snapshot, but only after recompiling the whole tree. That is the watcher's steady-state cost per burst of filesystem events, and at 5,000 concepts it is 190 ms of work to conclude that nothing happened.

**Determinism holds.** Identical input compiled twice produces the same snapshot hash and the writer reuses it, at every size tested. That is what keeps the manifest in the client's prompt cache across a rebuild.

**Memory tracks bytes, not concepts.** Twelve to sixteen times the snapshot size resides in memory once indexed, so one daemon holds roughly fifteen tenants of 5,000 concepts per gigabyte. The heap delta around a single index build is unusable — it comes back negative as often as positive — so this is the slope of resident memory across tenants loaded one at a time.

| Registering the MCP server           | Tokens |
| ------------------------------------ | -----: |
| Four tool definitions, every session |    833 |

That is the entry fee, paid in the client's system prompt whether or not the model ever asks about knowledge, and it does not change with corpus size. It costs about one search result. Worth it when knowledge is consulted repeatedly, which is the same conclusion the tip above reaches, now with a number on it.

## CLI

| Command         |                                            |
| --------------- | ------------------------------------------ |
| `compile <dir>` | Compile one bundle to a manifest on stdout |
| `put <dir>`     | Store one directory as one bundle          |
| `sync <dir>`    | Store every subdirectory as its own bundle |
| `watch <dir>`   | Keep a tenant in sync with a folder        |
| `manifest`      | Print the stored manifest                  |
| `get <id…>`     | Fetch concepts by id                       |
| `serve`         | Run the daemon                             |
| `token`         | Mint a token and record its grant          |
| `query <dsn> …` | Any read or write verb over any dsn        |
| `mcp <dsn>`     | Serve MCP over stdio                       |
| `gc`            | Collect old and partial snapshots          |

`query` takes `manifest`, `snapshot`, `search` and `get` on the read side, and `source`, `read`, `write`, `delete`, `delete-bundle` and `sync` on the write side.

Useful options: `--data` (store root), `--tenant`, `--section`, `--k`, `--summary-width`, `--strict` to exit non-zero on any diagnostic, `--dry-run` for `gc`. For `serve`: `--socket`, or `--host` and `--port` for TCP, `--tls-cert` and `--tls-key` for TLS, and `--debounce` to coalesce filesystem events. For `token`: `--tenant` and `--write`. Run `langonrock --help` for the rest.

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
