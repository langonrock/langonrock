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
| Tokens billed for a 20-question session |       109,315 | **58,819** |
| Tool calls                              |            30 |     **17** |
| Tokens for one concept read             |           631 |    **226** |

The saving is not that TSV is denser than Markdown. It is that the manifest carries the link graph, so the agent knows every id it needs _before_ fetching anything and gets them in one batched call, and that a concept is addressable by section instead of whole.

> [!NOTE]
> These numbers come from a 500-concept corpus generated to match the shape of Google's sample bundles, scored with a deliberately crude `chars / 4` token estimate applied to both sides. Treat them as an order of magnitude, and measure your own corpus.

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

## Editing over the network

An editor needs to create, change and delete concepts remotely. It does that by writing the **source Markdown**, never a snapshot: the watcher recompiles from source, so a snapshot written directly would be silently replaced within seconds. Writing source is the path the design endorses, and the read API above is untouched by it — no HTTP request ever writes a snapshot.

Tell the server where each tenant's Markdown lives, in `<data>/sources.json`. Folders are never moved into the store; source usually lives in a git repository of its own.

```json
{ "acme": "/home/me/sources/acme" }
```

A tenant that is not listed stays readable and refuses writes. Grant writing per token in `<data>/tokens.json`, where a bare string still means read-only:

```json
{
  "reader-token": "acme",
  "editor-token": { "tenant": "acme", "write": true }
}
```

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
> A write must name the version it replaces: `If-Match: "<hash>"` to overwrite, or `If-None-Match: *` to insist the concept is new. Neither header is a `428`, a stale hash is a `412`. Two people editing one concept is the normal case for an editor, and a silently lost update is the worst failure this API could have, so the unsafe call is impossible rather than merely discouraged.

Through the library the precondition is an argument, enforced identically whether you are embedded or remote:

```ts
const knowledge = open('okf+https://host:7777?token=editor-token')

const before = await knowledge.readSource('sales', 'tables/orders.md')
await knowledge.writeSource('sales', 'tables/orders.md', edited, before?.hash)
await knowledge.writeSource('sales', 'metrics/new.md', created) // no hash: must not exist
const { snapshot } = await knowledge.sync()
```

> [!WARNING]
> Concept ids are the shortest unambiguous form of their path, so **creating** a file can rename a concept nobody touched: adding `staging/orders.md` turns an existing `orders` into `tables/orders`. Re-read the manifest after a sync rather than assuming ids are stable.

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

`--create`, `--replaces <hash>` and `--force` are the command-line spelling of the same precondition. There is no default: a write that says nothing is refused, and `--force` is the honest name for taking whatever is there right now.

## Large tenants

The manifest costs roughly 35 tokens per concept, so it stops being worth reading whole somewhere past a few thousand concepts. Narrow instead of paginating:

```ts
await connection.manifest('sales') // one bundle
await connection.search('orders', { bundle: 'ops' })
```

Rows are grouped by bundle in the snapshot, so one bundle is a contiguous slice the reader hands back without parsing. On a 20,000-concept tenant that is 17,914 tokens against 732,986 for the whole manifest, and it stays flat as the tenant grows.

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
