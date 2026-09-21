# langonrock

[![ci](https://github.com/langonrock/langonrock/actions/workflows/ci.yml/badge.svg)](https://github.com/langonrock/langonrock/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-blue.svg)
![runtime](https://img.shields.io/badge/bun-%E2%89%A5%201.3-black.svg)

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

That corpus is a warehouse catalogue, and the saving is a property of the documents rather than of the store. The same twenty-question harness over a set of RFCs saves 98 percent; over four novels it used to save 2, and saves 69 now that `find` returns the passage instead of the chapter. Full numbers, including where the store loses, are in [Benchmarks](#benchmarks).

## Features

- **Compiles any Markdown, keeps OKF as the bar.** Every file compiles, frontmatter or not, with its id, summary, title and links derived from the text; `--strict` is the OKF conformance gate. Import/export preserves the authoring format.
- **A manifest that fits in the prompt.** One dense TSV row per concept: id, bundle, kind, status, grain, summary, outgoing links.
- **Byte-deterministic output.** Identical input compiles to identical bytes, so the manifest stays in the prompt cache across rebuilds.
- **Section addressing.** `get(id, { section: "schema" })` returns one slice instead of the whole document, using the concept's own Markdown headings.
- **Sliced reads on any document.** `offset` and `limit` page a long concept, and `find` returns a window around a literal phrase plus the offset of every occurrence — sub-document addressing that works on prose with no headings at all. Over MCP a read is capped at 15,000 characters per concept by default, so a naive `get` can never flood a model's context.
- **Batched reads.** Pass every id you need in one call; N concepts cost one round trip.
- **Deterministic retrieval.** BM25 plus a capped one-hop expansion over the link graph, with no model call anywhere in the path.
- **Search that points inside the document.** Every direct hit carries `pos`, the offset of the passage densest in the query's words, so the next `get` can be a 2,000-character window instead of the document — no quote required.
- **Knowledge that expires visibly.** A concept past its `stale_after` date shows `stale` in the manifest's status cell, computed at read time so the snapshot bytes never depend on the clock.
- **Atomic document transactions.** Commit related edits together, retain revision history, and restore a complete source revision as a new commit. Back up the complete tenant while writers and collection are stopped.
- **Multi-tenant.** A tenant is a directory boundary with its own snapshots and its own index.
- **Three connection modes, one interface.** Embedded, local daemon, or HTTP server, selected by a connection string.
- **Refuses to leak its own credentials.** TCP needs a token, and any address past loopback needs TLS, or the server declines to start.
- **MCP server.** Six verbs for Claude Code, Cursor, or anything else that speaks MCP — four to read and two to write, with tool descriptions that carry the tenant's own numbers: the server measures the manifest at startup and advises manifest-first or search-first.
- **A model can persist knowledge, safely.** The MCP `write` and `delete` tools change a concept and recompile, and a tenant that does not exist yet is created by the first write. Both still need the hash they replace, and the refusal names that hash, so a model satisfies the precondition without a lost update.
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

Everything an agent needs to plan its reads is in those rows. A `status` cell other than `-` is the concept telling you it is not current — `deprecated`, `draft`, or `stale` once its `stale_after` date passes. Then fetch only what you chose, and only the part you need:

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

At the start of each session the client runs that command, asks the server what it offers, and puts the six tool definitions in its system prompt. Nothing is discovered and nothing is fetched, so a server that fails to start shows up as tools that are quietly absent. `claude mcp list` is what tells you.

Any connection string works, so point it at a [running daemon](#running-a-server) and every agent invocation shares one process with warm indexes rather than paying cold start:

```sh
claude mcp add langonrock -s project -- langonrock mcp "okf+unix:///tmp/okf.sock?tenant=acme"
```

`-s project` writes to `.mcp.json` in the repository instead of your own settings, so committing it hands the same knowledge to everyone who clones. That only works if the connection string resolves on their machines too, which in practice means a socket or a server rather than a path.

> [!TIP]
> MCP is not the only way in. A client that can run shell commands can call the CLI directly, with a line in its instructions saying the command exists. The six tool definitions cost tokens in every session whether or not anyone asks about knowledge, and a line of prose costs almost nothing but relies on the model remembering. Register the server when knowledge is consulted constantly, and reach for the CLI when it is occasional.

Six tools are enabled by default because every tool definition costs tokens in the client's system prompt. Add `--database-tools` to expose `transact`, `history`, and `restore` explicitly:

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

`delete` works the same way, minus the create case: the hash is not optional there, so a deletion is always two calls, and omitting the hash against a concept that is not there is answered with `concept does not exist` rather than a hash to retry with.

> New native tenants can be created by their first write. Existing native tenants do not need a source-folder registration. Unmigrated legacy tenants still require their original source mapping for source edits; use [explicit migration](docs/dbms.md#migrate-a-legacy-tenant) before database transactions.

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

`sources.json` maps each tenant to a folder for startup import and watching. Write that path in full, because nothing expands `~` inside a JSON string. Native API writes commit to the database. A later folder import reports a conflict if both versions changed differently; it does not silently overwrite database edits.

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
POST /v1/{tenant}/get                      {"ids": [...], "section"?, "offset"?, "limit"?, "find"?}
POST /v1/{tenant}/search                   {"q": "...", "k"?: n, "expand"?: false, "bundle"?: "..."}
```

`get` answers with one slice per id — `{"text", "start", "end", "total"}`, plus `"matches"` and `"matchCount"` when `find` was set — so a caller always knows how much text exists beyond what it received.

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

A file with no `id` is a navigation document that the compiler excludes from concept reads. Its exact source still appears in source access and export. Ordinary Markdown can compile without frontmatter.

`sync` returns the current commit's compiler diagnostics: a missing `type`, a link resolving to nothing, or a skipped file. Native writes already committed those results; `sync` does not create another revision.

```ts
const { snapshot, diagnostics } = await knowledge.sync()
```

> [!WARNING]
> Concept ids are the shortest unambiguous form of their path, so **creating** a file can rename a concept nobody touched: adding `staging/orders.md` turns an existing `orders` into `tables/orders`. Re-read the listing or the manifest after a sync rather than assuming ids are stable.

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
const concepts = await knowledge.get(['orders', 'customers'], {
  section: 'schema'
})
const passage = await knowledge.get(['pride_3'], {
  find: 'ten thousand a year'
})
```

Every read returns slices, `{ text, start, end, total }`, so a whole read and a windowed one have the same shape; `find` adds `matches` and `matchCount`. The library never truncates unless asked — `offset` and `limit` are opt-in here, and only the MCP boundary caps by default.

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
    HEAD                           # committed revision and artifact checksums
    snapshots/<sha256>.tnt         # compiled read model
    sources/<sha256>.src           # exact source prefixes and navigation files
    revisions/<sha256>.rev         # transaction history
    imports/<sha256>.imp           # tracked folder hashes
    staging/                       # unpublished writes
    writer.lock
    retention.lock
```

A TNT1 snapshot contains the contiguous manifest, concept offsets and section ranges, and zstd-compressed bodies. Source archives reuse those bodies while preserving the rest of the original Markdown. The engine synchronizes immutable artifacts before replacing and durably flushing `HEAD`. Kernel locks serialize publishers; readers briefly take a retention lock while pinning a snapshot and keep that revision through each operation.

Snapshot digests identify compiled bytes; revision digests identify commits. Source-only edits can share a snapshot. Restore publishes an older complete source state as a new revision, guarded by the expected current revision.

Back up complete tenant directories with writers and collection stopped, or take a consistent filesystem snapshot. `langonrock gc` retains ten committed native revisions by default and removes unreferenced artifacts and abandoned staging. `verify` checks stored data independently of ordinary caches. See the [maintenance and recovery contract](docs/dbms.md#collection-verification-and-repair).

> [!IMPORTANT]
> A `.tnt` alone holds only compiled data. A complete native tenant also preserves original source documents. Legacy `current`/snapshot stores still need their original Markdown for lossless migration.

## Benchmarks

The tables below document the earlier OKF/read-model benchmarks. They are not the DBMS before/after comparison. The conversion uses a pinned original commit, fresh paired processes, and separate performance limits at 500, 5,000, and 20,000 concepts. See the [DBMS performance report](docs/benchmarks/dbms.md), [measurement protocol](bench/dbms/README.md), and [current verification record](walkthrough.md). After thirty pairs per size, 109 metrics pass and five remain inconclusive. Performance acceptance and Linux/Windows execution remain open.

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
| One search result, eight rows        |     731 |

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
| BM25 query, with `pos`       |  0.29 |  0.94 |   2.13 |

The query row is roughly three times what it was before search began computing `pos`, because ranking is now followed by a scan of the top hits' bodies. `get` is flat: batching a fetch costs the same on a tenant of twenty thousand concepts as on one of five hundred. None of this is where the time goes, though. One saved model round trip is worth about a second, four orders of magnitude more than any row above.

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

Twenty questions per profile, ground truth stated the same way, every path charged for delivering the same concepts. `manifest` is the manifest-in-the-prompt strategy, `search` is search-first, `find` is search-first with the fetch replaced by a located window; the store's cost is the best of the three. A `find` column only exists where the twenty questions are literal phrases of the text — a natural-language question has nothing to locate, which is what — means.

| Profile            |    Corpus | `manifest.tsv` | OKF billed | `manifest` |   `search` |     `find` | Saving |
| ------------------ | --------: | -------------: | ---------: | ---------: | ---------: | ---------: | -----: |
| `spec`             |   767,143 |          1,176 |    756,168 | **13,995** |     52,862 |          — |    98% |
| `scripture-coarse` | 1,067,694 |          2,028 |  1,278,420 | **39,395** |     67,740 |     45,695 |    97% |
| `book-coarse`      |   343,265 |            113 |    338,296 |    122,236 |    186,850 | **37,736** |    89% |
| `handbook`         |   613,230 |         26,198 |    125,798 |     71,797 | **19,551** |          — |    84% |
| `book`             |   344,540 |          1,772 |    130,101 |    127,077 |    188,730 | **39,862** |    69% |
| `scripture`        | 1,076,465 |         38,283 |    159,174 |    148,029 |     75,625 | **53,801** |    66% |
| `reference`        |   264,744 |         20,549 |    116,357 |     64,355 | **56,928** |          — |    51% |

Round trips are not in that table because they are the same everywhere: the manifest strategy spends 16 to 21 calls, search-first and `find` spend 35 to 40. Both buy tokens with one extra turn per question, and this project treats a turn as the expensive resource.

| Profile     | OKF `read_concept` | `get(id)` | `get(id, section)` | `get(id, find)` |
| ----------- | -----------------: | --------: | -----------------: | --------------: |
| `spec`      |             23,439 |    23,321 |            **388** |               — |
| `book`      |              3,261 |     3,244 |              3,244 |         **513** |
| `scripture` |                852 |       841 |                841 |         **476** |
| `reference` |                594 |       445 |            **213** |               — |
| `handbook`  |                292 |       279 |             **87** |               — |

The ordering is not by corpus size. It is by how much structure the document already carries, and two things pay:

- **Headings.** `get(id, section)` can only return a slice if the document names its slices. An RFC numbers every subsection, so a question about one costs 388 tokens instead of 23,439. A Bible chapter and a novel chapter have no headings at all, so the section read and the whole read used to be the same read — the gap `find` closes: a located window costs 476 to 513 tokens where the whole document costs 841 to 3,244.
- **Links.** Batching saves a round trip only when the manifest knows which concepts belong together. Mrs Beeton's "No. 105" cross-references and the RFC citation graph both compile into the `links` column. The Bible and the novels have none, so the store spends exactly as many turns as the navigator.

What is left when a corpus has neither is the frontmatter the compiler strips, and on real prose that is almost nothing: 17 tokens per chapter on the novels, 11 on the Bible, against the 149 a full OKF sample header costs.

#### Locating instead of reading

The novels were the profile this store could not help: no headings to address, no links to batch, a 2 percent saving. `find` changes the unit of retrieval instead of the format — search names the chapter, `get` with a literal phrase returns a window around the first occurrence plus the offset of every other one, and the chapter never enters the context. The same twenty questions, which on these profiles are passages to locate:

| Profile            | OKF billed | Store, without `find` | Store, `find` windows | Saving |
| ------------------ | ---------: | --------------------: | --------------------: | -----: |
| `book`             |    130,101 |               127,077 |            **39,862** |    69% |
| `book-coarse`      |    338,296 |               122,236 |            **37,736** |    89% |
| `scripture`        |    159,174 |                75,625 |            **53,801** |    66% |
| `scripture-coarse` |  1,278,420 |            **39,395** |                45,695 |    97% |

Every one of the twenty questions located on every row. `scripture-coarse` is the honest loss: a 66-row manifest amortised over the session still beats paying a search per question, so `find` wins where the manifest is large or the documents are, not everywhere. The other rows are the novels' 2 percent becoming 69, and the chapter-grain Bible dropping from 148,029 to 53,801 with the store byte-for-byte unchanged on disk.

Every `find` and `search` figure on this page carries the `pos` column added below, which is why they sit about one percent above the numbers this section reported when `find` shipped alone: the novels' 39,274 became 39,862, and `handbook` and `reference` each gave back a point of saving. Locating pays for pointing, and the tables state the price rather than the best version of itself.

Locating is not slower than fetching. A `find` sweeps the decompressed body with `indexOf`, and the median over the bench corpora runs 0.05 to 0.3 ms — the same order as `get` itself, and three to four orders below the model turn it feeds.

`find` needs a quote. `pos` removes that requirement: every direct search hit now ends in a `pos` column naming the offset where the query's words cluster densest in the body, so the second hop can be `get(id, { offset: pos, limit: 2000 })` even when the question describes a passage instead of quoting one. The same twenty questions asked descriptively — summaries, not quotes — answered by capped document reads against `pos` windows:

| Profile            | Capped reads | `pos` windows | Window held the passage |
| ------------------ | -----------: | ------------: | ----------------------: |
| `scripture-coarse` |      220,967 |    **47,541** |                 20 / 20 |
| `spec`             |      155,996 |    **58,416** |                   5 / 7 |
| `book`             |      180,625 |   **125,911** |                  8 / 20 |
| `scripture`        |       76,173 |    **56,780** |                 19 / 20 |
| `book-coarse`      |   **33,115** |        38,336 |                 20 / 20 |

The last column is checked rather than assumed: a hit means the wanted concept's window really contained the passage the question pointed at, and across the eight profiles that held in 113 of 135 locatable cases. The `book` row's misses are ranking's, not the window's — described queries reach the top eight only 40 percent of the time on headingless prose, and every question ranking did place, the window answered. `book-coarse` is the honest loss from the other side: four documents amortise their capped reads across twenty questions at the cache rate, and twenty fresh windows cannot. The column itself costs six to sixteen tokens per search result.

The other half of the change is what a naive read can no longer do. Over MCP, `get` returns at most 15,000 characters per concept by default; a partial slice is framed as `@@ id [start..end of total]` and continued with `offset`, while the library and the HTTP API stay unbounded by default because their callers are programs rather than prompts. Measured as the largest single concept of each corpus:

| Largest concept in     | Naive `get` | Through the MCP cap |
| ---------------------- | ----------: | ------------------: |
| `book-coarse`, a novel |     172,994 |           **3,758** |
| `spec`, RFC 9110       |     122,797 |           **3,758** |
| `handbook`             |      76,221 |           **3,759** |
| `book`, one chapter    |      11,406 |           **3,760** |

The worst case an MCP client can pay for one concept fell from the size of the document, whatever it is, to a constant.

> [!IMPORTANT]
> On prose with no headings and no links, whole-document reads are worth about two percent, and a folder of chapters was better served by reading the files. That was the honest limit of this store until `find` gave prose the sub-document addressing its missing headings never could. What remains true is that links cannot be conjured: on a corpus with no graph the store still spends exactly as many turns as the navigator.

#### Which strategy, and when

The manifest is paid once and amortised over the session; a search is paid per question. That puts the crossover at a fixed ratio rather than a corpus size.

| Profile            | `manifest.tsv` | One search result | Ratio | Cheaper  |
| ------------------ | -------------: | ----------------: | ----: | -------- |
| `handbook`         |         26,198 |               259 |   101 | search   |
| `scripture`        |         38,283 |               434 |    88 | search   |
| `reference`        |         20,549 |               731 |    28 | search   |
| `book`             |          1,772 |               175 |    10 | manifest |
| `scripture-coarse` |          2,028 |               299 |     7 | manifest |
| `spec`             |          1,176 |               665 |     2 | manifest |

Over twenty questions the crossover lands near twenty. Below it, keep the manifest in the prompt and pay for it once; above it, never read the manifest and rank instead. That call now ships with the store: at startup the MCP server measures the manifest, estimates one search result from the manifest's own row lengths, and appends one sentence to the manifest tool's description — prefer search past the ratio of twenty, read it whole below. The rule classifies all eight bench profiles the way the measured sessions came out, and it is deterministic: same manifest, same advice.

Quote-shaped questions add a third strategy to that choice: search, then locate, whose fetch side is a flat window of about 500 tokens regardless of document size. It is the cheapest path whenever the question is a passage to find rather than a document to read; the ratio above still decides manifest against search for everything else.

#### Concept grain is a corpus decision with a large price

`scripture` and `scripture-coarse` are the same 1,189 chapters of the same text. The only difference is whether a chapter is a concept or a heading inside a concept.

| Bible, manifest strategy | Manifest | 20 reads | Manifest re-read at cache rate |      Total |
| ------------------------ | -------: | -------: | -----------------------------: | ---------: |
| One concept per chapter  |   38,283 |   16,820 |                        ~93,000 |    148,029 |
| One concept per book     |    2,028 |   16,900 |                        ~20,500 | **39,395** |

Seventy-three percent cheaper, and the store is byte-for-byte the same. What changed is that 1,189 rows re-read on every turn became 66, while the read stayed one chapter (845 tokens against 841) because chapters became addressable sections. Nearly two thirds of the original bill was the manifest, not the text.

It does not generalise to the novels: `book` to `book-coarse` saves 4 percent, because their manifest was 1,772 tokens to begin with and the cost is the 3,244-token chapter itself. Coarsening helps a corpus whose manifest is large, not one whose documents are large. What the novels needed was a smaller addressable unit than the chapter, and that is what `find` is: the windowed rows in [Locating instead of reading](#locating-instead-of-reading) move exactly where coarsening could not.

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

The store meets or beats the raw files everywhere except the novels' top position, where prose with no headings and no links gives the compiler nothing to work with.

There is no stemming, and that is a measured decision rather than a default: a minimal plural fold lifted the identifier-heavy `reference` corpus by five points of hit rate and 0.12 of MRR, and paid for it with rank quality across every prose corpus — `handbook` lost five points and 0.06 of MRR, `scripture-coarse` 0.08 of MRR. The fold was reverted; these numbers are why. `handbook` is the profile that used to prove the opposite — 50% against the baseline's 90% — and what it was measuring was a design cost, not noise: Mrs Beeton numbers her recipes, so the id is `recipe_181` and the words "rabbit soup" lived only in the `title` the compiler strips. The index now folds every concept's title in next to its id, weighted above the other fields, and the penalty is gone.

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
| Cold: open, index, one query      |      21.4 ms |           147.3 ms |       177.9 ms |
| Warm, in process                  |     0.327 ms |           0.510 ms |       0.644 ms |
| Over a unix socket, a real daemon |     0.551 ms |           0.673 ms |       0.900 ms |
| Over a socket, read the manifest  |     0.123 ms |           0.117 ms |       0.114 ms |
| Over a socket, batched `get`      |     0.226 ms |           0.185 ms |       0.209 ms |
| Through MCP, the same search      |     0.547 ms |           0.708 ms |       0.869 ms |
| The same search, no MCP layer     |     0.386 ms |           0.563 ms |       0.733 ms |

**A daemon is worth 39 to 219 times.** Cold against the socket row, which is the honest pair: 21.4 against 0.551, 147.3 against 0.673, 177.9 against 0.900. An embedded invocation rebuilds the BM25 index from nothing before it can answer anything, and that is the whole of the difference.

**Transport is a fixed cost, not a proportional one.** The socket adds 0.16 to 0.26 ms over the in-process figure at every size, and the MCP layer adds another 0.14 to 0.16 ms. Neither grows with the corpus. What grew is the query itself: a search now decompresses and scans its top hits' bodies to compute `pos`, which put warm search from the old 0.02–0.15 ms range into 0.3–0.9 ms here and up to 14 ms when the hits are whole novels — one to two orders of magnitude, and still two below the model turn it feeds.

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

| Registering the MCP server          | Tokens |
| ----------------------------------- | -----: |
| The four read tools, every session  |  1,122 |
| `write` on top of them              |    413 |
| `delete` on top of that             |    206 |
| Six tool definitions, every session |  1,741 |

That is the entry fee, paid in the client's system prompt whether or not the model ever asks about knowledge, and it does not change with corpus size. The slicing parameters on `get` are 229 tokens of it, repaid the first time one window replaces one chapter; sixty more are the `pos` column's explanation, the tenant's own strategy advice, and the `stale` status — repaid by one avoided capped read about sixty times over. Worth it when knowledge is consulted repeatedly, which is the same conclusion the tip above reaches, now with a number on it.

The write side is 619 tokens of that, 55 percent on top of the read-only figure it was measured against. `write` alone ties `get` as the most expensive definition in the set, and 70 of its tokens are the one paragraph teaching a model to recover from a refused precondition — the price of not shipping a separate read-the-hash tool, which would have cost a whole definition instead. `delete` is half the size because it inherits that lesson by reference rather than restating it.

A deployment that only ever reads pays all 619 for nothing. That is the argument for a flag that omits both tools; there is none today.

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
bun test
bun run lint
bun run format:check
bun run typecheck
bun run check:dependencies
bun run check:deps
bun run check:deadcode
bun run build --target=bun-darwin-arm64
```

ESLint uses type-aware rules, including checks for unhandled promises. Knip
checks unused files, dependencies, and exports. Unused exports and types are
warnings; unused files, dependency errors, and unresolved imports fail the
check. CI and the pre-push hook run these checks alongside the test suite.

CI runs the suite on Linux, macOS and Windows. Pushing a `v*` tag cross-compiles six binaries, checksums them, and publishes a release.

> [!NOTE]
> While the repository is private, `install.sh` cannot download anonymously and falls back to an authenticated `gh release download`. Install `gh` and run `gh auth login` first, or grab the asset from the releases page.
