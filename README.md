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

For Claude Code, register it once:

```sh
claude mcp add langonrock -- langonrock mcp "okf:///abs/path/to/data?tenant=acme"
```

Any connection string works here, so point it at a [running daemon](#running-a-server) instead and every agent invocation shares one process with warm indexes rather than paying cold start:

```sh
claude mcp add langonrock -- langonrock mcp "okf+unix:///tmp/okf.sock?tenant=acme"
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

Every number below comes from one script, on one machine. Reproduce it with `bun bench/run.ts <bundles> <concepts per bundle>`, which prints a JSON line: `1 500` for the token tables, `10 500` and `40 500` for the scale rows.

### Tokens, 500 concepts in one bundle

A session is twenty questions in one conversation. Content read once stays in context and costs the cache rate on every later call. Both paths pay under that same model.

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

That table leaves memory out on purpose. The store rebuilds the index in memory once per snapshot, and peak process memory at 20,000 concepts landed anywhere between 0.9 and 1.2 GB across runs, too noisy for a single figure to be worth printing. It is still the practical ceiling on how many large tenants one daemon can hold.

### Retrieval accuracy

Whether the concept that answers the question is in the top eight, over the same twenty questions on 500 concepts.

| Retrieval                                  | Hit rate |  MRR |
| ------------------------------------------ | -------: | ---: |
| OKF BM25 over raw Markdown                 |      70% | 0.43 |
| langonrock BM25                            |      65% | 0.26 |
| langonrock BM25 plus the one-hop expansion |  **75%** | 0.27 |

Queries that describe a concept rather than name it land at 95% on both sides.

> [!IMPORTANT]
> The store ranks worse than the raw files on mean reciprocal rank, and that is a real cost of compiling. The frontmatter the compiler strips repeated the concept id in its `resource` and `sources` URLs, which happened to help the ranker. Field weighting recovers the hit rate and the one-hop expansion passes it, but the top position is still better on raw Markdown.

> [!NOTE]
> Numbers come from a synthetic corpus and a deliberately crude `chars / 4` token estimate. The retrieval table covers a single scale only, because the generator reuses descriptions across bundles, which makes description queries measure the corpus rather than the index. Treat all of this as an order of magnitude and measure your own bundles.

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
