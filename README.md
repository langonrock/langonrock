# langonrock

[![ci](https://github.com/langonrock/langonrock/actions/workflows/ci.yml/badge.svg)](https://github.com/langonrock/langonrock/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-blue.svg)
![runtime](https://img.shields.io/badge/bun-%E2%89%A5%201.4.2-black.svg)

**A multi-tenant store for [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog) bundles, built so an agent spends as few tokens and as few round trips as possible reading them.**

OKF is a good authoring format: a directory of Markdown with YAML frontmatter, no SDK, no runtime, readable in Obsidian and diffable in git. It is an expensive _reading_ format. The agent pays for full frontmatter on every read, the prose is written for people, and the reference consumption pattern walks the graph one file at a time, spending an inference turn per hop.

langonrock stores Markdown documents in its own native engine and compiles them into a dense read model: a manifest the agent keeps in its cached prompt prefix, and section-addressable concepts it fetches in batches. Atomic commits, history, and restore share that read model. Import and export preserve original Markdown; existing legacy tenants keep their source-folder workflow until explicitly migrated. See the [database guide](docs/dbms.md).

## Why

Measured against the OKF reference consumption pattern over the same corpus and the same twenty questions:

|                                         | OKF navigator | langonrock |
| --------------------------------------- | ------------: | ---------: |
| Tokens billed for a 20-question session |       116,357 | **64,355** |
| Tool calls                              |            30 |     **17** |
| Tokens for one concept read             |           594 |    **213** |

The saving comes from the manifest carrying the link graph. The agent knows every id it needs _before_ it fetches anything, so one batched call covers them all, and it can ask for a single section instead of the whole concept. The manifest itself is not smaller than the Markdown it replaces.

That corpus is a warehouse catalogue, and the saving depends on the documents more than on the store. Over a set of RFCs the same twenty questions save 98 percent. Over four novels they save 69 percent, and nearly all of that comes from `find`, which returns the passage instead of the chapter. Without it the novels save 2 percent. Full numbers, including where the store loses, are in [Benchmarks](#benchmarks).

## Features

- **Compiles any Markdown, keeps OKF as the bar.** Every file compiles, frontmatter or not, with its id, summary, title and links derived from the text; `--strict` is the OKF conformance gate. Import/export preserves the authoring format.
- **A manifest that fits in the prompt.** One dense TSV row per concept: id, bundle, kind, status, grain, summary, outgoing links.
- **Byte-deterministic output.** Identical input compiles to identical bytes, so the manifest stays in the prompt cache across rebuilds.
- **Section addressing.** `get(id, { section: "schema" })` returns one slice instead of the whole document, using the concept's own Markdown headings.
- **Sliced reads on any document.** `offset` and `limit` page a long concept, and `find` returns a window around a literal phrase plus the offset of every occurrence. Prose with no headings at all still gets addressable parts. Over MCP a read stops at 15,000 characters per concept by default, so a naive `get` cannot flood a model's context.
- **Batched reads.** Pass every id you need in one call; N concepts cost one round trip.
- **Deterministic retrieval.** BM25 plus a capped one-hop expansion over the link graph, with no model call anywhere in the path.
- **Search that points inside the document.** Every direct hit carries `pos`, the offset of the passage densest in the query's words, so the next `get` can be a 2,000-character window instead of the document, even when the question quotes nothing.
- **Knowledge that expires visibly.** A concept past its `stale_after` date shows `stale` in the manifest's status cell, computed at read time so the snapshot bytes never depend on the clock.
- **Atomic document transactions.** Commit related edits together, retain revision history, and restore a complete source revision as a new commit. Back up the complete tenant while writers and collection are stopped.
- **Multi-tenant.** A tenant is a directory boundary with its own snapshots and its own index.
- **Three connection modes, one interface.** Embedded, local daemon, or HTTP server, selected by a connection string.
- **Refuses to leak its own credentials.** TCP needs a token, and any address past loopback needs TLS, or the server declines to start.
- **MCP server.** Six verbs for Claude Code, Cursor, or anything else that speaks MCP, four to read and two to write. The server measures the manifest at startup, and the tool descriptions tell the model whether this tenant is cheaper to read manifest-first or search-first.
- **A model can persist knowledge, safely.** The MCP `write` and `delete` tools change a concept and recompile, and the first write creates a tenant that does not exist yet. Both still need the hash they replace, and the refusal names that hash, so a model satisfies the precondition without a lost update.
- **Editable over the network.** Create, change and delete concepts through the API, with a mandatory precondition so two editors cannot silently overwrite each other.
- **Own database engine.** No SQLite, external database service, or Python. Two runtime packages support MCP; a small C adapter supplies OS locks and durable file replacement.

## Quickstart

```sh
curl -fsSL https://raw.githubusercontent.com/langonrock/langonrock/main/install.sh | sh
```

Or run it from source with [Bun](https://bun.com):

```sh
bun install
bun run build:native
bun src/cli.ts --help
```

Source installation needs a C compiler for the native adapter, or an MSVC developer environment on Windows. Standalone binaries embed their adapter. Local validation of this conversion covers macOS arm64; Linux and Windows execution remains a release gate. See [installation and platform verification](docs/dbms.md#install-and-platform-verification).

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

Everything an agent needs to plan its reads is in those rows. A `status` cell other than `-` means the concept is not current. It says `deprecated`, `draft`, or `stale` once the `stale_after` date passes. Then fetch only what you chose, and only the part you need:

```sh
langonrock get orders --section schema --data ./data --tenant acme
```

To keep the store following your edits, run the watcher instead of syncing by hand:

```sh
langonrock watch sources/acme --data ./data --tenant acme
```

Add a bundle by creating a folder, remove it by deleting the folder, change one by saving a file. If you are going to run the daemon anyway, skip this command, because [`serve` starts the same watcher itself](#running-a-server).

## Use it from an agent

```sh
langonrock mcp "okf://$PWD/data?tenant=acme"
```

That is an MCP server on stdio. There is no plugin and nothing to download. Registering it only records the command a client should run, so the binary has to be on the machine first.

```sh
curl -fsSL https://raw.githubusercontent.com/langonrock/langonrock/main/install.sh | sh

claude mcp add langonrock -- langonrock mcp "okf:///abs/path/to/data?tenant=acme"
```

Everything after `--` is the command being registered, and the path in the connection string has to be absolute. The client starts the process, and its working directory is not yours.

At the start of each session the client runs that command, asks the server what it offers, and puts the six tool definitions in its system prompt. Nothing else is discovered or fetched, so a server that fails to start shows up only as missing tools. `claude mcp list` tells you whether it started.

Any connection string works, so point it at a [running daemon](#running-a-server) and every agent invocation shares one process with warm indexes rather than paying cold start:

```sh
claude mcp add langonrock -s project -- langonrock mcp "okf+unix:///tmp/okf.sock?tenant=acme"
```

`-s project` writes to `.mcp.json` in the repository instead of your own settings, so committing it hands the same knowledge to everyone who clones. That only works if the connection string resolves on their machines too, which in practice means a socket or a server rather than a path.

> [!TIP]
> MCP is not the only way in. A client that can run shell commands can call the CLI directly, with a line in its instructions saying the command exists. The six tool definitions cost 1,741 tokens in every session whether or not anyone asks about knowledge. A line of prose costs almost nothing but relies on the model remembering. Register the server when the model consults knowledge constantly, and use the CLI when it does so occasionally.

Only six tools are on by default, because every tool definition costs tokens in the client's system prompt. Add `--database-tools` to also expose `transact`, `history`, and `restore`:

| Tool       | What it does                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `manifest` | The whole tenant, or one bundle with `bundle`. Also served as the MCP resource `okf://manifest`, so clients that preload resources get it in the cacheable prefix. Its description states this tenant's measured manifest size and which read strategy is cheaper. |
| `search`   | BM25 over the manifest and bodies, plus a capped one-hop expansion. Returns manifest rows, never bodies; each direct hit ends in `pos`, the offset of the densest passage, for a windowed `get`.                                                                   |
| `get`      | Concepts by id, batched; optionally one `section`, an `offset`/`limit` window, or a `find` phrase to locate. Capped at 15,000 chars per concept by default.                                                                                                        |
| `snapshot` | The current digest, to check whether the manifest you hold is stale.                                                                                                                                                                                               |
| `write`    | Creates or replaces one concept, recompiles, and returns the new digest with that file's compiler warnings. Naming a new bundle creates it, and a tenant with no knowledge yet is created by the write itself.                                                     |
| `delete`   | Removes one concept and recompiles. The hash is required rather than optional, because deleting has no create case to spend the omission on.                                                                                                                       |

### Writing from a model

A model has no content hash, so the precondition that protects every other client would be unusable if it had to fetch one first. Instead the refusal carries what the retry needs:

```
write {bundle: "inbox", path: "idea.md", content: "..."}
  → concept already exists: re-read the concept and retry with its new hash
    retry with replaces: "968f33390cab..."

write {bundle: "inbox", path: "idea.md", content: "...", replaces: "968f33390cab..."}
  → wrote inbox/idea.md (hash 4c1e...), snapshot 19e8c4026a96, 1 concepts
```

Creating costs one call, because omitting `replaces` is what asserts the concept is new. Replacing costs two the first time, and none of them can silently lose someone else's edit.

`delete` works the same way, minus the create case. The hash is required there, so a deletion is always two calls. Omitting the hash for a concept that does not exist gets `concept does not exist` back, not a hash to retry with.

> A first write can create a new native tenant. Existing native tenants do not need a source-folder registration. Unmigrated legacy tenants still require their original source mapping for source edits; use [explicit migration](docs/dbms.md#migrate-a-legacy-tenant) before database transactions.

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

The daemon serves native tenants directly from its data directory. To also import and watch Markdown folders, register them in `sources.json`:

```sh
mkdir -p ~/okf/sources/acme/sales ~/okf/data
echo '{ "acme": "/home/me/okf/sources/acme" }' > ~/okf/data/sources.json
```

`sources.json` maps each tenant to a folder for startup import and watching. Write that path in full, because nothing expands `~` inside a JSON string. Native API writes commit to the database. If the folder and the database both changed a document differently, the next folder import reports a conflict instead of overwriting the database edit.

```sh
langonrock serve --data ~/okf/data --socket /tmp/okf.sock
```

```
snapshot 9ac37f10832c (new), 1 bundle [sales], 1 concepts, 342 bytes on disk
watching /home/me/okf/sources/acme for tenant acme
langonrock serving /home/me/okf/data on /tmp/okf.sock (0 tokens, 1 writable tenant)
```

Those three lines say it compiled, it is watching, and it is listening. You do not need a separate `sync` first, and you do not need `langonrock watch` in another terminal. Running both would put two watchers on one tenant.

Without `--socket` the daemon listens on `<data>/langonrock.sock`.

Progress goes to stderr so stdout stays clean for piping, and Bun paints anything written with `console.error` red. Those lines are status, not failures.

```sh
langonrock query "okf+unix:///tmp/okf.sock?tenant=acme" search orders
```

> [!TIP]
> `ENOENT: no such file or directory, watch '...'` at startup means a path in `sources.json` does not exist. The folder has to be there before the server starts, and every immediate subdirectory of it is a bundle, so `sources/acme/sales/orders.md` works where `sources/acme/orders.md` gives you an empty tenant.

### Over TCP, with a password

The password is a bearer token in `<data>/tokens.json`. Mint one rather than inventing it, because that token is the only authentication there is:

```sh
langonrock token --data ~/okf/data --tenant acme            # read-only
langonrock token --data ~/okf/data --tenant acme --write    # may edit source
```

```
9f3c1e…  (64 hex characters, on stdout so you can capture it)
recorded a read-only grant for acme in ~/okf/data/tokens.json. A running
server reads that file only at startup, so restart it before the token works
```

The command appends to the file, keeps whatever is already in it, and leaves it at mode `600`. You can still write it by hand. A bare string is a read-only grant, and an object can opt a token into writing.

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
> Binding TCP always requires tokens, including on `127.0.0.1`, and the server refuses to start without them. File permissions already guard a unix socket, so it is the only transport allowed to run without tokens. Windows has no named pipe support in Bun, so use loopback TCP there.

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
POST /v1/{tenant}/get                      {"ids": [...], "section"?, "offset"?, "limit"?, "find"?}
POST /v1/{tenant}/search                   {"q": "...", "k"?: n, "expand"?: false, "bundle"?: "..."}
```

`get` answers with one slice per id, `{"text", "start", "end", "total"}`, plus `"matches"` and `"matchCount"` when `find` was set. A caller always knows how much text exists beyond what it received.

```sh
curl -H 'Authorization: Bearer read-only' http://127.0.0.1:7777/v1/manifest

curl -X POST -H 'Authorization: Bearer read-only' -H 'content-type: application/json' \
  -d '{"ids":["orders"],"section":"schema"}' http://127.0.0.1:7777/v1/get
```

Send `If-None-Match` with the ETag you hold and an unchanged manifest answers `304` with no body.

## Editing over the network

An editor creates, changes, and deletes complete Markdown documents through the source routes. Native tenants commit each write atomically and make it immediately visible to manifest, search, and get. Use the transaction route to publish several edits together. The compiled read routes keep their existing response shapes.

`tokens.json` controls which tokens may write. The CLI daemon enables native writes; callers of the `serve()` library must explicitly set `writable: true` or configure their source authorization callback. `sources.json` remains optional for native tenants and selects folders to import/watch. Unmigrated legacy tenants still use their registered original Markdown sources.

```
GET    /v1/{tenant}/source                 list files with sizes and hashes
GET    /v1/{tenant}/source/{bundle}/{path} read one, ETag is its content hash
PUT    /v1/{tenant}/source/{bundle}/{path} write
DELETE /v1/{tenant}/source/{bundle}/{path} delete
DELETE /v1/{tenant}/bundles/{bundle}       delete a whole bundle
POST   /v1/{tenant}/sync                   return the current native commit; recompile legacy sources
POST   /v1/{tenant}/transact               atomic document batch
GET    /v1/{tenant}/history                retained revisions, with limit and before cursor
POST   /v1/{tenant}/restore                restore a revision as a new commit
```

Writing the first file into a folder creates the bundle, and deleting the folder removes it, exactly as it works on disk.

> [!IMPORTANT]
> A write must name the version it replaces. Send `If-Match: "<hash>"` to overwrite, or `If-None-Match: *` to insist the concept is new. A write with neither header gets `428`, and one with a stale hash gets `412`. Two people editing one concept is the normal case for an editor, and a silently lost update is the worst failure this API could have, so the unsafe call is impossible rather than discouraged.

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

A file with no `id` is a navigation document that the compiler excludes from concept reads. Its exact source still appears in source access and export. Ordinary Markdown can compile without frontmatter.

`sync` returns the current commit's compiler diagnostics: a missing `type`, a link resolving to nothing, or a skipped file. Native writes already committed those results; `sync` does not create another revision.

```ts
const { snapshot, diagnostics } = await knowledge.sync()
```

> [!WARNING]
> Concept ids are the shortest unambiguous form of their path, so **creating** a file can rename a concept nobody touched. Adding `staging/orders.md` turns an existing `orders` into `tables/orders`. Re-read the listing or the manifest after a sync rather than assuming ids are stable.

For native tenants, `PUT` returns after durable publication and the new snapshot is immediately readable. Batch related changes with `transact()` to avoid publishing one snapshot per document. Legacy source writes retain their edit-then-sync behavior until migration. The watcher's `--debounce` only coalesces external folder changes.

The same verbs are on the command line against any connection string, so you can edit a local store and a remote one the same way:

```sh
langonrock query "$DSN" source                              # list, with hashes
langonrock query "$DSN" read sales tables/orders.md         # content out, hash on stderr
langonrock query "$DSN" write sales metrics/new.md --create < new.md
langonrock query "$DSN" write sales tables/orders.md --replaces "$HASH" < edited.md
langonrock query "$DSN" delete sales tables/old.md --force
langonrock query "$DSN" sync
```

`--create`, `--replaces <hash>` and `--force` are the command-line spelling of the same precondition. There is no default. The server refuses a write that says nothing, and `--force` states outright that you are replacing whatever is there right now.

## Large tenants

The manifest costs about 41 tokens per concept, so past a few thousand concepts it stops being worth reading whole. Narrow it instead of paginating:

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
const concepts = await knowledge.get(['orders', 'customers'], {
  section: 'schema'
})
const passage = await knowledge.get(['pride_3'], {
  find: 'ten thousand a year'
})
```

Every read returns slices, `{ text, start, end, total }`, so a whole read and a windowed one have the same shape, and `find` adds `matches` and `matchCount`. The library never truncates unless asked. `offset` and `limit` are opt-in here, and only the MCP boundary caps reads by default.

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

It runs on Node, Deno, Electron, Tauri and the browser. A test checks that by bundling the entry point for Node and failing on any `Bun.` reference or filesystem import.

For a desktop app, use one HTTP client with two configurations. Locally, ship the `langonrock` binary as a sidecar and spawn `langonrock serve --socket <path>`. Remotely, point the same client at a server with a token. The client has no filesystem to open, so it refuses an embedded `okf://` string with an explanation instead of failing silently.

> [!NOTE]
> Windows has no unix socket here, so a local sidecar there means loopback TCP, and the server refuses TCP without tokens. Generate one per session and pass it in the connection string.

## How it is stored

```
data/
  tenants/acme/
    HEAD                           # committed revision and artifact checksums
    snapshots/<sha256>.tnt         # compiled read model
    sources/<sha256>.src           # exact source prefixes and navigation files
    revisions/<sha256>.rev         # transaction history
    imports/<sha256>.imp           # tracked folder hashes
    staging/                       # unpublished writes
    writer.lock
    retention.lock
```

A TNT1 snapshot contains the contiguous manifest, concept offsets and section ranges, and zstd-compressed bodies. Source archives reuse those bodies while preserving the rest of the original Markdown. The engine syncs immutable artifacts to disk before it replaces `HEAD` and flushes it. Kernel locks serialize publishers. A reader takes a retention lock briefly while it pins a snapshot, then keeps that revision for the whole operation.

Snapshot digests identify compiled bytes, and revision digests identify commits. Source-only edits can share a snapshot. Restore publishes an older complete source state as a new revision, and it only goes through if the current revision is the one the caller expected.

Back up complete tenant directories with writers and collection stopped, or take a consistent filesystem snapshot. `langonrock gc` retains ten committed native revisions by default and removes unreferenced artifacts and abandoned staging. `verify` checks stored data independently of ordinary caches. See the [maintenance and recovery contract](docs/dbms.md#collection-verification-and-repair).

> [!IMPORTANT]
> A `.tnt` alone holds only compiled data. A complete native tenant also preserves original source documents. Legacy `current`/snapshot stores still need their original Markdown for lossless migration.

## Benchmarks

The tables below measure the read model and the serving layer. They were rerun on 2026-10-01 with Bun 1.4.2 on an Apple M1 Pro, and every timing is the median of three runs. Token counts do not vary between runs.

The native engine's comparison against the pre-conversion commit lives in the [DBMS performance report](docs/benchmarks/dbms.md), with its [measurement protocol](bench/dbms/README.md) and [verification record](walkthrough.md). On Bun 1.3.12, thirty pairs per size left 109 metrics passing and five inconclusive. A ten-pair [capture on Bun 1.4.2](bench/results/dbms/bun-1.4.2.md) fails open latency at 500 and 5,000 concepts, 34 to 68 percent above the baseline. Both sides open faster on 1.4.2 than on 1.3.12, but the baseline gained more. Performance acceptance is still open, and so is Linux and Windows execution.

The reference corpus is generated to match the shape of Google's OKF samples. Each concept has v0.2 frontmatter, prose written for people, `# Schema` and `# Joins` headings and links to other concepts, at about 2 KB. Twenty fixed questions have a stated ground truth, and the bench charges both paths for delivering the same concepts. The baseline is the OKF reference consumption pattern, which reads `index.md`, reads a concept and follows its links. It runs the same BM25 this project uses over the raw Markdown, and it navigates perfectly, never taking a wrong turn.

Run `bun bench/run.ts [profile] [bundles] [concepts per bundle]` to reproduce these. It prints one JSON line. `1 500` gives the token tables, `10 500` and `40 500` the scale rows, and a profile name [the other document shapes](#document-shape).

### Tokens, 500 concepts in one bundle

A session is twenty questions in one conversation. Content read once stays in context and costs the cache rate on every later call. Both paths pay under that same model.

| Path                               | Billed tokens |  Calls |
| ---------------------------------- | ------------: | -----: |
| OKF index navigator                |       116,357 |     30 |
| langonrock, manifest in the prompt |    **64,355** | **17** |
| langonrock, search first           |        56,928 |     36 |

The store has two strategies and the benchmark bills both. Keeping the manifest in the cached prefix costs the fewest round trips, which is what this project optimises for. Ranking first and fetching what ranked never reads the manifest at all. That is cheaper in tokens here and much cheaper on a large tenant, at one extra turn per question. [Document shape](#document-shape) has the crossover.

| What a read costs                    |  Tokens |
| ------------------------------------ | ------: |
| OKF `read_concept`, the whole file   |     594 |
| `get(id)`, frontmatter compiled away |     445 |
| `get(id, "schema")`                  | **213** |
| One search result, eight rows        |     731 |

| What can go in the prompt |  Tokens |
| ------------------------- | ------: |
| The bundle in full        | 264,744 |
| `index.md`                |  16,575 |
| `manifest.tsv`            |  20,549 |

> [!NOTE]
> The manifest is **larger** than a well-kept `index.md` here. The saving comes from batching and section addressing, not from density.

### Scale

| Concepts         |     500 |   5,000 |  20,000 |
| ---------------- | ------: | ------: | ------: |
| Whole manifest   |  20,549 | 205,851 | 835,922 |
| One bundle slice |  20,549 |  20,419 |  20,486 |
| Snapshot on disk | 0.56 MB |  5.6 MB | 22.6 MB |

### Latency, median milliseconds

| Operation                    |  500 | 5,000 | 20,000 |
| ---------------------------- | ---: | ----: | -----: |
| Compile and write a snapshot |   42 |   226 |    725 |
| Open a snapshot, cold        | 0.86 |  4.26 |   18.9 |
| Read the whole manifest      | 0.03 |  0.11 |   0.44 |
| Batched `get` of 3 sections  | 0.04 |  0.04 |   0.05 |
| Build the BM25 index         |   19 |   152 |    578 |
| BM25 query, with `pos`       | 0.22 |  0.55 |   1.65 |

`get` is flat. A batched fetch of three sections costs the same 0.04 ms on twenty thousand concepts as on five hundred. Compiling, indexing, search and the whole-manifest read grow with the corpus. None of it is where the time goes. One saved model round trip is worth about a second, three to four orders of magnitude more than any read in this table.

Memory is not in that table. The store keeps one BM25 index in memory per snapshot. It takes 1.1 MB of heap at 500 concepts, 8.1 MB at 5,000 and 32 MB at 20,000. In the DBMS bench, a fresh process that opens 20,000 concepts, builds the index and searches peaks at 0.36 GB resident. The index build streams the bodies off a single read of the snapshot's blob region, and `serve` rebuilds the index right after each sync, so the first search after a save does not pay for it.

### Retrieval accuracy

Whether the concept that answers the question is in the top eight, over the same twenty questions on 500 concepts.

| Retrieval                                  | Hit rate |      MRR |
| ------------------------------------------ | -------: | -------: |
| OKF BM25 over raw Markdown                 |      70% |     0.43 |
| langonrock BM25                            |      70% |     0.43 |
| langonrock BM25 plus the one-hop expansion |  **75%** | **0.44** |

The last row is what you get without configuring anything. Expansion is on unless a caller passes `expand: false`, which is what the middle row measures. The CLI and the MCP tools offer no way to turn it off.

Queries that describe a concept rather than name it land at 95% on both sides.

> [!IMPORTANT]
> Compiling does not cost ranking. The frontmatter the compiler strips repeats the concept id in its `resource` and `sources` URLs, which helps a ranker that reads raw files. The store makes up for it by indexing the concept's own names, its id and its frontmatter `title`, weighted above the other cells. It matches raw Markdown on mean reciprocal rank and beats it on hit rate with the expansion on.

> [!NOTE]
> Everything above this point comes from a synthetic corpus and a deliberately crude `chars / 4` token estimate. The retrieval table covers a single scale only, because the generator reuses descriptions across bundles, which makes description queries measure the corpus rather than the index. Treat all of this as an order of magnitude and measure your own bundles.

### Document shape

Everything above describes a warehouse catalogue. To find out what the store does to documents that are not reference tables, the same harness runs over four real public-domain corpora, converted to OKF concepts mechanically. Frontmatter holds `type` and `title`, headings are the document's own, and the converter adds no link, table or section the source does not already have.

| Profile             | What it is                                                     | Concepts |
| ------------------- | -------------------------------------------------------------- | -------: |
| `reference`         | Generated warehouse catalogue, the corpus used above           |      500 |
| `scripture`         | The King James Bible, one concept per chapter                  |    1,189 |
| `scripture-coarse`  | The same text, one concept per book, chapters as headings      |       66 |
| `book`              | Four novels, one concept per chapter                           |      102 |
| `book-coarse`       | The same text, one concept per novel, chapters as headings     |        4 |
| `handbook`          | Mrs Beeton's _Book of Household Management_, one per recipe    |    1,281 |
| `handbook-untitled` | The same recipes with no `title` field, the name left as an H1 |    1,281 |
| `spec`              | Twenty-eight IETF RFCs, one concept per document               |       28 |

Each profile gets twenty questions with ground truth stated the same way, and every path pays for delivering the same concepts. `manifest` is the manifest-in-the-prompt strategy, `search` is search-first, and `find` is search-first with the fetch replaced by a located window. The store's cost is the cheapest of the three. `find` only applies where the twenty questions quote the text, because a natural-language question has nothing to locate. `n/a` marks the other profiles.

| Profile            |    Corpus | `manifest.tsv` | OKF billed | `manifest` |   `search` |     `find` | Saving |
| ------------------ | --------: | -------------: | ---------: | ---------: | ---------: | ---------: | -----: |
| `spec`             |   767,143 |          1,176 |    756,168 | **13,995** |     52,862 |        n/a |    98% |
| `scripture-coarse` | 1,067,694 |          2,028 |  1,278,420 | **39,395** |     67,740 |     45,695 |    97% |
| `book-coarse`      |   343,265 |            113 |    338,296 |    122,236 |    186,850 | **37,736** |    89% |
| `handbook`         |   613,230 |         26,198 |    125,798 |     71,797 | **19,551** |        n/a |    84% |
| `book`             |   344,540 |          1,772 |    130,101 |    127,077 |    188,730 | **39,862** |    69% |
| `scripture`        | 1,076,465 |         38,283 |    159,174 |    148,029 |     75,625 | **53,801** |    66% |
| `reference`        |   264,744 |         20,549 |    116,357 |     64,355 | **56,928** |        n/a |    51% |

Round trips are left out of that table because they barely vary. The manifest strategy spends 16 to 21 calls, and search-first and `find` spend 35 to 40. Both buy tokens with one extra turn per question, and this project treats a turn as the expensive resource.

| Profile     | OKF `read_concept` | `get(id)` | `get(id, section)` | `get(id, find)` |
| ----------- | -----------------: | --------: | -----------------: | --------------: |
| `spec`      |             23,439 |    23,321 |            **388** |             n/a |
| `book`      |              3,261 |     3,244 |              3,244 |         **513** |
| `scripture` |                852 |       841 |                841 |         **476** |
| `reference` |                594 |       445 |            **213** |             n/a |
| `handbook`  |                292 |       279 |             **87** |             n/a |

The ordering follows how much structure the document already carries, not corpus size. Two things pay off.

- **Headings.** `get(id, section)` can only return a slice if the document names its slices. An RFC numbers every subsection, so a question about one costs 388 tokens instead of 23,439. A Bible chapter and a novel chapter have no headings, so a section read returns the whole chapter. `find` closes that gap. A located window costs 476 to 513 tokens where the whole document costs 841 to 3,244.
- **Links.** Batching saves a round trip only when the manifest knows which concepts belong together. Mrs Beeton's "No. 105" cross-references and the RFC citation graph both compile into the `links` column. The Bible and the novels have none, so the store spends exactly as many turns as the navigator.

When a corpus has neither, what is left is the frontmatter the compiler strips, and on real prose that is almost nothing. It is 17 tokens per chapter on the novels and 11 on the Bible, against the 149 a full OKF sample header costs.

#### Locating instead of reading

Without `find`, the novels save 2 percent. They have no headings to address and no links to batch. `find` changes the unit of retrieval instead of the format. Search names the chapter, `get` with a literal phrase returns a window around the first occurrence plus the offset of every other one, and the chapter never enters the context. On these profiles the twenty questions are passages to locate.

| Profile            | OKF billed | Store, without `find` | Store, `find` windows | Saving |
| ------------------ | ---------: | --------------------: | --------------------: | -----: |
| `book`             |    130,101 |               127,077 |            **39,862** |    69% |
| `book-coarse`      |    338,296 |               122,236 |            **37,736** |    89% |
| `scripture`        |    159,174 |                75,625 |            **53,801** |    66% |
| `scripture-coarse` |  1,278,420 |            **39,395** |                45,695 |    97% |

All twenty questions located on every row. `scripture-coarse` is the loss. Its 66-row manifest, paid once and cached for the session, still beats paying for a search on every question, so `find` wins where the manifest or the documents are large, not everywhere. On the other rows the novels go from a 2 percent saving to 69, and the chapter-grain Bible drops from 148,029 tokens to 53,801 with nothing changed on disk.

Every `find` and `search` figure here includes the `pos` column described below, so the tables show its cost rather than a version without it.

Locating costs about what fetching does. A `find` sweeps the decompressed body with `indexOf`, and its median over the bench corpora is 0.03 to 0.3 ms. That is the same as `get` on the same document, and three to four orders of magnitude below the model turn it feeds.

`find` needs a quote, and `pos` removes that requirement. Every direct search hit ends in a `pos` column with the offset where the query's words cluster densest in the body, so the second hop can be `get(id, { offset: pos, limit: 2000 })` even when the question describes a passage instead of quoting it. The next table asks the same twenty questions as summaries rather than quotes, and compares capped document reads with `pos` windows.

| Profile            | Capped reads | `pos` windows | Window held the passage |
| ------------------ | -----------: | ------------: | ----------------------: |
| `scripture-coarse` |      220,967 |    **47,541** |                 20 / 20 |
| `spec`             |      155,996 |    **58,416** |                   5 / 7 |
| `book`             |      180,625 |   **125,911** |                  8 / 20 |
| `scripture`        |       76,173 |    **56,780** |                 19 / 20 |
| `book-coarse`      |   **33,115** |        38,336 |                 20 / 20 |

The bench checks the last column. A hit means the wanted concept's window contained the passage the question pointed at, which held in 113 of 135 locatable cases across the eight profiles. The `book` misses come from ranking, not from the window. Described queries reach the top eight only 40 percent of the time on prose without headings, and the window answered every question that ranking did place. `book-coarse` loses for the opposite reason. Four documents spread their capped reads over twenty questions at the cache rate, and twenty fresh windows cannot match that. The column itself costs six to sixteen tokens per search result.

Over MCP, `get` also caps a naive read. It returns at most 15,000 characters per concept by default, frames a partial slice as `@@ id [start..end of total]`, and continues it with `offset`. The library and the HTTP API stay unbounded by default, because their callers are programs rather than prompts. Here is the largest single concept of each corpus.

| Largest concept in     | Naive `get` | Through the MCP cap |
| ---------------------- | ----------: | ------------------: |
| `book-coarse`, a novel |     172,994 |           **3,758** |
| `spec`, RFC 9110       |     122,797 |           **3,758** |
| `handbook`             |      76,221 |           **3,759** |
| `book`, one chapter    |      11,406 |           **3,760** |

The most an MCP client pays for one concept is a constant, about 3,760 tokens, whatever the size of the document.

> [!IMPORTANT]
> On prose with no headings and no links, whole-document reads save about two percent, and `find` is what makes the store worth using there. Links still cannot be invented. On a corpus with no link graph the store spends exactly as many turns as the navigator.

#### Which strategy, and when

You pay for the manifest once and spread it over the session, and you pay for a search on every question. That puts the crossover at a fixed ratio rather than a corpus size.

| Profile            | `manifest.tsv` | One search result | Ratio | Cheaper  |
| ------------------ | -------------: | ----------------: | ----: | -------- |
| `handbook`         |         26,198 |               259 |   101 | search   |
| `scripture`        |         38,283 |               434 |    88 | search   |
| `reference`        |         20,549 |               731 |    28 | search   |
| `book`             |          1,772 |               175 |    10 | manifest |
| `scripture-coarse` |          2,028 |               299 |     7 | manifest |
| `spec`             |          1,176 |               665 |     2 | manifest |

Over twenty questions the crossover lands near a ratio of twenty. Below it, keep the manifest in the prompt and pay for it once. Above it, never read the manifest and rank instead. The store makes that call itself. At startup the MCP server measures the manifest, estimates one search result from the manifest's own row lengths, and adds one sentence to the manifest tool's description. Past a ratio of twenty it says to prefer search, and below it to read the manifest whole. The rule classifies all eight bench profiles the way the measured sessions came out, and the same manifest always gets the same advice.

Questions that quote the text add a third strategy, search then locate, whose fetch is a flat window of about 500 tokens whatever the document size. It wins on three of the four quote-shaped profiles. On `scripture-coarse` the manifest stays ahead because it is small. For questions that do not quote, the ratio above still decides between manifest and search.

#### Concept grain is a corpus decision with a large price

`scripture` and `scripture-coarse` are the same 1,189 chapters of the same text. The only difference is whether a chapter is a concept or a heading inside a concept.

| Bible, manifest strategy | Manifest | 20 reads | Manifest re-read at cache rate |      Total |
| ------------------------ | -------: | -------: | -----------------------------: | ---------: |
| One concept per chapter  |   38,283 |   16,820 |                        ~93,000 |    148,029 |
| One concept per book     |    2,028 |   16,900 |                        ~20,500 | **39,395** |

That is 73 percent cheaper for the same text. The manifest re-read on every turn went from 1,189 rows to 66, while a read stayed one chapter, 845 tokens against 841, because chapters became addressable sections. Nearly two thirds of the original bill was re-reading the manifest.

It does not carry over to the novels. Going from `book` to `book-coarse` saves 4 percent, because their manifest was only 1,772 tokens and the cost is the 3,244-token chapter itself. Coarsening helps a corpus whose manifest is large, not one whose documents are large. The novels need an addressable unit smaller than a chapter, which is what `find` provides in [Locating instead of reading](#locating-instead-of-reading).

> [!NOTE]
> The OKF column moves too. At book grain `read_concept` returns a whole book of the Bible, 34,430 tokens, so the baseline's bill goes from 159,174 to 1,278,420. Compare a grain change store against store.

Retrieval over the same questions, top eight:

| Profile     | OKF raw Markdown | langonrock |  plus expansion |
| ----------- | ---------------: | ---------: | --------------: |
| `spec`      |       95% / 0.74 | 95% / 0.80 | **100% / 0.81** |
| `handbook`  |       90% / 0.71 | 95% / 0.83 | **100% / 0.83** |
| `scripture` |       90% / 0.80 | 90% / 0.80 |      90% / 0.80 |
| `reference` |       70% / 0.43 | 70% / 0.43 |  **75% / 0.44** |
| `book`      |       80% / 0.72 | 80% / 0.69 |      80% / 0.69 |

The store matches or beats the raw files everywhere except MRR on the novels, 0.69 against 0.72. Prose with no headings and no links gives the compiler nothing to work with.

There is no stemming, and that is a measured decision. A minimal plural fold lifted the identifier-heavy `reference` corpus by five points of hit rate and 0.12 of MRR, and cost rank quality on every prose corpus. `handbook` lost five points and 0.06 of MRR, and `scripture-coarse` lost 0.08 of MRR. Those numbers are why the fold was reverted.

Titles get special treatment because of `handbook`. Mrs Beeton numbers her recipes, so the id is `recipe_181` and the words "rabbit soup" live only in the `title` the compiler strips. Before the index folded titles in, the store hit 50 percent on `handbook` against the baseline's 90. The index now puts every concept's title next to its id, weighted above the other fields, and the store hits 95.

`handbook-untitled` is the same bundle with the title moved out of the frontmatter into the body as an H1, which is how a downloaded document usually looks. It is the control that shows the title fold works.

| Where the title lives      | langonrock | plus expansion |  MRR |
| -------------------------- | ---------: | -------------: | ---: |
| `title:` frontmatter       |    **95%** |       **100%** | 0.83 |
| An H1 in the body          |        85% |            90% | 0.71 |
| Raw Markdown, the baseline |        90% |            n/a | 0.71 |

Indexing the title costs zero prompt tokens and no manifest width. It rides in the snapshot directory, never in a row the agent pays for on every turn.

> [!NOTE]
> The harness downloads the real corpora on first run and caches them in `bench/.cache`, so only the first run needs a network. Parsers written against one edition of each text convert them, and the harness fails loudly if an edition stops matching rather than benchmarking a corpus it silently mangled.

### The serving layer

Run `bun bench/ops.ts [profile] [bundles] [concepts per bundle]` to reproduce these. Disk figures cover the complete native tenant, including source archives, revisions and import metadata.

|                                | 500 concepts | 1,189, `scripture` | 5,000 concepts |
| ------------------------------ | -----------: | -----------------: | -------------: |
| Snapshot on disk               |      0.56 MB |            2.17 MB |        5.63 MB |
| Sync an unchanged tree         |       9.5 ms |            32.3 ms |        84.3 ms |
| Sync after editing one concept |      27.6 ms |            56.8 ms |       166.6 ms |
| Edit on disk, read to visible  |      26.0 ms |            57.5 ms |       171.5 ms |
| Index heap per tenant          |      1.07 MB |             7.6 MB |         8.1 MB |

One query, by how you reach it. Cold is a fresh embedded invocation that builds the index first. Warm is the same question against an index already in memory in the same process. The socket row is a real `serve` over a unix socket, so it includes serialisation and IPC.

|                                   | 500 concepts | 1,189, `scripture` | 5,000 concepts |
| --------------------------------- | -----------: | -----------------: | -------------: |
| Cold: open, index, one query      |      17.2 ms |           157.2 ms |       148.2 ms |
| Warm, in process                  |     0.183 ms |           0.437 ms |       0.483 ms |
| Over a unix socket, a real daemon |     0.312 ms |           0.564 ms |       0.639 ms |
| Over a socket, read the manifest  |     0.112 ms |           0.113 ms |       0.129 ms |
| Over a socket, batched `get`      |     0.152 ms |           0.178 ms |       0.108 ms |
| Through MCP, the same search      |     0.397 ms |           0.630 ms |       0.773 ms |
| The same search, no MCP layer     |     0.271 ms |           0.486 ms |       0.553 ms |

**A daemon is 55 to 279 times faster.** Compare cold with the socket row, which is the fair pair: 17.2 ms against 0.31, 157 against 0.56, 148 against 0.64. An embedded invocation rebuilds the BM25 index from nothing before it can answer anything, and that is the whole of the difference.

**Transport is a fixed cost, not a proportional one.** The socket adds 0.13 to 0.16 ms over the in-process figure, and the MCP layer adds another 0.13 to 0.22 ms. Neither grows much with the corpus. The query itself does. Warm search runs 0.18 to 0.48 ms here because it decompresses and scans the top hits' bodies to compute `pos`, and it reaches 14 ms when the hits are whole novels. That is still about two orders of magnitude below the model turn it feeds.

The write path, through the HTTP source routes where the precondition lives:

|                                      | 500 concepts | 1,189, `scripture` | 5,000 concepts |
| ------------------------------------ | -----------: | -----------------: | -------------: |
| Read, then write naming its hash     |      14.1 ms |            18.2 ms |        44.2 ms |
| A write naming a stale hash, refused |      1.01 ms |            2.22 ms |        4.18 ms |
| Stale writes actually refused        |        5 / 5 |              5 / 5 |          5 / 5 |

**Losing a write race is cheap to discover.** A write that names the version it replaces costs 14 to 44 ms end to end, because the engine syncs every new artifact to disk before it publishes the commit. A write that names a stale version is refused in 1 to 4 ms, because nothing gets written. The server refused every stale write in every run rather than merging it.

**Immutability is paid in disk, linearly in edits.** A snapshot is one file named by its own hash, and two snapshots share nothing, so a one-line change writes a full copy. Ten edits leave eleven snapshots and eleven times the tenant on disk at every scale tested, which is 125 MB from an 11.4 MB tenant at 5,000 concepts. Rollback is free and a backup is a directory copy, but `gc` is what keeps the design affordable. It keeps ten committed revisions by default and removes the rest.

**A no-op sync is cheaper than an edit, but not free.** A sync that changes nothing costs a third to a half of one that changes something: 9.5 ms against 27.6 at 500 concepts, 84 against 167 at 5,000. The store detects the no-op and writes nothing, but only after reading the whole tree. That is the watcher's steady cost per burst of filesystem events, and at 5,000 concepts it is 84 ms of work to conclude that nothing happened.

**Determinism holds.** Identical input compiled twice produces the same snapshot hash and the writer reuses it, at every size tested. That is what keeps the manifest in the client's prompt cache across a rebuild.

**Memory is mostly the index.** A tenant's BM25 index takes 1.4 to 3.5 times its snapshot size in heap after a full collection, 8.1 MB for 5,000 concepts. Resident memory per tenant is too noisy to report on Bun 1.4. Across runs it moved between 0.2 and 8.9 MB per 5,000-concept tenant, because the allocator reuses pages that earlier index builds freed.

| Registering the MCP server          | Tokens |
| ----------------------------------- | -----: |
| The four read tools, every session  |  1,122 |
| `write` on top of them              |    412 |
| `delete` on top of that             |    207 |
| Six tool definitions, every session |  1,741 |

That is the entry fee, paid in the client's system prompt whether or not the model ever asks about knowledge, and it does not change with corpus size. The schemas of `get`'s four slicing parameters are 131 tokens of it, repaid the first time one window replaces one chapter. Another 156 explain the `pos` column, the `stale` status and the tenant's strategy advice, at 78, 55 and 23 tokens. One avoided capped read of 3,758 tokens repays them 24 times over. The fee is worth it when the model consults knowledge often, which is what the tip in [Use it from an agent](#use-it-from-an-agent) concludes too.

The write side is 619 of those tokens, 55 percent on top of the read tools. `write` alone ties `get` as the most expensive definition in the set, 412 tokens against 413. Seventy of them are the paragraph that teaches a model to recover from a refused precondition, which is cheaper than shipping a separate read-the-hash tool with a definition of its own. `delete` is half the size because it refers to that lesson instead of restating it.

A deployment that only ever reads pays all 619 for nothing. That is the argument for a flag that omits both tools, and no such flag exists yet.

## CLI

| Command         |                                                           |
| --------------- | --------------------------------------------------------- |
| `compile <dir>` | Compile one bundle to a manifest on stdout                |
| `put <dir>`     | Store one directory as one bundle                         |
| `sync <dir>`    | Store every subdirectory as its own bundle                |
| `import <dir>`  | Import a folder of bundles with conflict detection        |
| `migrate <dir>` | Explicitly migrate a legacy tenant using original sources |
| `export <dir>`  | Export exact current Markdown to a new directory          |
| `transact`      | Commit an atomic JSON batch from stdin or `--from`        |
| `history`       | Read retained committed revisions                         |
| `restore <rev>` | Restore source state with `--expected-revision`           |
| `verify [rev]`  | Verify stored data or a named candidate                   |
| `repair <rev>`  | Select a verified root with `--expected-head`             |
| `watch <dir>`   | Keep a tenant in sync with a folder                       |
| `manifest`      | Print the stored manifest                                 |
| `get <id…>`     | Fetch concepts by id                                      |
| `serve`         | Run the daemon                                            |
| `token`         | Mint a token and record its grant                         |
| `query <dsn> …` | Any read or write verb over any dsn                       |
| `mcp <dsn>`     | Serve MCP over stdio                                      |
| `gc`            | Collect old and partial snapshots                         |

`query` takes `manifest`, `snapshot`, `search`, `get`, `source`, `read`, `write`, `delete`, `delete-bundle`, `sync`, `transact`, `history`, and `restore`. Migration, export, verification, and repair are local maintenance commands. [Database examples](docs/dbms.md#cli-http-and-mcp) show the additional flags.

Useful options: `--data` (store root), `--tenant`, `--section`, `--offset`, `--limit`, `--find`, `--k`, `--summary-width`, `--strict` to exit non-zero on any diagnostic, `--dry-run` for `gc`. For `serve`: `--socket`, or `--host` and `--port` for TCP, `--tls-cert` and `--tls-key` for TLS, and `--debounce` to coalesce filesystem events. For `token`: `--tenant` and `--write`. Run `langonrock --help` for the rest.

Without `--data`, the store lives in the platform data directory: `$XDG_DATA_HOME/langonrock` on Linux, `~/Library/Application Support/langonrock` on macOS, `%LOCALAPPDATA%\langonrock` on Windows. `$LANGONROCK_DATA` overrides it.

## Development

```sh
bun install
bun run build:native
bun run test
bun run lint
bun run format:check
bun run typecheck
bun run check:dependencies
bun run check:deps
bun run check:deadcode
bun run build --target=bun-darwin-arm64
```

Development needs Bun 1.4.2 or newer. `bun run test` spreads the suite over one worker per core with `bun test --parallel`, and `bun test <file>` runs a single file. `bun run build` compiles the CLI into a standalone binary with ESM bytecode.

ESLint uses type-aware rules, including checks for unhandled promises. Knip
checks unused files, dependencies, and exports. Unused exports and types are
warnings. Unused files, dependency errors, and unresolved imports fail the
check. The pre-push hook runs the static checks in parallel, then the suite.

CI runs the static checks on Linux, and the native build, smoke tests and suite on Linux, macOS and Windows. Pushing a `v*` tag builds six binaries on matching OS and architecture runners, checksums them, and publishes a release.

> [!NOTE]
> While the repository is private, `install.sh` cannot download anonymously and falls back to an authenticated `gh release download`. Install `gh` and run `gh auth login` first, or grab the asset from the releases page.
